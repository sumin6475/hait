import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extractHumanTraitsFast } from "../lib/poolingExtractor.js";
import { TRAIT_BY_ID } from "../lib/traitData.js";

type HumanRole = "humanX" | "humanY";
type CorpusMessage = {
  content?: unknown;
  senderRole?: unknown;
  sharedInfoIds?: unknown;
};
type Snapshot = {
  sourceSha256: string;
  humanMessages: number;
  behaviorSha256: string;
};

const args = process.argv.slice(2);
const noSnapshot = args.includes("--no-snapshot");
const corpusPath = args.find((arg) => !arg.startsWith("--")) ?? process.env.TRAIT_CORPUS_PATH;
if (!corpusPath) {
  throw new Error("Usage: npm run eval:traits:corpus -- /path/to/messages.json [--no-snapshot]");
}

const source = readFileSync(corpusPath);
const parsed = JSON.parse(source.toString("utf8")) as unknown;
assert.ok(Array.isArray(parsed), "trait corpus must be a JSON array");

const sourceSha256 = createHash("sha256").update(source).digest("hex");
const durations: number[] = [];
const behaviorRows: string[] = [];
let acceptedMessages = 0;
let candidateMessages = 0;
let acceptedOccurrences = 0;
let candidateOccurrences = 0;
let historicalStoredMessages = 0;
let historicalStoredOccurrences = 0;
let historicalIneligibleOccurrences = 0;
let skippedNonHumanMessages = 0;

for (const [sourceIndex, value] of parsed.entries()) {
  const message = value as CorpusMessage;
  if (message.senderRole !== "humanX" && message.senderRole !== "humanY") {
    skippedNonHumanMessages += 1;
    continue;
  }
  const content = message.content;
  assert.equal(typeof content, "string", `human message ${sourceIndex} content must be a string`);
  const role = message.senderRole as HumanRole;
  const assignedProfile = role === "humanX" ? "X" : "Y";
  const startedAt = performance.now();
  const result = extractHumanTraitsFast({ messageText: content as string, assignedProfile });
  durations.push(performance.now() - startedAt);

  const acceptedIds = [...result.acceptedIds].sort();
  const candidates = [...result.verificationCandidates]
    .sort((left, right) => left.traitId.localeCompare(right.traitId))
    .map((candidate) => ({
      traitId: candidate.traitId,
      reason: candidate.reason,
      evidenceSha256: createHash("sha256").update(candidate.evidenceQuote).digest("hex"),
    }));
  assert.equal(new Set(acceptedIds).size, acceptedIds.length, `duplicate accepted id at message ${sourceIndex}`);
  assert.equal(new Set(candidates.map((candidate) => candidate.traitId)).size, candidates.length, `duplicate candidate id at message ${sourceIndex}`);
  assert.ok(
    acceptedIds.every((id) => !candidates.some((candidate) => candidate.traitId === id)),
    `accepted/candidate overlap at message ${sourceIndex}`,
  );
  for (const id of [...acceptedIds, ...candidates.map((candidate) => candidate.traitId)]) {
    const trait = TRAIT_BY_ID.get(id);
    assert.ok(trait, `unknown trait ${id} at message ${sourceIndex}`);
    assert.ok(trait.profiles.includes(assignedProfile), `profile-ineligible trait ${id} at message ${sourceIndex}`);
  }

  if (acceptedIds.length) acceptedMessages += 1;
  if (candidates.length) candidateMessages += 1;
  acceptedOccurrences += acceptedIds.length;
  candidateOccurrences += candidates.length;

  const stored = Array.isArray(message.sharedInfoIds)
    ? [...new Set(message.sharedInfoIds.filter((id): id is string => typeof id === "string"))]
    : [];
  if (stored.length) historicalStoredMessages += 1;
  historicalStoredOccurrences += stored.length;
  historicalIneligibleOccurrences += stored.filter((id) => !TRAIT_BY_ID.get(id)?.profiles.includes(assignedProfile)).length;

  behaviorRows.push(JSON.stringify({
    sourceIndex,
    role,
    contentSha256: createHash("sha256").update(content as string).digest("hex"),
    acceptedIds,
    candidates,
  }));
}

assert.ok(behaviorRows.length > 0, "trait corpus contains no humanX/humanY messages");
durations.sort((left, right) => left - right);
const percentile = (ratio: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * ratio))]!;
const behaviorSha256 = createHash("sha256").update(behaviorRows.join("\n")).digest("hex");
const summary = {
  sourceSha256,
  behaviorSha256,
  humanMessages: behaviorRows.length,
  skippedNonHumanMessages,
  acceptedMessages,
  candidateMessages,
  acceptedOccurrences,
  candidateOccurrences,
  historicalLabels: {
    storedMessages: historicalStoredMessages,
    storedOccurrences: historicalStoredOccurrences,
    profileIneligibleOccurrences: historicalIneligibleOccurrences,
    note: "Historical sharedInfoIds are audit context, not ground truth.",
  },
  latencyMs: {
    p50: Number(percentile(0.5).toFixed(3)),
    p95: Number(percentile(0.95).toFixed(3)),
    p99: Number(percentile(0.99).toFixed(3)),
    max: Number(durations.at(-1)!.toFixed(3)),
  },
};

if (!noSnapshot) {
  const snapshot = JSON.parse(
    readFileSync(new URL("./trait_extractor_corpus_snapshot.json", import.meta.url), "utf8"),
  ) as Snapshot;
  assert.equal(sourceSha256, snapshot.sourceSha256, "corpus source changed; review it before updating the snapshot");
  assert.equal(behaviorRows.length, snapshot.humanMessages, "human message count changed");
  assert.equal(behaviorSha256, snapshot.behaviorSha256, "extractor behavior changed for the corpus");
  assert.ok(summary.latencyMs.p95 <= 50, `fast-path p95 ${summary.latencyMs.p95}ms exceeds 50ms`);
}

console.log(JSON.stringify(summary, null, 2));
