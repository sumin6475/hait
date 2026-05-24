//프롬프트,모델 파라미터 변경 시 응답 패턴을 빠르게 확인하기 위한 평가 스크립트
//DB/Socket.IO 미사용 - buildSystemPrompt, buildUserPrompt + callAIStructured만 호출
//실행 : npm run eval -- C1 [C2 C3 C4] 기본값 C1
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSystemPrompt, buildUserPromptFromMessages } from "../lib/prompts.js";
import { callAIStructured } from "../lib/openai.js";
import type { ConditionCode } from "../types.js";

//=== 시나리오 정의 ===
type Scenario = {
  id: string;
  label: string;
  history: { sender: string; content: string }[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "empty",
    label: "Empty discussion (just entered)",
    history: [],
  },
  {
    id: "early_consensus",
    label: "Early consensus on Candidate C (after 3 turns)",
    history: [
      { sender: "humanX", content: "I think C looks strongest to me." },
      { sender: "humanY", content: "Agreed, C seems solid." },
      { sender: "humanX", content: "Yeah let's go with C then." },
    ],
  },
  {
    id: "long_silence",
    label: "One participant dominates, others silent",
    history: [
      { sender: "humanX", content: "I've been thinking about Candidate A's spatial awareness." },
      { sender: "humanX", content: "And A also seems very well organized." },
      { sender: "humanX", content: "So I'm leaning toward A. Does anyone else have thoughts?" },
      { sender: "humanX", content: "..." },
    ],
  },
];
//=== CLI 인자 파싱 ===
const VALID_CONDITIONS = ["C1", "C2", "C3", "C4"] as const;
type EvalCondition = (typeof VALID_CONDITIONS)[number];

function parseConditions(): EvalCondition[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return ["C1"]; //기본값

  const valid = args.filter((a): a is EvalCondition =>
    VALID_CONDITIONS.includes(a as EvalCondition),
  );
  const invalid = args.filter((a) => !VALID_CONDITIONS.includes(a as EvalCondition));

  if (invalid.length > 0) {
    console.warn(`⚠️  ignored invalid args: ${invalid.join(", ")}`);
  }
  if (valid.length === 0) {
    console.error("Usage: npm run eval -- C1 [C2 C3 C4]");
    process.exit(1);
  }
  return valid;
}
//=== 한 (시나리오, 조건) 조합 실행 ===
type EvalResult = {
  scenarioId: string;
  condition: EvalCondition;
  ok: boolean;
  content?: string;
  contentLength?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  systemFingerprint?: string | null;
  reason?: string;
  error?: string;
};

async function runOne(scenario: Scenario, condition: EvalCondition): Promise<EvalResult> {
  const systemPrompt = buildSystemPrompt(condition as ConditionCode);
  const userPrompt = buildUserPromptFromMessages(scenario.history);
  const result = await callAIStructured({
    systemPrompt,
    userPrompt,
    timeoutMs: 30_000,
  });

  if (result.ok) {
    return {
      scenarioId: scenario.id,
      condition,
      ok: true,
      content: result.parsed.content,
      contentLength: result.parsed.content.length,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      systemFingerprint: result.systemFingerprint,
    };
  } else {
    return {
      scenarioId: scenario.id,
      condition,
      ok: false,
      reason: result.reason,
      error: result.error,
    };
  }
}
//=== 메인 ===
async function main() {
  const conditions = parseConditions();
  console.log(`[eval] conditions: ${conditions.join(", ")}`);
  console.log(`[eval] scenarios: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  console.log(`[eval] total calls: ${SCENARIOS.length * conditions.length}\n`);

  const results: EvalResult[] = [];

  for (const condition of conditions) {
    for (const scenario of SCENARIOS) {
      process.stdout.write(`▶ ${condition} × ${scenario.id} ... `);
      const r = await runOne(scenario, condition);
      results.push(r);
      if (r.ok) {
        console.log(`✅ ${r.contentLength}ch / ${r.latencyMs}ms`);
        console.log(`   ${r.content}\n`);
      } else {
        console.log(`❌ ${r.reason}`);
        console.log(`   ${r.error}\n`);
      }
    }
  }
  //=== JSON 저장 ===
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), "eval-results");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `eval-${timestamp}.json`);

  await writeFile(
    outPath,
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        conditions,
        scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label })),
        results,
      },
      null,
      2,
    ),
  );

  console.log(`[eval] saved: ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[eval] unhandled error:", err);
  process.exit(1);
});
