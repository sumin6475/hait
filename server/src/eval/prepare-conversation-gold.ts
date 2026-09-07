import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONVERSATION_GOLD_REVIEW_SELECTOR_VERSION,
  CONVERSATION_GOLD_SCHEMA_VERSION,
} from "./conversationGold.js";

interface CorpusManifestEntry {
  sessionCode: string;
  conditionCode: "C1" | "C2" | "C3" | "C4";
  lane: "development" | "holdout";
  inputPath: string;
  inputSha256: string;
}

interface CorpusInput {
  messages: Array<{
    originalSeq: number;
    replaySeq: number;
    senderRole: string;
  }>;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDirectory, "../..");
const workspaceRoot = resolve(serverRoot, "..");
const manifestPath = resolve(
  workspaceRoot,
  process.argv[2] ?? "eval-results/conversation-architecture/corpus-manifest.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  entries: CorpusManifestEntry[];
};
const labelsRoot = resolve(workspaceRoot, "eval-results/conversation-architecture/labels");
mkdirSync(labelsRoot, { recursive: true });

let created = 0;
let preserved = 0;
for (const entry of manifest.entries) {
  const inputText = readFileSync(resolve(workspaceRoot, entry.inputPath), "utf8");
  if (sha256(inputText) !== entry.inputSha256) {
    throw new Error(`Input hash mismatch for ${entry.sessionCode}`);
  }
  const input = JSON.parse(inputText) as CorpusInput;
  const outputPath = resolve(labelsRoot, `${entry.sessionCode}.gold.json`);
  if (existsSync(outputPath)) {
    preserved += 1;
    continue;
  }
  const scaffold = {
    schemaVersion: CONVERSATION_GOLD_SCHEMA_VERSION,
    reviewSelectorVersion: CONVERSATION_GOLD_REVIEW_SELECTOR_VERSION,
    status: "draft",
    sessionCode: entry.sessionCode,
    lane: entry.lane,
    conditionCode: entry.conditionCode,
    inputPath: relative(workspaceRoot, resolve(workspaceRoot, entry.inputPath)),
    inputSha256: entry.inputSha256,
    sequenceMeaning: "replaySeq",
    turns: input.messages
      .filter((message) => message.senderRole !== "ai")
      .map((message) => ({
        replaySeq: message.replaySeq,
        originalSeq: message.originalSeq,
        reviewSamplingKey: sha256(
          `${CONVERSATION_GOLD_REVIEW_SELECTOR_VERSION}:${entry.conditionCode}:${entry.sessionCode}:${message.replaySeq}`,
        ),
        initial: null,
        reviewer: null,
        final: null,
      })),
  };
  writeFileSync(outputPath, `${JSON.stringify(scaffold, null, 2)}\n`);
  created += 1;
}

console.log(
  `[conversation-gold] created ${created} blind-review scaffolds; preserved ${preserved} existing files in ${labelsRoot}`,
);

