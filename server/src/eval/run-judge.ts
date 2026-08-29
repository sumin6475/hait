// run-judge.ts — judge(개입 게이트) 회귀셋 러너.
// judgeIntervention의 분류 출력(speak + reason)만 대조한다. golden(생성된 Alex 턴)과 별개 —
// 여기선 AI 발화를 생성하지 않는다. judge가 조용히 망가지는 걸 잡는 그물(tripwire).
// 판정: 케이스당 ×3 호출, ≥2/3 일치면 PASS. 하나라도 FAIL이면 exit(1) (CI용).
import "dotenv/config"; // server/.env 의 OPENAI_API_KEY 로드
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { judgeIntervention } from "../lib/interventionJudge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JudgeCase {
  id: string;
  desc: string;
  msgs_since_alex: number;
  context: { speaker: string; text: string }[];
  expect: { speak: boolean; reason?: string };
}
interface JudgeFile {
  cases: JudgeCase[];
}

// ── 환경 가드 ──────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error("[judge] OPENAI_API_KEY not set — check server/.env");
  process.exit(1);
}

// ── 로드 ──────────────────────────────────────────────────────
const FIXTURE_PATH = resolve(__dirname, "judge_cases.yaml");
const doc = yaml.load(readFileSync(FIXTURE_PATH, "utf8")) as JudgeFile;

const RUNS = 3; // mini 흔들림 흡수 — 케이스당 ×3, ≥2 일치면 pass
console.log(
  `\n[judge] ${doc.cases.length} cases × ${RUNS} = ${doc.cases.length * RUNS} mini calls (gpt-4o-mini, temp 0)\n`,
);

// ── 실행 ──────────────────────────────────────────────────────
let passed = 0;
for (const c of doc.cases) {
  const transcript = c.context.map((m) => ({ speaker: m.speaker, content: m.text }));

  const results: ({ speak: boolean; reason: string } | null)[] = [];
  for (let r = 0; r < RUNS; r++) {
    const decision = await judgeIntervention(transcript, c.msgs_since_alex);
    // Keep the historical report shape while the runtime uses the V2 three-way decision.
    results.push(
      decision
        ? { speak: decision.decision !== "silent", reason: decision.evidence }
        : null,
    );
  }

  // 한 호출 match: null(파싱실패/타임아웃)은 non-match. speak 항상 대조, reason은 expect에 있을 때만.
  const matches = results.filter(
    (d) =>
      d != null &&
      d.speak === c.expect.speak &&
      (c.expect.reason === undefined || d.reason === c.expect.reason),
  ).length;
  const pass = matches >= 2;
  if (pass) passed++;

  const got = results.map((d) => (d == null ? "null" : `${d.speak ? "T" : "F"}:${d.reason}`)).join(" ");
  const want = `speak=${c.expect.speak}${c.expect.reason ? ` reason=${c.expect.reason}` : ""}`;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(3)} ${c.desc}`);
  console.log(`        want ${want} · got [${got}] (${matches}/${RUNS})`);
}

// ── 요약 ──────────────────────────────────────────────────────
const total = doc.cases.length;
console.log(`\n[judge] ${passed}/${total} passed.\n`);
if (passed < total) process.exit(1);
