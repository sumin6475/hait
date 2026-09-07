// run-judge.ts — V2 Main Judge 회귀셋 러너.
// judgeIntervention의 three-way decision + evidence만 대조한다. golden(생성된 Alex 턴)과 별개 —
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
  signal: {
    focusCandidate: "A" | "B" | "C" | "D" | null;
    exchangeClass: "substantive" | "acknowledgment" | "preference" | "procedural" | "unclear";
    privateContributionIds: string[];
  };
  expect: {
    decision: "contribute" | "acknowledge" | "silent";
    evidence?: string;
    selectedTraitId?: string | null;
  };
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

  const results: ({
    decision: "contribute" | "acknowledge" | "silent";
    evidence: string;
    selectedTraitId?: string | null;
  } | null)[] = [];
  for (let r = 0; r < RUNS; r++) {
    const decision = await judgeIntervention(transcript, c.msgs_since_alex, {
      ...c.signal,
      privateContributionAvailable: c.signal.privateContributionIds.length > 0,
    });
    results.push(decision);
  }

  // null(파싱실패/타임아웃)은 non-match. decision은 항상, optional evidence/trait는 지정 시 대조.
  const matches = results.filter(
    (d) =>
      d != null &&
      d.decision === c.expect.decision &&
      (c.expect.evidence === undefined || d.evidence === c.expect.evidence) &&
      (c.expect.selectedTraitId === undefined ||
        (d.selectedTraitId ?? null) === c.expect.selectedTraitId),
  ).length;
  const pass = matches >= 2;
  if (pass) passed++;

  const got = results
    .map((d) => (d == null ? "null" : `${d.decision}:${d.evidence}:${d.selectedTraitId ?? "none"}`))
    .join(" ");
  const want =
    `decision=${c.expect.decision}` +
    (c.expect.evidence ? ` evidence=${c.expect.evidence}` : "") +
    (c.expect.selectedTraitId !== undefined
      ? ` selected=${c.expect.selectedTraitId ?? "none"}`
      : "");
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${c.id.padEnd(3)} ${c.desc}`);
  console.log(`        want ${want} · got [${got}] (${matches}/${RUNS})`);
}

// ── 요약 ──────────────────────────────────────────────────────
const total = doc.cases.length;
console.log(`\n[judge] ${passed}/${total} passed.\n`);
if (passed < total) process.exit(1);
