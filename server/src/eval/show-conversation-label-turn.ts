import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}

const sessionCode = argument("--session");
const replaySeq = Number(argument("--replay-seq"));
if (!Number.isInteger(replaySeq) || replaySeq <= 0) {
  throw new Error("--replay-seq must be a positive integer");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDirectory, "../../..");
const manifestPath = resolve(
  workspaceRoot,
  "eval-results/conversation-architecture/corpus-manifest.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  entries: Array<{ sessionCode: string; inputPath: string; inputSha256: string }>;
};
const entry = manifest.entries.find((candidate) => candidate.sessionCode === sessionCode);
if (!entry) throw new Error(`Unknown corpus session ${sessionCode}`);
const inputText = readFileSync(resolve(workspaceRoot, entry.inputPath), "utf8");
if (sha256(inputText) !== entry.inputSha256) throw new Error("Input hash mismatch");
const input = JSON.parse(inputText) as {
  participants: Array<{ role: string }>;
  messages: Array<{
    originalSeq: number;
    replaySeq: number;
    senderRole: string;
    content: string;
    createdAt?: string;
  }>;
};
const trigger = input.messages.find((message) => message.replaySeq === replaySeq);
if (!trigger || trigger.senderRole === "ai") {
  throw new Error(`Replay sequence ${replaySeq} is not a human trigger`);
}

const blindPacket = {
  packetVersion: "conversation-blind-label-turn-v1",
  sessionCode,
  participantRoster: ["alex", ...input.participants.map((participant) => participant.role)],
  sequenceMeaning: "replaySeq",
  currentTrigger: { replaySeq: trigger.replaySeq, originalSeq: trigger.originalSeq },
  transcriptThroughTrigger: input.messages
    .filter((message) => message.replaySeq <= replaySeq)
    .map(({ replaySeq: seq, originalSeq, senderRole, content, createdAt }) => ({
      replaySeq: seq,
      originalSeq,
      senderRole,
      content,
      ...(createdAt ? { createdAt } : {}),
    })),
  blindedFields: [
    "future_transcript",
    "deployed_baseline",
    "new_controller_output",
    "condition_code",
    "lane",
  ],
};

console.log(JSON.stringify(blindPacket, null, 2));

