// run-followup.ts — Step 54 이름 없는 팔로업 mini-judge 회귀셋.
// 케이스당 3회 호출하고 다수결(≥2/3)로 yes/no를 정한다.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { isFollowupToAlex } from "../lib/followupJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface FollowupCase {
  id: string;
  session: string;
  named: boolean;
  alex_answered: boolean;
  context: { speaker: string; text: string }[];
  expect: "yes" | "no";
}

interface FollowupFile {
  cases: FollowupCase[];
}

if (!process.env.OPENAI_API_KEY) {
  console.error("[followup] OPENAI_API_KEY not set — check server/.env");
  process.exit(1);
}

const FIXTURE_PATH = resolve(__dirname, "followup_cases.yaml");
const doc = yaml.load(readFileSync(FIXTURE_PATH, "utf8")) as FollowupFile;
const RUNS = 3;
const MIN_RECALL_RATE = 0.6;
const MAX_FALSE_POSITIVES = 5;

type Row = FollowupCase & {
  results: (boolean | null)[];
  predicted: boolean;
  matches: number;
};

const rows: Row[] = [];
console.log(
  `\n[followup] ${doc.cases.length} cases × ${RUNS} = ${doc.cases.length * RUNS} mini calls (gpt-4o-mini, temp 0)\n`,
);

for (const c of doc.cases) {
  const transcript = c.context.map((m) => ({ speaker: m.speaker, content: m.text }));
  const results: (boolean | null)[] = [];
  for (let r = 0; r < RUNS; r++) {
    results.push(await isFollowupToAlex(transcript));
  }

  const yesVotes = results.filter((v) => v === true).length;
  const predicted = yesVotes >= 2;
  const expected = c.expect === "yes";
  const matches = results.filter((v) => v === expected).length;
  rows.push({ ...c, results, predicted, matches });

  const got = results.map((v) => (v == null ? "null" : v ? "T" : "F")).join(" ");
  console.log(
    `  ${predicted === expected ? "PASS" : "MISS"} ${c.id} want=${c.expect} got=${predicted ? "yes" : "no"} [${got}]${c.named ? " named" : ""}`,
  );
}

const positives = rows.filter((r) => r.expect === "yes");
const recallHits = positives.filter((r) => r.predicted).length;
const minRecallHits = Math.ceil(positives.length * MIN_RECALL_RATE);

const verifiedNegatives = rows.filter((r) => r.expect === "no" && !r.alex_answered);
const falsePositives = verifiedNegatives.filter((r) => r.predicted).length;

const deferredNegatives = rows.filter((r) => r.expect === "no" && r.alex_answered);
const deferredYes = deferredNegatives.filter((r) => r.predicted).length;

const named = rows.filter((r) => r.named);
const namedMatches = named.filter((r) => r.predicted === (r.expect === "yes")).length;

const recallPass = recallHits >= minRecallHits;
const precisionPass = falsePositives <= MAX_FALSE_POSITIVES;

console.log("\n[followup] summary");
console.log(
  `  recall: ${recallHits}/${positives.length} ${recallPass ? "PASS" : "FAIL"} (target ≥${minRecallHits}, ${(MIN_RECALL_RATE * 100).toFixed(0)}%)`,
);
console.log(
  `  false positives: ${falsePositives}/${verifiedNegatives.length} ${precisionPass ? "PASS" : "FAIL"} (target ≤${MAX_FALSE_POSITIVES})`,
);
console.log(
  `  deferred no/alex_answered=true: ${deferredYes}/${deferredNegatives.length} predicted yes (not scored)`,
);
console.log(`  named reference: ${namedMatches}/${named.length} matched (not scored)\n`);

if (!recallPass || !precisionPass) process.exit(1);
