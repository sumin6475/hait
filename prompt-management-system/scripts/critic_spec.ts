// scripts/critic_spec.ts
// ─────────────────────────────────────────────────────────────────
// STANDALONE CRITIC — 디스크의 (직접 수정한) spec을 build_all 없이 채점.
//   core_prompts/<cond>_specification.yaml 을 그대로 읽어 runCritic 실행.
//   Architect/Grounder를 안 거치므로 손수정이 덮어써지지 않음.
//
// 사용법 (PMS 폴더 안에서):
//   pnpm tsx scripts/critic_spec.ts                  # 4조건 전부
//   pnpm tsx scripts/critic_spec.ts leader_xai       # 특정 조건만
//   pnpm tsx scripts/critic_spec.ts leader_xai 3     # 반복 3회(노이즈 완화)
//
// ⚠️ runCritic 내부 runSimulator는 OUTPUT_DISCIPLINE을 안 붙임(= 기존 Critic과
//    동일, _audit과 비교 가능). HAIT 런타임은 discipline 포함이라 절대값엔
//    fidelity gap 존재(P4). 지금은 before/after를 "같은 조건"으로 비교하는 게
//    목적이라 이대로 둔다.
// ─────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { ConditionSpecSchema, type Condition } from "../src/schemas/prompt.schema.js";
import { runCritic } from "../src/agents/agent3_critic.js";

// Minimal .env loader (PMS 컨벤션 — dotenv 의존성 추가 안 함, scout.ts와 동일)
function loadDotEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  for (const rawLine of readFileSync(p, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv(); // ← key 읽기 (가드보다 먼저)

const ALL: Condition[] = ["leader_xai", "leader_aci", "peer_xai", "peer_aci"];

// CLI: [condition?] [iterations?]
const argCond = process.argv[2] as Condition | undefined;
const iters = Number(process.argv[3] ?? 1);
const conditions = argCond ? [argCond] : ALL;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[critic] ANTHROPIC_API_KEY not set — check .env");
  process.exit(1);
}

function loadSpec(cond: Condition) {
  const path = resolve(process.cwd(), `core_prompts/${cond}_specification.yaml`);
  const raw = yaml.load(readFileSync(path, "utf8")) as Record<string, unknown>;
  const { _audit, ...specCore } = raw; // export_to_hait와 동일: parse 전에 _audit 제거
  return ConditionSpecSchema.parse(specCore);
}

interface Row {
  condition: Condition;
  iter: number;
  status_target: number;
  status_opposite: number;
  strategy_target: number;
  strategy_opposite: number;
  passed: boolean;
}

const rows: Row[] = [];

for (const cond of conditions) {
  const spec = loadSpec(cond);
  for (let i = 0; i < iters; i++) {
    process.stdout.write(`  [critic] ${cond} iter ${i} … `);
    const r = await runCritic({ spec, loopIteration: i });
    rows.push({
      condition: cond,
      iter: i,
      status_target: r.scores.status_target,
      status_opposite: r.scores.status_opposite,
      strategy_target: r.scores.strategy_target,
      strategy_opposite: r.scores.strategy_opposite,
      passed: r.passed,
    });
    console.log(
      `status ${r.scores.status_target}/${r.scores.status_opposite}  ` +
        `strategy ${r.scores.strategy_target}/${r.scores.strategy_opposite}  ` +
        `${r.passed ? "PASS" : "FAIL"}`,
    );
  }
}

// 요약 (조건별 평균 — iters>1일 때 노이즈 완화)
console.log("\n[critic] summary (target↑ ≥4.5 good, opposite↓ ≤3.0 good)");
console.log("  cond         st_tgt st_opp str_tgt str_opp  pass");
for (const cond of conditions) {
  const rs = rows.filter((r) => r.condition === cond);
  const avg = (k: keyof Row) =>
    (rs.reduce((s, r) => s + (r[k] as number), 0) / rs.length).toFixed(1);
  const passN = rs.filter((r) => r.passed).length;
  console.log(
    `  ${cond.padEnd(12)} ${avg("status_target").padStart(5)} ${avg("status_opposite").padStart(6)} ` +
      `${avg("strategy_target").padStart(6)} ${avg("strategy_opposite").padStart(7)}  ${passN}/${rs.length}`,
  );
}

// 기록 (before/after 비교용)
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = resolve(process.cwd(), "critic_runs");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `critic_${ts}.json`);
writeFileSync(outPath, JSON.stringify({ ts, iters, rows }, null, 2), "utf8");
console.log(`\n[critic] saved: ${outPath}`);
