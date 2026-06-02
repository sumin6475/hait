// Phase 3 entry point — build ALL FOUR conditions sequentially.
// Usage: pnpm run build:all
// Per CLAUDE.md §10, §15.14.

import { buildAllConditions } from "../src/graph/workflow.js";
import { logger } from "../src/lib/logger.js";
import { loadKnowledgeBase, preflight, loadDotEnv } from "./_shared.js";

async function main(): Promise<void> {
  loadDotEnv();
  preflight();
  const kb = loadKnowledgeBase();
  logger.info({ kb_size: kb.length }, "build_all.start");

  const { results } = await buildAllConditions({ kb });

  const summary = results.map((r) => ({
    condition: r.condition,
    status: r.status,
    loops: r.loopIterations,
    scores: r.finalScores,
    path: r.outputPath,
  }));
  logger.info({ summary }, "build_all.done");

  const failed = results.filter((r) => r.status === "failed_max_iterations");
  if (failed.length > 0) {
    logger.warn(
      { failed_conditions: failed.map((r) => r.condition) },
      "build_all.partial_failure: see *_specification.FAILED.yaml for audit logs",
    );
    process.exit(2); // non-fatal exit so CI can branch on it
  }
}

main().catch((e) => {
  logger.error({ err: String(e), stack: e?.stack }, "build_all.failed");
  process.exit(1);
});
