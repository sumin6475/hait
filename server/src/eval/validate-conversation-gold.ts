import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConversationGoldFileSchema,
  type ConversationGoldFile,
} from "./conversationGold.js";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const requireFinal = process.argv.includes("--require-final");
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const manifestPath = resolve(
  workspaceRoot,
  "eval-results/conversation-architecture/corpus-manifest.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  entries: Array<{
    sessionCode: string;
    conditionCode: "C1" | "C2" | "C3" | "C4";
    lane: "development" | "holdout";
    inputPath: string;
    inputSha256: string;
  }>;
};
const labelsRoot = resolve(workspaceRoot, "eval-results/conversation-architecture/labels");
const loaded: Array<{
  conditionCode: "C1" | "C2" | "C3" | "C4";
  gold: ConversationGoldFile;
}> = [];

for (const entry of manifest.entries) {
  const goldPath = resolve(labelsRoot, `${entry.sessionCode}.gold.json`);
  if (!existsSync(goldPath)) {
    if (requireFinal) throw new Error(`Missing gold file for ${entry.sessionCode}`);
    continue;
  }
  const parsed = ConversationGoldFileSchema.parse(JSON.parse(readFileSync(goldPath, "utf8")));
  if (
    parsed.sessionCode !== entry.sessionCode ||
    parsed.conditionCode !== entry.conditionCode ||
    parsed.lane !== entry.lane ||
    parsed.inputSha256 !== entry.inputSha256
  ) {
    throw new Error(`Gold/manifest identity mismatch for ${entry.sessionCode}`);
  }
  const inputText = readFileSync(resolve(workspaceRoot, entry.inputPath), "utf8");
  if (sha256(inputText) !== entry.inputSha256) {
    throw new Error(`Input hash mismatch for ${entry.sessionCode}`);
  }
  const input = JSON.parse(inputText) as {
    messages: Array<{ replaySeq: number; originalSeq: number; senderRole: string }>;
  };
  const expectedTurns = input.messages
    .filter((message) => message.senderRole !== "ai")
    .map((message) => `${message.replaySeq}:${message.originalSeq}`);
  const actualTurns = parsed.turns.map((turn) => `${turn.replaySeq}:${turn.originalSeq}`);
  if (expectedTurns.join("|") !== actualTurns.join("|")) {
    throw new Error(`Gold/input turn identity mismatch for ${entry.sessionCode}`);
  }
  for (const turn of parsed.turns) {
    if (turn.reviewer?.reviewMode === "independent" && turn.initial) {
      if (turn.reviewer.reviewerId === turn.initial.labelerId) {
        throw new Error(
          `Independent reviewer matches initial labeler at ${entry.sessionCode}:${turn.replaySeq}`,
        );
      }
    }
    if (turn.initial && turn.reviewer) {
      if (Date.parse(turn.reviewer.completedAt) <= Date.parse(turn.initial.completedAt)) {
        throw new Error(
          `Reviewer pass is not later than initial pass at ${entry.sessionCode}:${turn.replaySeq}`,
        );
      }
    }
    if (turn.final && !turn.initial) {
      throw new Error(`Final label lacks initial pass at ${entry.sessionCode}:${turn.replaySeq}`);
    }
    if (turn.initial && turn.final) {
      if (Date.parse(turn.final.completedAt) < Date.parse(turn.initial.completedAt)) {
        throw new Error(
          `Final adjudication predates initial pass at ${entry.sessionCode}:${turn.replaySeq}`,
        );
      }
    }
  }
  if (parsed.status === "final" && parsed.turns.some((turn) => !turn.final)) {
    throw new Error(`Final gold file has incomplete turns for ${entry.sessionCode}`);
  }
  if (requireFinal && parsed.status !== "final") {
    throw new Error(`Gold file is not final for ${entry.sessionCode}`);
  }
  loaded.push({ conditionCode: entry.conditionCode, gold: parsed });
}

for (const conditionCode of ["C1", "C2", "C3", "C4"] as const) {
  const turns = loaded
    .filter((item) => item.conditionCode === conditionCode)
    .flatMap((item) =>
      item.gold.turns.map((turn) => ({ sessionCode: item.gold.sessionCode, turn })),
    );
  const alwaysReview = turns.filter(({ turn }) => {
    const expectation = turn.initial?.expectation;
    return (
      expectation?.mode === "acceptable_set" ||
      expectation?.mode === "abstain" ||
      (expectation?.criticalCategories.length ?? 0) > 0
    );
  });
  const remainder = turns
    .filter((candidate) => !alwaysReview.includes(candidate) && candidate.turn.initial)
    .sort((left, right) =>
      left.turn.reviewSamplingKey.localeCompare(right.turn.reviewSamplingKey),
    );
  const sampled = remainder.slice(0, Math.ceil(remainder.length * 0.2));
  for (const { sessionCode, turn } of [...alwaysReview, ...sampled]) {
    if (!turn.reviewer) {
      throw new Error(`Required second review missing at ${sessionCode}:${turn.replaySeq}`);
    }
  }
}

const totals = loaded.reduce(
  (result, item) => {
    result.files += 1;
    result.turns += item.gold.turns.length;
    result.initial += item.gold.turns.filter((turn) => turn.initial).length;
    result.reviewed += item.gold.turns.filter((turn) => turn.reviewer).length;
    result.final += item.gold.turns.filter((turn) => turn.final).length;
    return result;
  },
  { files: 0, turns: 0, initial: 0, reviewed: 0, final: 0 },
);
console.log(`[conversation-gold] validated ${JSON.stringify(totals)}`);

