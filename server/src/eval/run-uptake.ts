import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { judgeQuestionUptake } from "../lib/questionUptakeJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS = 3;

interface UptakeCase {
  id: string;
  desc: string;
  question: string;
  responses: Array<{ seq: number; speaker: string; text: string }>;
  eligibleTraitIds: string[];
  expect: {
    decision: "contribute" | "acknowledge" | "silent";
    evidence?: string;
    evidenceOneOf?: string[];
    selectedTraitId?: string | null;
  };
}

const file = yaml.load(readFileSync(resolve(__dirname, "uptake_cases.yaml"), "utf8")) as {
  cases: UptakeCase[];
};

let passed = 0;
console.log(`\n[uptake] ${file.cases.length} cases × ${RUNS}\n`);
for (const testCase of file.cases) {
  const results = [];
  for (let run = 0; run < RUNS; run += 1) {
    results.push(
      await judgeQuestionUptake({
        question: testCase.question,
        responseCluster: testCase.responses.map((response) => ({
          seq: response.seq,
          speaker: response.speaker,
          content: response.text,
        })),
        eligibleTraitIds: testCase.eligibleTraitIds,
      }),
    );
  }
  const matchCount = results.filter((result) => {
    if (!result.ok || result.decision.decision !== testCase.expect.decision) return false;
    if (testCase.expect.evidence && result.decision.evidence !== testCase.expect.evidence) {
      return false;
    }
    if (
      testCase.expect.evidenceOneOf &&
      !testCase.expect.evidenceOneOf.includes(result.decision.evidence)
    ) {
      return false;
    }
    if (
      testCase.expect.selectedTraitId !== undefined &&
      result.decision.selectedTraitId !== testCase.expect.selectedTraitId
    ) {
      return false;
    }
    return true;
  }).length;
  const pass = matchCount >= 2;
  if (pass) passed += 1;
  console.log(
    `  ${pass ? "PASS" : "FAIL"} ${testCase.id} ${testCase.desc} (${matchCount}/${RUNS})`,
  );
  console.log(
    `       ${results
      .map((result) =>
        result.ok
          ? `${result.decision.decision}:${result.decision.evidence}:${result.decision.selectedTraitId ?? "none"}`
          : `error:${result.error}`,
      )
      .join(" | ")}`,
  );
}

console.log(`\n[uptake] ${passed}/${file.cases.length} passed.\n`);
if (passed < file.cases.length) process.exit(1);
