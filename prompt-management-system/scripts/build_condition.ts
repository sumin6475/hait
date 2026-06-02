// Phase 3 entry point — build ONE condition end-to-end.
// Usage: pnpm run build:condition <condition>
//   e.g. pnpm run build:condition leader_xai
// Per CLAUDE.md §10.

import { buildOneCondition } from "../src/graph/workflow.js";
import { runGrounder } from "../src/agents/agent1_grounder.js";
import { logger } from "../src/lib/logger.js";
import { loadKnowledgeBase, preflight, loadDotEnv } from "./_shared.js";
import type { Condition } from "../src/schemas/prompt.schema.js";

const VALID: Condition[] = ["leader_xai", "leader_aci", "peer_xai", "peer_aci"];

function parseArg(): Condition {
  const a = process.argv[2];
  if (!a || !VALID.includes(a as Condition)) {
    throw new Error(
      `Usage: pnpm run build:condition <${VALID.join("|")}> (got: ${a ?? "<missing>"})`,
    );
  }
  return a as Condition;
}

async function main(): Promise<void> {
  loadDotEnv();
  preflight();
  const condition = parseArg();
  const kb = loadKnowledgeBase();
  logger.info({ condition, kb_size: kb.length }, "build_condition.start");

  // Grounder runs once even for one condition — it emits all 8 arrays, and
  // the projection downstream picks the two relevant pairs. (Cost: one
  // Sonnet call regardless of condition count.)
  const grounderOutput = await runGrounder(kb);

  const r = await buildOneCondition({ condition, kb, grounderOutput });
  logger.info(r, "build_condition.done");
}

main().catch((e) => {
  logger.error({ err: String(e), stack: e?.stack }, "build_condition.failed");
  process.exit(1);
});
