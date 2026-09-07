import "dotenv/config";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConditionCode, ParticipantRole } from "../types.js";

const CORPUS_SCHEMA_VERSION = "conversation-corpus-v2";
const SELECTOR_VERSION = "stratified-length-and-observable-v1";
const EXPERIMENTAL_CONDITIONS = ["C1", "C2", "C3", "C4"] as const;

interface NormalizedMessage {
  originalSeq: number;
  replaySeq: number;
  sourceOrder: number;
  senderRole: ParticipantRole | "ai";
  sender?: string;
  content: string;
  sharedInfoIds: string[];
  createdAt?: string;
}

interface NormalizedIntervention {
  turnIndex: number;
  decision?: string;
  triggerReason?: string;
  cue?: string;
  response?: string;
  why?: string;
  [key: string]: unknown;
}

interface CorpusSession {
  sessionCode: string;
  conditionCode: ConditionCode;
  source: { format: "json" | "csv"; files: string[]; sourceSessionId?: string };
  participants: Array<{ participantCode?: string; role: ParticipantRole; assignedProfile?: string }>;
  messages: NormalizedMessage[];
  interventions: NormalizedIntervention[];
  sessionMetadata: Record<string, unknown>;
}

interface SessionSummary {
  session: CorpusSession;
  humanTurns: number;
  features: string[];
}

interface SequenceCollision {
  originalSeq: number;
  messages: Array<{
    replaySeq: number;
    sourceOrder: number;
    senderRole: ParticipantRole | "ai";
    createdAt?: string;
  }>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

function assignReplaySequences(
  messages: Array<Omit<NormalizedMessage, "replaySeq">>,
): NormalizedMessage[] {
  return [...messages]
    .sort(
      (left, right) =>
        left.originalSeq - right.originalSeq ||
        (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
        left.sourceOrder - right.sourceOrder,
    )
    .map((message, index) => ({ ...message, replaySeq: index + 1 }));
}

function sequenceCollisions(messages: NormalizedMessage[]): SequenceCollision[] {
  const byOriginalSeq = new Map<number, NormalizedMessage[]>();
  for (const message of messages) {
    const matches = byOriginalSeq.get(message.originalSeq) ?? [];
    matches.push(message);
    byOriginalSeq.set(message.originalSeq, matches);
  }
  return [...byOriginalSeq]
    .filter(([, matches]) => matches.length > 1)
    .map(([originalSeq, matches]) => ({
      originalSeq,
      messages: matches.map(({ replaySeq, sourceOrder, senderRole, createdAt }) => ({
        replaySeq,
        sourceOrder,
        senderRole,
        ...(createdAt ? { createdAt } : {}),
      })),
    }))
    .sort((left, right) => left.originalSeq - right.originalSeq);
}

function normalizeJsonSessions(path: string): CorpusSession[] {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(parsed)) throw new Error(`Expected an array in ${path}`);
  return parsed.map((session: any) => ({
    sessionCode: session.sessionCode,
    conditionCode: session.conditionCode,
    source: { format: "json", files: [relative(workspaceRoot, path)] },
    participants: (session.participants ?? []).map((participant: any) => ({
      participantCode: participant.participantCode,
      role: participant.role,
      assignedProfile: participant.assignedProfile,
    })),
    messages: assignReplaySequences(
      (session.messages ?? []).map((message: any, sourceOrder: number) => ({
        originalSeq: Number(message.seq),
        sourceOrder,
        senderRole: message.senderRole,
        sender: message.sender,
        content: String(message.content ?? ""),
        sharedInfoIds: Array.isArray(message.sharedInfoIds) ? message.sharedInfoIds : [],
        createdAt: message.createdAt,
      })),
    ),
    interventions: (session.interventions ?? []).map((intervention: any) => ({
      ...intervention,
      turnIndex: Number(intervention.turnIndex),
    })),
    sessionMetadata: {
      aiProfile: session.aiProfile,
      createdAt: session.createdAt,
      revealStats: session.revealStats,
    },
  }));
}

function normalizeCsvSessions(csvDirectory: string): CorpusSession[] {
  if (!statSync(csvDirectory).isDirectory()) return [];
  const sessionFiles = readdirSync(csvDirectory)
    .filter((name) => name.endsWith("hait.sessions.csv"))
    .sort();
  const sessions: CorpusSession[] = [];
  for (const sessionName of sessionFiles) {
    const prefix = sessionName.slice(0, -"hait.sessions.csv".length);
    const sessionPath = resolve(csvDirectory, sessionName);
    const messagePath = resolve(csvDirectory, `${prefix}hait.messages.csv`);
    const interventionPath = resolve(csvDirectory, `${prefix}hait.aiinterventions.csv`);
    const sessionRows = parseCsv(readFileSync(sessionPath, "utf8"));
    const messageRows = parseCsv(readFileSync(messagePath, "utf8"));
    const interventionRows = parseCsv(readFileSync(interventionPath, "utf8"));
    for (const sessionRow of sessionRows) {
      const sourceSessionId = sessionRow._id;
      const messages = assignReplaySequences(
        messageRows
        .map((row, sourceOrder) => ({ row, sourceOrder }))
        .filter(({ row }) => row.sessionId === sourceSessionId)
        .map(({ row, sourceOrder }) => ({
          originalSeq: Number(row.seq),
          sourceOrder,
          senderRole: row.senderRole as ParticipantRole | "ai",
          sender: row.sender,
          content: row.content,
          sharedInfoIds: [],
          createdAt: row.createdAt || undefined,
        })),
      );
      const participantByRole = new Map<ParticipantRole, string>();
      for (const message of messages) {
        if (message.senderRole !== "ai") {
          participantByRole.set(message.senderRole, message.sender ?? message.senderRole);
        }
      }
      const interventions = interventionRows
        .filter((row) => row.sessionId === sourceSessionId)
        .map((row) => ({
          ...row,
          turnIndex: Number(row.turnIndex),
          inputTokens: row.inputTokens ? Number(row.inputTokens) : undefined,
          outputTokens: row.outputTokens ? Number(row.outputTokens) : undefined,
          latencyMs: row.latencyMs ? Number(row.latencyMs) : undefined,
        }));
      sessions.push({
        sessionCode: sessionRow.sessionCode,
        conditionCode: sessionRow.conditionCode as ConditionCode,
        source: {
          format: "csv",
          files: [sessionPath, messagePath, interventionPath].map((path) =>
            relative(workspaceRoot, path),
          ),
          sourceSessionId,
        },
        participants: [...participantByRole].map(([role, participantCode]) => ({
          role,
          participantCode,
        })),
        messages,
        interventions,
        sessionMetadata: { ...sessionRow },
      });
    }
  }
  return sessions;
}

function summarize(session: CorpusSession): SessionSummary {
  const humanMessages = session.messages.filter((message) => message.senderRole !== "ai");
  const recordCounts = new Map<number, number>();
  for (const intervention of session.interventions) {
    recordCounts.set(intervention.turnIndex, (recordCounts.get(intervention.turnIndex) ?? 0) + 1);
  }
  const cueText = session.interventions
    .flatMap((intervention) => [intervention.cue, intervention.triggerReason])
    .filter(Boolean)
    .join(" ");
  const features = new Set<string>();
  if (session.interventions.some((record) => record.decision === "speak")) features.add("speak");
  if (session.interventions.some((record) => record.decision === "stay_silent")) {
    features.add("explicit_silent");
  }
  if (humanMessages.some((message) => !recordCounts.has(message.originalSeq))) {
    features.add("not_observed");
  }
  if ([...recordCounts.values()].some((count) => count > 1)) features.add("multi_record_turn");
  if (/address|direct|directed/i.test(cueText)) features.add("direct_or_address");
  if (/followup|follow_up/i.test(cueText)) features.add("followup");
  if (/long.?silence|summary/i.test(cueText)) features.add("timer_or_summary");
  return { session, humanTurns: humanMessages.length, features: [...features].sort() };
}

function combinationsOfFour<T>(values: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let a = 0; a < values.length - 3; a += 1) {
    for (let b = a + 1; b < values.length - 2; b += 1) {
      for (let c = b + 1; c < values.length - 1; c += 1) {
        for (let d = c + 1; d < values.length; d += 1) {
          result.push([values[a]!, values[b]!, values[c]!, values[d]!]);
        }
      }
    }
  }
  return result;
}

function selectHoldout(group: SessionSummary[]): SessionSummary[] {
  if (group.length < 4) {
    throw new Error(`Need at least four eligible sessions for ${group[0]?.session.conditionCode}`);
  }
  const sorted = [...group].sort(
    (left, right) =>
      left.humanTurns - right.humanTurns ||
      left.session.sessionCode.localeCompare(right.session.sessionCode),
  );
  const targets = [0, 1 / 3, 2 / 3, 1].map((fraction) =>
    sorted[0]!.humanTurns +
    fraction * (sorted.at(-1)!.humanTurns - sorted[0]!.humanTurns),
  );
  let best: SessionSummary[] | null = null;
  let bestTuple: [number, number, number, string] | null = null;
  for (const combo of combinationsOfFour(sorted)) {
    const byLength = [...combo].sort((left, right) => left.humanTurns - right.humanTurns);
    const coverage = new Set(combo.flatMap((entry) => entry.features)).size;
    const range = byLength.at(-1)!.humanTurns - byLength[0]!.humanTurns;
    const quantileError = byLength.reduce(
      (total, entry, index) => total + Math.abs(entry.humanTurns - targets[index]!),
      0,
    );
    const lexical = combo
      .map((entry) => entry.session.sessionCode)
      .sort()
      .join("|");
    const tuple: [number, number, number, string] = [coverage, range, -quantileError, lexical];
    const better =
      !bestTuple ||
      tuple[0] > bestTuple[0] ||
      (tuple[0] === bestTuple[0] && tuple[1] > bestTuple[1]) ||
      (tuple[0] === bestTuple[0] && tuple[1] === bestTuple[1] && tuple[2] > bestTuple[2]) ||
      (tuple[0] === bestTuple[0] &&
        tuple[1] === bestTuple[1] &&
        tuple[2] === bestTuple[2] &&
        tuple[3] < bestTuple[3]);
    if (better) {
      best = combo;
      bestTuple = tuple;
    }
  }
  return best!;
}

function baselineForHumanTurn(session: CorpusSession, message: NormalizedMessage) {
  const records = session.interventions.filter(
    (intervention) => intervention.turnIndex === message.originalSeq,
  );
  const matchingMessages = session.messages.filter(
    (candidate) => candidate.originalSeq === message.originalSeq,
  );
  return {
    replaySeq: message.replaySeq,
    originalSeq: message.originalSeq,
    observationStatus: records.length ? "observed_records" : "not_observed",
    interventionLinkage: {
      turnIndexMeaning: "originalSeq",
      status: records.length
        ? matchingMessages.length === 1
          ? "unique"
          : "ambiguous_original_seq_collision"
        : "no_record",
      candidateReplaySeqs: matchingMessages.map((candidate) => candidate.replaySeq),
    },
    records,
  };
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDirectory, "../..");
const workspaceRoot = resolve(serverRoot, "..");
const jsonPath = resolve(serverRoot, "pilot-export.json");
const csvDirectory = resolve(workspaceRoot, "docs/pilot");
const outputRoot = resolve(workspaceRoot, "eval-results/conversation-architecture");
const inputsDirectory = resolve(outputRoot, "inputs");
const labelsDirectory = resolve(outputRoot, "labels");
const runsDirectory = resolve(outputRoot, "runs");

const sessions = [
  ...normalizeJsonSessions(jsonPath),
  ...normalizeCsvSessions(csvDirectory),
];
const byCode = new Map<string, CorpusSession>();
for (const session of sessions) {
  if (byCode.has(session.sessionCode)) {
    throw new Error(`Duplicate session code across sources: ${session.sessionCode}`);
  }
  byCode.set(session.sessionCode, session);
}
const eligible = [...byCode.values()]
  .filter(
    (session) =>
      EXPERIMENTAL_CONDITIONS.includes(session.conditionCode as (typeof EXPERIMENTAL_CONDITIONS)[number]) &&
      session.messages.length > 1,
  )
  .map(summarize);

const holdoutCodes = new Set<string>();
for (const condition of EXPERIMENTAL_CONDITIONS) {
  const selected = selectHoldout(
    eligible.filter((entry) => entry.session.conditionCode === condition),
  );
  for (const entry of selected) holdoutCodes.add(entry.session.sessionCode);
}

mkdirSync(inputsDirectory, { recursive: true });
mkdirSync(labelsDirectory, { recursive: true });
mkdirSync(runsDirectory, { recursive: true });

const manifestEntries = eligible
  .map((entry) => {
    const lane = holdoutCodes.has(entry.session.sessionCode) ? "holdout" : "development";
    const collisions = sequenceCollisions(entry.session.messages);
    const input = {
      schemaVersion: CORPUS_SCHEMA_VERSION,
      lane,
      source: entry.session.source,
      session: {
        sessionCode: entry.session.sessionCode,
        conditionCode: entry.session.conditionCode,
        metadata: entry.session.sessionMetadata,
      },
      participants: entry.session.participants,
      messages: entry.session.messages,
      sequenceAudit: {
        replayOrder: ["originalSeq", "createdAt", "sourceOrder"],
        replaySeqPolicy: "strict ordinal after deterministic replay ordering",
        interventionTurnIndexMeaning: "originalSeq",
        collisions,
      },
      deployedBaselineByHumanTurn: entry.session.messages
        .filter((message) => message.senderRole !== "ai")
        .map((message) => baselineForHumanTurn(entry.session, message)),
      unmatchedInterventions: entry.session.interventions.filter(
        (record) =>
          !entry.session.messages.some(
            (message) =>
              message.senderRole !== "ai" && message.originalSeq === record.turnIndex,
          ),
      ),
    };
    const content = stableJson(input);
    const outputPath = resolve(inputsDirectory, `${entry.session.sessionCode}.json`);
    writeFileSync(outputPath, content);
    return {
      sessionCode: entry.session.sessionCode,
      conditionCode: entry.session.conditionCode,
      lane,
      humanTurns: entry.humanTurns,
      observableFeatures: entry.features,
      sequenceCollisions: collisions,
      inputPath: relative(workspaceRoot, outputPath),
      inputSha256: sha256(content),
      sourceFiles: entry.session.source.files.map((path) => ({
        path,
        sha256: sha256(readFileSync(resolve(workspaceRoot, path))),
      })),
    };
  })
  .sort((left, right) => left.sessionCode.localeCompare(right.sessionCode));

const manifest = {
  schemaVersion: CORPUS_SCHEMA_VERSION,
  selectorVersion: SELECTOR_VERSION,
  generatedAt: new Date().toISOString(),
  eligibility: "conditionCode in C1-C4 and messages.length > 1",
  baselineRule:
    "No matching intervention record is not_observed, never inferred silence; multiple records are preserved.",
  replaySequenceRule:
    "originalSeq is immutable source evidence; replaySeq is a strict ordinal ordered by (originalSeq, createdAt, sourceOrder); intervention turnIndex remains linked to originalSeq and collisions are marked ambiguous.",
  targetDiagnosticAvailability: {
    "T-C3-012": "missing_raw_input",
    "T-C2-026": "missing_raw_input",
  },
  counts: {
    eligibleSessions: manifestEntries.length,
    developmentSessions: manifestEntries.filter((entry) => entry.lane === "development").length,
    holdoutSessions: manifestEntries.filter((entry) => entry.lane === "holdout").length,
    humanTurns: manifestEntries.reduce((total, entry) => total + entry.humanTurns, 0),
    sequenceCollisions: manifestEntries.reduce(
      (total, entry) => total + entry.sequenceCollisions.length,
      0,
    ),
  },
  sequenceCollisions: manifestEntries.flatMap((entry) =>
    entry.sequenceCollisions.map((collision) => ({
      sessionCode: entry.sessionCode,
      ...collision,
    })),
  ),
  entries: manifestEntries,
};
const manifestPath = resolve(outputRoot, "corpus-manifest.json");
writeFileSync(manifestPath, stableJson(manifest));

console.log(
  `[conversation-corpus] wrote ${manifestEntries.length} sessions (${manifest.counts.developmentSessions} development, ${manifest.counts.holdoutSessions} holdout) to ${inputsDirectory}`,
);
console.log(`[conversation-corpus] manifest ${manifestPath}`);
console.log(
  `[conversation-corpus] holdout ${manifestEntries
    .filter((entry) => entry.lane === "holdout")
    .map((entry) => entry.sessionCode)
    .join(", ")}`,
);
