// run-golden.ts — Stage A: generate one Alex turn per (case × condition), record baseline.
// 채점 없음. "현재 프롬프트가 각 상황에서 실제로 뭘 내놓나"를 찍는 게 목적.
import "dotenv/config"; // server/.env 의 OPENAI_API_KEY 로드
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  buildSystemPromptForTask,
  buildUserPromptFromMessages,
  buildClosingPrompt,
} from "../lib/prompts.js";
import { callAIStructured } from "../lib/openai.js";
import { computeCue, type SpeakingReason } from "../lib/computeCue.js";
import type { ConditionCode } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 픽스처 조건명 → HAIT ConditionCode (IRB 확정; export_to_hait.ts와 동일) ──
//   C1=peer_xai  C2=leader_xai  C3=peer_aci  C4=leader_aci
const NAME_TO_CODE: Record<string, ConditionCode> = {
  peer_xai: "C1",
  leader_xai: "C2",
  peer_aci: "C3",
  leader_aci: "C4",
};

type ConditionName = keyof typeof NAME_TO_CODE;
type AppliesTo = "all" | "leader" | "peer";

interface GoldenCase {
  id: string;
  applies_to: AppliesTo;
  phase?: "main" | "closing";
  goal: number | null;
  context: { speaker: string; text: string }[];
  illustrative?: Record<string, string>;
}
interface GoldenFile {
  _global: { conditions: ConditionName[] };
  cases: GoldenCase[];
}

// ── 환경 가드 ──────────────────────────────────────────────────
if (!process.env.OPENAI_API_KEY) {
  console.error("[golden] OPENAI_API_KEY not set — check server/.env");
  process.exit(1);
}

// ── 로드 ──────────────────────────────────────────────────────
const FIXTURE_PATH = resolve(__dirname, "golden_cases.yaml");
const doc = yaml.load(readFileSync(FIXTURE_PATH, "utf8")) as GoldenFile;

function conditionsFor(c: GoldenCase): ConditionName[] {
  const all = doc._global.conditions;
  if (c.applies_to === "all") return all;
  return all.filter((cond) => cond.startsWith(c.applies_to));
}

// ── 실행 ──────────────────────────────────────────────────────
interface Row {
  caseId: string;
  goal: number | null;
  phase: "main" | "closing";
  condition: ConditionName;
  code: ConditionCode;
  cue: SpeakingReason;
  ok: boolean;
  output: string; // 생성된 턴 또는 실패 사유
  latencyMs: number;
}

const rows: Row[] = [];
let modelUsed = "gpt-5-mini"; // 실제 실행된 모델로 루프에서 덮어씀 (기록 정합성)
const plan = doc.cases.flatMap((c) => conditionsFor(c).map((cond) => ({ c, cond })));
console.log(
  `\n[golden] ${doc.cases.length} cases → ${plan.length} run pairs. model=${modelUsed} (no chaining)\n`,
);

let i = 0;
for (const { c, cond } of plan) {
  i++;
  const code = NAME_TO_CODE[cond];
  const phase = c.phase ?? "main";

  const msgs = c.context.map((m) => ({ sender: m.speaker, content: m.text })); // {speaker,text} → {sender,content}
  const cue = computeCue({ messages: msgs, phase }); // Step 3/A: speaking reason 계산 (기록용 유지)
  let systemPrompt: string;
  let userPrompt: string;
  if (phase === "closing") {
    systemPrompt = buildClosingPrompt(code); // ← Step 4/A: 전용 closing 프롬프트
    userPrompt = buildUserPromptFromMessages(msgs); // cue 미주입(전용 프롬프트)
  } else {
    systemPrompt = buildSystemPromptForTask(code, cue); // Step 12: cue를 시스템 끝 스니펫으로 (라이브와 동일 조립)
    userPrompt = buildUserPromptFromMessages(msgs); // reason head 제거 (task cue는 시스템에)
  }

  const res = await callAIStructured({ systemPrompt, userPrompt }); // previousResponseId 미전달(= 케이스 독립)
  modelUsed = res.model; // 실제 호출에 쓰인 모델명 (리포트 기록용)
  const ok = res.ok;
  const output = res.ok ? res.parsed.content : `[FAIL: ${res.reason}] ${res.error}`;
  const latencyMs = res.ok ? res.latencyMs : 0;

  rows.push({ caseId: c.id, goal: c.goal, phase, condition: cond, code, cue, ok, output, latencyMs });
  console.log(
    `  [${String(i).padStart(2)}/${plan.length}] ${c.id.padEnd(11)} ${cond.padEnd(10)} (${code}) cue=${cue} ${ok ? "ok" : "FAIL"} ${latencyMs}ms`,
  );
}

// ── 리포트 작성 (.md 사람용 + .json 기계용) ────────────────────
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(__dirname, "out");
mkdirSync(outDir, { recursive: true });

const byId = new Map<string, Row[]>();
for (const r of rows) (byId.get(r.caseId) ?? byId.set(r.caseId, []).get(r.caseId)!).push(r);

let md = `# Golden Baseline — ${ts}\n\n`;
md += `model: ${modelUsed} (no chaining) · cases: ${doc.cases.length} · run pairs: ${rows.length}\n\n`;
md += `> "actual" = current prompt's output. "hint" = fixture illustrative (DRAFT, not a target).\n\n`;
for (const c of doc.cases) {
  const rs = byId.get(c.id) ?? [];
  md += `## ${c.id} — goal ${c.goal} — phase ${c.phase ?? "main"} — cue ${rs[0]?.cue ?? "?"}\n\n`;
  md += `**context:**\n`;
  for (const m of c.context) md += `- ${m.speaker}: ${m.text}\n`;
  md += `\n`;
  for (const r of rs) {
    md += `### ${r.condition} (${r.code})${r.ok ? "" : " — FAIL"}\n`;
    md += `- **actual:** ${r.output}\n`;
    const hint = c.illustrative?.[r.condition];
    if (hint) md += `- _hint:_ ${hint}\n`;
    md += `\n`;
  }
}

const mdPath = resolve(outDir, `baseline_${ts}.md`);
const jsonPath = resolve(outDir, `baseline_${ts}.json`);
writeFileSync(mdPath, md, "utf8");
writeFileSync(
  jsonPath,
  JSON.stringify({ ts, model: modelUsed, rows }, null, 2),
  "utf8",
);

const fails = rows.filter((r) => !r.ok).length;
console.log(`\n[golden] done. ${rows.length - fails}/${rows.length} ok, ${fails} failed.`);
console.log(`[golden] report: ${mdPath}`);
console.log(`[golden] json:   ${jsonPath}\n`);
