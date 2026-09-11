import type { ConditionCode } from "../types.js";
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import {
  CONVERSATION_OBSERVER_VERSION,
  CONVERSATION_OBSERVER_MODEL,
  CONVERSATION_OBSERVER_PARAMETERS,
  CONVERSATION_OBSERVER_PROMPT_VERSION,
  CONVERSATION_OBSERVER_SCHEMA_VERSION,
  observeConversationTurnInMemory,
  type ConversationStateAfter,
  type ObserverTranscriptMessage,
  type QuestionThreadSnapshot,
} from "../lib/conversationObserver.js";
import type { ConversationActor, ConversationLedgerState } from "../lib/conversationLedger.js";
import {
  CONVERSATION_LEDGER_JUDGE_VERSION,
  CONVERSATION_LEDGER_JUDGE_MODEL,
  CONVERSATION_LEDGER_JUDGE_PARAMETERS,
  CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION,
  CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION,
  judgeConversationLedgerTurn,
} from "../lib/interventionJudge.js";
import { disabledGuards } from "../lib/guardFlags.js";
import { eligibleTraitIdsForLedgerState } from "../lib/interventionEngine.js";
import { transcriptLabel } from "../lib/labels.js";
import { TRAIT_BY_ID } from "../lib/traitData.js";
import type { ParticipantRole } from "../types.js";
import {
  ConversationGoldFileSchema,
  deployedActionAgainstGold,
  finalGoldByReplaySeq,
  semanticOutcomeForControllerTurn,
  semanticOutcomeMatchesGold,
  turnAttribution,
  type ConversationGoldFile,
} from "./conversationGold.js";

interface CorpusManifestEntry {
  sessionCode: string;
  conditionCode: string;
  lane: "development" | "holdout";
  inputPath: string;
  inputSha256: string;
}

interface CorpusManifest {
  schemaVersion: string;
  selectorVersion: string;
  entries: CorpusManifestEntry[];
}

interface CorpusInput {
  schemaVersion: string;
  lane: "development" | "holdout";
  source: { format: "json" | "csv" };
  session: { sessionCode: string; conditionCode: string };
  participants: Array<{ role: ParticipantRole }>;
  messages: Array<{
    originalSeq: number;
    replaySeq: number;
    sourceOrder: number;
    senderRole: ParticipantRole | "ai";
    content: string;
    sharedInfoIds?: string[];
  }>;
  deployedBaselineByHumanTurn: Array<{
    originalSeq: number;
    replaySeq: number;
    observationStatus: "observed_records" | "not_observed";
    interventionLinkage: {
      turnIndexMeaning: "originalSeq";
      status: "unique" | "ambiguous_original_seq_collision" | "no_record";
      candidateReplaySeqs: number[];
    };
    records: Array<Record<string, unknown>>;
  }>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(args: string[]) {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) continue;
    if (["--all", "--validate-only", "--unlock-holdout"].includes(argument)) {
      flags.add(argument);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  return { values, flags };
}

function messagesSinceAlex(messages: ObserverTranscriptMessage[]): number {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.senderRole === "ai") break;
    count += 1;
  }
  return count;
}

function gitValue(workspaceRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: workspaceRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDirectory, "../..");
const workspaceRoot = resolve(serverRoot, "..");
const args = parseArgs(process.argv.slice(2));
const manifestPath = resolve(
  workspaceRoot,
  args.values.get("--manifest") ??
    "eval-results/conversation-architecture/corpus-manifest.json",
);
const manifestText = readFileSync(manifestPath, "utf8");
const corpusManifest = JSON.parse(manifestText) as CorpusManifest;
const sessionCode = args.values.get("--session");
const lane = args.values.get("--lane") as "development" | "holdout" | undefined;
if (lane && lane !== "development" && lane !== "holdout") {
  throw new Error("--lane must be development or holdout");
}
if (!sessionCode && !args.flags.has("--all") && !args.flags.has("--validate-only")) {
  throw new Error("Choose --session CODE, or explicitly pass --all (optionally with --lane)");
}
if (lane === "holdout" && !args.flags.has("--unlock-holdout")) {
  throw new Error("Holdout execution requires explicit --unlock-holdout");
}
let selected = corpusManifest.entries;
if (sessionCode) selected = selected.filter((entry) => entry.sessionCode === sessionCode);
if (lane) selected = selected.filter((entry) => entry.lane === lane);
if (!args.flags.has("--unlock-holdout")) {
  selected = selected.filter((entry) => entry.lane !== "holdout");
}
if (!selected.length) throw new Error("No corpus entries matched the requested scope");

const inputs = selected.map((entry) => {
  const path = resolve(workspaceRoot, entry.inputPath);
  const text = readFileSync(path, "utf8");
  if (sha256(text) !== entry.inputSha256) {
    throw new Error(`Input hash mismatch for ${entry.sessionCode}`);
  }
  const input = JSON.parse(text) as CorpusInput;
  if (input.session.sessionCode !== entry.sessionCode || input.lane !== entry.lane) {
    throw new Error(`Manifest/input identity mismatch for ${entry.sessionCode}`);
  }
  const replaySeqs = input.messages.map((message) => message.replaySeq);
  if (
    new Set(replaySeqs).size !== replaySeqs.length ||
    replaySeqs.some((seq, index) => seq !== index + 1)
  ) {
    throw new Error(`Replay sequence is not unique and increasing for ${entry.sessionCode}`);
  }
  const baselineReplaySeqs = input.deployedBaselineByHumanTurn.map((turn) => turn.replaySeq);
  if (new Set(baselineReplaySeqs).size !== baselineReplaySeqs.length) {
    throw new Error(`Human-turn baseline replay sequence is not unique for ${entry.sessionCode}`);
  }
  const goldPath = resolve(
    workspaceRoot,
    `eval-results/conversation-architecture/labels/${entry.sessionCode}.gold.json`,
  );
  let gold: ConversationGoldFile | null = null;
  let goldSha256: string | null = null;
  if (existsSync(goldPath)) {
    const goldText = readFileSync(goldPath, "utf8");
    gold = ConversationGoldFileSchema.parse(JSON.parse(goldText));
    goldSha256 = sha256(goldText);
    if (
      gold.sessionCode !== entry.sessionCode ||
      gold.inputSha256 !== entry.inputSha256 ||
      gold.lane !== entry.lane
    ) {
      throw new Error(`Gold/input identity mismatch for ${entry.sessionCode}`);
    }
  }
  return { entry, input, gold, goldSha256 };
});

if (args.flags.has("--validate-only")) {
  const humanTurns = inputs.reduce(
    (total, item) =>
      total + item.input.messages.filter((message) => message.senderRole !== "ai").length,
    0,
  );
  console.log(
    `[conversation-smoke] validated ${inputs.length} frozen inputs and ${humanTurns} human turns; no model calls made`,
  );
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = resolve(
  workspaceRoot,
  args.values.get("--output") ?? `eval-results/conversation-architecture/runs/${timestamp}`,
);
if (existsSync(runRoot)) {
  throw new Error(`Run output already exists and is immutable: ${runRoot}`);
}
mkdirSync(runRoot, { recursive: true });
const turnRows: Array<Record<string, unknown>> = [];
/** Turns whose session actually recorded what was put on the board. */
let boardTurns = 0;
let observerErrors = 0;
let judgeErrors = 0;

for (const { entry, input, gold } of inputs) {
  const roster = [
    "alex",
    ...new Set(input.participants.map((participant) => participant.role)),
  ] as ConversationActor[];
  const messages: ObserverTranscriptMessage[] = input.messages.map((message) => ({
    seq: message.replaySeq,
    senderRole: message.senderRole,
    speaker: transcriptLabel(message.senderRole),
    content: message.content,
  }));
  let previousThread: QuestionThreadSnapshot | null = null;
  let previousStateAfter: ConversationStateAfter | null = null;
  let previousLedgerState: ConversationLedgerState | null = null;
  let conversationEpoch = 0;
  const finalGold = gold ? finalGoldByReplaySeq(gold) : new Map();

  for (const message of input.messages) {
    if (message.senderRole === "ai") continue;
    conversationEpoch += 1;
    const transcriptThroughAnchor = messages.filter(
      (candidate) => candidate.seq <= message.replaySeq,
    );
    const stateBefore = previousLedgerState;
    const observed = await observeConversationTurnInMemory({
      sessionKey: input.session.sessionCode,
      messages: transcriptThroughAnchor,
      participantRoster: roster,
      anchorSeq: message.replaySeq,
      conversationEpoch,
      previousThread,
      previousStateAfter,
      previousLedgerState,
    });
    const baseline = input.deployedBaselineByHumanTurn.find(
      (turn) => turn.replaySeq === message.replaySeq,
    ) ?? {
      originalSeq: message.originalSeq,
      replaySeq: message.replaySeq,
      observationStatus: "not_observed" as const,
      interventionLinkage: {
        turnIndexMeaning: "originalSeq" as const,
        status: "no_record" as const,
        candidateReplaySeqs: [message.replaySeq],
      },
      records: [],
    };
    const goldExpectation = finalGold.get(message.replaySeq);
    if (!observed.ok) {
      observerErrors += 1;
      const candidateGoldStatus = goldExpectation
        ? goldExpectation.mode === "abstain"
          ? "abstain"
          : "mismatch"
        : "not_scored";
      const deployedGoldStatus = goldExpectation
        ? deployedActionAgainstGold(baseline, goldExpectation)
        : "not_scored";
      turnRows.push({
        sessionCode: entry.sessionCode,
        conditionCode: entry.conditionCode,
        lane: entry.lane,
        currentTriggerSeq: message.replaySeq,
        currentTriggerOriginalSeq: message.originalSeq,
        contextThroughSeq: message.replaySeq,
        contextThroughOriginalSeq: message.originalSeq,
        deployedBaseline: baseline,
        observer: {
          ok: false,
          error: observed.error,
          latencyMs: observed.latencyMs,
          attempts: observed.callAttempts,
        },
        judge: null,
        gold: goldExpectation
          ? {
              expectation: goldExpectation,
              candidateSemanticOutcome: null,
              candidateGoldStatus,
              deployedGoldStatus,
              attribution:
                deployedGoldStatus !== "not_scored"
                  ? turnAttribution({
                      deployed: deployedGoldStatus,
                      candidate:
                        goldExpectation.mode === "abstain" ? "abstain" : "mismatch",
                    })
                  : "not_scored",
              pipelineFailure: "observer",
            }
          : null,
      });
      continue;
    }
    const snapshot = observed.snapshot;
    previousThread = snapshot.questionThreadAfter;
    previousStateAfter = snapshot.stateAfter;
    previousLedgerState = snapshot.ledgerStateAfter!;
    const currentThread = previousLedgerState.foregroundThreadId
      ? previousLedgerState.threads.find(
          (thread) => thread.id === previousLedgerState!.foregroundThreadId,
        )
      : undefined;
    // The board through this anchor, rebuilt into the shape a live session
    // stores it in, and handed to the Judge exactly as the live path hands it —
    // this file supplies the board and never derives the leader's list from it,
    // which is the boundary `test:intervention-v2` holds by name.
    //
    // Split by speaker rather than pooled. The coverage reading only unions the
    // two sides, but which side a trait came from is the pooling DV, and an eval
    // that blurs it cannot be read against a session.
    const messagesThroughAnchor = input.messages.filter(
      (candidate) => candidate.replaySeq <= message.replaySeq,
    );
    const surfacedThroughAnchor = new Set(
      messagesThroughAnchor.flatMap((candidate) => candidate.sharedInfoIds ?? []),
    );
    // Whether this session records what was put on the board at all. The flag
    // used to read `source.format === "json"`, which is not the same question
    // and answered it wrongly for 39 of the corpus's 41 sessions: `sharedInfoIds`
    // is present and empty on every one of the corpus's 1451 messages, because
    // the pilot export it was built from never carried the field's contents.
    //
    // So the board is unknown, and the Judge is told nothing about it rather
    // than told an invention. `revealStats` is left absent, which now suppresses
    // both board-derived sentences; on a live session it is always present.
    // This corrects itself the moment a corpus with real ids is prepared.
    const coverageAvailable = surfacedThroughAnchor.size > 0;
    if (coverageAvailable) boardTurns += 1;
    const revealStats = coverageAvailable
      ? {
          byCandidate: Object.fromEntries(
            (["A", "B", "C", "D"] as const).map((candidate) => [
              candidate,
              {
                revealedIds: messagesThroughAnchor
                  .filter((replayed) => replayed.senderRole !== "ai")
                  .flatMap((replayed) => replayed.sharedInfoIds ?? [])
                  .filter((id) => TRAIT_BY_ID.get(id)?.candidate === candidate),
              },
            ]),
          ),
          aiSurfacedIds: messagesThroughAnchor
            .filter((replayed) => replayed.senderRole === "ai")
            .flatMap((replayed) => replayed.sharedInfoIds ?? []),
        }
      : undefined;
    // The live path's own function, over the whole thread scope. The previous
    // form returned `[]` unless the thread had exactly one candidate, which is
    // most of a comparison phase — and once the Judge's prompt began stating
    // what an empty list *means*, that silent gap became the sentence "you hold
    // no unsurfaced fact to add here" on turns where Alex held its whole card.
    // An eval that feeds the Judge a false premise cannot measure the Judge.
    const eligibleTraitIds = eligibleTraitIdsForLedgerState(
      previousLedgerState,
      surfacedThroughAnchor,
    );
    const sinceAlex = messagesSinceAlex(transcriptThroughAnchor);
    const judged = await judgeConversationLedgerTurn({
      messages: transcriptThroughAnchor,
      state: previousLedgerState,
      conditionCode: (entry.conditionCode as ConditionCode) ?? "C1",
      cooldownAvailable: sinceAlex >= TRIGGER_CONFIG.COOLDOWN_MIN_MSGS,
      backchannelAvailable: true,
      eligibleTraitIds,
      revealStats,
    });
    if (!judged.decision) judgeErrors += 1;
    const candidateSemanticOutcome =
      judged.decision && goldExpectation
        ? semanticOutcomeForControllerTurn({
            stateBefore,
            stateAfter: previousLedgerState,
            delta: snapshot.ledgerDelta!,
            judge: judged.decision,
          })
        : null;
    const candidateGoldStatus = goldExpectation
      ? candidateSemanticOutcome
        ? semanticOutcomeMatchesGold(candidateSemanticOutcome, goldExpectation)
        : goldExpectation.mode === "abstain"
          ? "abstain"
          : "mismatch"
      : "not_scored";
    const deployedGoldStatus = goldExpectation
      ? deployedActionAgainstGold(baseline, goldExpectation)
      : "not_scored";
    const attribution =
      candidateGoldStatus !== "not_scored" && deployedGoldStatus !== "not_scored"
        ? turnAttribution({ deployed: deployedGoldStatus, candidate: candidateGoldStatus })
        : "not_scored";
    turnRows.push({
      sessionCode: entry.sessionCode,
      conditionCode: entry.conditionCode,
      lane: entry.lane,
      currentTriggerSeq: message.replaySeq,
      currentTriggerOriginalSeq: message.originalSeq,
      contextThroughSeq: previousLedgerState.contextThroughSeq,
      contextThroughOriginalSeq: message.originalSeq,
      deployedBaseline: baseline,
      observer: {
        ok: true,
        version: CONVERSATION_OBSERVER_VERSION,
        reviewed: observed.observerReviewed,
        model: observed.model,
        responseId: observed.responseId,
        latencyMs: observed.latencyMs,
        attempts: observed.callAttempts,
        observation: snapshot.observation,
      },
      reducer: {
        delta: snapshot.ledgerDelta,
        transition: snapshot.ledgerTransition,
        stateAfter: previousLedgerState,
      },
      infrastructure: {
        messagesSinceAlex: sinceAlex,
        cooldownAvailable: sinceAlex >= TRIGGER_CONFIG.COOLDOWN_MIN_MSGS,
        backchannelAvailable: true,
        backchannelAvailabilitySource: "unavailable_in_export_assumed_true",
        coverageAvailable,
        eligibleTraitIds,
      },
      judge: judged.decision
        ? {
            ok: true,
            version: CONVERSATION_LEDGER_JUDGE_VERSION,
            decision: judged.decision,
            attempts: judged.attempts,
          }
        : {
            ok: false,
            version: CONVERSATION_LEDGER_JUDGE_VERSION,
            attempts: judged.attempts,
          },
      candidateStateMutation: "observation_only_no_hypothetical_broadcast_consumption",
      gold: goldExpectation
        ? {
            expectation: goldExpectation,
            candidateSemanticOutcome,
            candidateGoldStatus,
            deployedGoldStatus,
            attribution,
            ...(judged.decision ? {} : { pipelineFailure: "judge" }),
          }
        : null,
    });
  }
}

const turnsPath = resolve(runRoot, "turns.jsonl");
writeFileSync(turnsPath, `${turnRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
const summary = {
  sessions: inputs.length,
  turns: turnRows.length,
  observerErrors,
  judgeErrors,
  speak: turnRows.filter((row: any) => row.judge?.decision?.decision === "speak").length,
  silent: turnRows.filter((row: any) => row.judge?.decision?.decision === "silent").length,
  reobserve: turnRows.filter((row: any) => row.judge?.decision?.decision === "reobserve").length,
  finalizedGoldTurns: turnRows.filter((row: any) => row.gold).length,
  attribution: Object.fromEntries(
    [
      "preserved_correct",
      "fixed",
      "unchanged_error",
      "regression",
      "ambiguous_or_abstained",
    ].map((category) => [
      category,
      turnRows.filter((row: any) => row.gold?.attribution === category).length,
    ]),
  ),
  acceptanceStatus: turnRows.some((row: any) => row.gold)
    ? "partial_gold_scored_acceptance_gate_not_yet_implemented"
    : "not_scored_no_final_gold_labels",
  stateMutationPolicy: "observation_only_no_hypothetical_broadcast_consumption",
};
writeFileSync(resolve(runRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

const gitDiff = gitValue(workspaceRoot, ["diff", "--binary"]);
const runManifest = {
  schemaVersion: "conversation-controller-smoke-run-v2",
  createdAt: new Date().toISOString(),
  corpusManifestPath: manifestPath,
  corpusManifestSha256: sha256(manifestText),
  corpusSelectorVersion: corpusManifest.selectorVersion,
  inputHashes: selected.map((entry) => ({
    sessionCode: entry.sessionCode,
    sha256: entry.inputSha256,
  })),
  goldHashes: inputs.map(({ entry, gold, goldSha256 }) => ({
    sessionCode: entry.sessionCode,
    status: gold?.status ?? "missing",
    sha256: goldSha256,
  })),
  code: {
    commit: gitValue(workspaceRoot, ["rev-parse", "--verify", "HEAD"]),
    dirtyDiffSha256: sha256(gitDiff),
  },
  components: {
    observer: {
      componentVersion: CONVERSATION_OBSERVER_VERSION,
      promptVersion: CONVERSATION_OBSERVER_PROMPT_VERSION,
      schemaVersion: CONVERSATION_OBSERVER_SCHEMA_VERSION,
      model: CONVERSATION_OBSERVER_MODEL,
      parameters: CONVERSATION_OBSERVER_PARAMETERS,
    },
    ledger: previousLedgerVersion(turnRows),
    judge: {
      componentVersion: CONVERSATION_LEDGER_JUDGE_VERSION,
      promptVersion: CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION,
      schemaVersion: CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION,
      model: CONVERSATION_LEDGER_JUDGE_MODEL,
      parameters: CONVERSATION_LEDGER_JUDGE_PARAMETERS,
    },
  },
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    // Which turn-killing checks were off for this run. The flags are not forced
    // on here, unlike the offline suites: an eval run against a comparison build
    // is a legitimate thing to want. What is not legitimate is a run that does
    // not say which build it measured — a comparison manifest with no flag line
    // reads exactly like an ordinary one.
    disabledGuards: disabledGuards(),
  },
  execution: {
    sessionCode: sessionCode ?? null,
    lane: lane ?? null,
    holdoutUnlocked: args.flags.has("--unlock-holdout"),
    sessionOrder: inputs.map(({ entry }) => entry.sessionCode),
    retryHistoryLocation: "turns.jsonl: observer.attempts and judge.attempts",
    stateMutationPolicy: "observation_only_no_hypothetical_broadcast_consumption",
  },
};
writeFileSync(resolve(runRoot, "manifest.json"), `${JSON.stringify(runManifest, null, 2)}\n`);
writeFileSync(
  resolve(runRoot, "report.md"),
  `# Conversation controller smoke run\n\n- Sessions: ${summary.sessions}\n- Human turns: ${summary.turns}\n- Observer errors: ${observerErrors}\n- Judge errors: ${judgeErrors}\n- Speak / silent / reobserve: ${summary.speak} / ${summary.silent} / ${summary.reobserve}\n- Finalized gold turns scored: ${summary.finalizedGoldTurns}\n- Acceptance status: ${summary.acceptanceStatus}\n- State mutation: observation-only; hypothetical broadcasts were not consumed\n- Board (surfaced trait ids) available on: ${boardTurns} of ${turnRows.length} turns\n\nThis run is controller diagnostic evidence, not a complete acceptance result.${
    boardTurns > 0
      ? ""
      : "\n\n**No turn in this run carried a board.** The corpus records \`sharedInfoIds\` as empty on every message, so the Judge was given no coverage line and no spent-card line, and decisions that turn on which trait Alex may name are not scoreable from this run."
  }\n`,
);
console.log(`[conversation-smoke] wrote ${turnRows.length} turns to ${runRoot}`);

function previousLedgerVersion(rows: Array<Record<string, unknown>>): string {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const reducer = rows[index]!.reducer as { stateAfter?: ConversationLedgerState } | undefined;
    if (reducer?.stateAfter?.ledgerVersion) return reducer.stateAfter.ledgerVersion;
  }
  return "conversation-ledger-v1";
}
