import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { logger } from "../lib/logger.js";
import { runGrounder, type GrounderOutput } from "../agents/agent1_grounder.js";
import { runArchitect } from "../agents/agent2_architect.js";
import { runCritic } from "../agents/agent3_critic.js";
import {
  runSupervisor,
  writeFinalYaml,
  writeFailedYaml,
  newSoftEntropyState,
  type SoftEntropyState,
} from "../agents/agent4_supervisor.js";
import { parseChecklistItem } from "../state/agentState.js";
import type { ValidatedPaper } from "../schemas/paper.schema.js";
import type { Condition, ConditionSpec } from "../schemas/prompt.schema.js";

// Per CLAUDE.md §5 / §9 Phase 3.
//
// Design note: CLAUDE.md §4.1 lists @langchain/langgraph as the orchestration
// dependency, but the actual workflow is a linear 3-node loop
//   architect -> critic -> supervisor  (-> architect, on revise)
// with no parallelism, no branching beyond the loop edge, and shared state
// that fits in a single closure. The LangGraph runtime adds significant
// surface area (channels, Annotation graph, compile step) for no signal
// gain at this shape. We therefore implement the workflow as a plain TS
// async loop. If a future revision needs cross-condition parallelism or
// out-of-order node execution, this file is the place to swap in
// StateGraph; nothing else in the repo depends on the workflow internals.

// ─────────────────────────────────────────────────────────────────
// Per-condition checklist projection.
// ─────────────────────────────────────────────────────────────────

interface ChecklistPair {
  required: string[];
  forbidden: string[];
}

function projectChecklists(
  condition: Condition,
  full: GrounderOutput["checklists"],
): { status: ChecklistPair; strategy: ChecklistPair } {
  const status = condition.startsWith("leader")
    ? { required: full.leader_required, forbidden: full.leader_forbidden }
    : { required: full.peer_required, forbidden: full.peer_forbidden };
  const strategy = condition.endsWith("xai")
    ? { required: full.xai_required, forbidden: full.xai_forbidden }
    : { required: full.aci_required, forbidden: full.aci_forbidden };
  return { status, strategy };
}

// ─────────────────────────────────────────────────────────────────
// One condition end-to-end.
// ─────────────────────────────────────────────────────────────────

export interface BuildOneResult {
  condition: Condition;
  status: "passed" | "failed_max_iterations";
  outputPath: string;
  loopIterations: number;
  finalScores: {
    status_target: number;
    status_opposite: number;
    strategy_target: number;
    strategy_opposite: number;
  };
}

export async function buildOneCondition(args: {
  condition: Condition;
  kb: ValidatedPaper[];
  grounderOutput: GrounderOutput;
}): Promise<BuildOneResult> {
  const { condition, kb, grounderOutput } = args;
  const { status, strategy } = projectChecklists(condition, grounderOutput.checklists);

  // Minor-version bump: if a prior YAML exists for this condition, bump
  // its minor version (1.0.x → 1.1.0) for the new build's iteration 0.
  // Per CLAUDE.md §4.3, minor bumps reflect intentional content shifts.
  // Subsequent in-build revisions still increment patch as usual.
  const initialVersion = readBumpedInitialVersion(condition);

  let spec: ConditionSpec | undefined;
  let diffFeedback: string | undefined;
  let loopCount = 0;
  const softEntropy: SoftEntropyState = newSoftEntropyState();
  const MAX_LOOPS = 10;

  while (loopCount < MAX_LOOPS) {
    logger.info({ condition, loop: loopCount }, "workflow.iteration_start");

    spec = await runArchitect({
      condition,
      kb,
      statusChecklist: status,
      strategyChecklist: strategy,
      ...(spec ? { previousDraft: spec } : {}),
      ...(diffFeedback ? { criticFeedback: diffFeedback } : {}),
      ...(initialVersion ? { initialVersion } : {}),
    });

    const critic = await runCritic({ spec, loopIteration: loopCount });
    const decision = runSupervisor({ spec, critic, loopCount, softEntropy });

    if (decision.kind === "passed") {
      const path = writeFinalYaml(spec, critic, loopCount, softEntropy);
      logger.info({ condition, path, loop_count: loopCount }, "workflow.passed");
      return {
        condition,
        status: "passed",
        outputPath: path,
        loopIterations: loopCount + 1,
        finalScores: critic.scores,
      };
    }
    if (decision.kind === "halt_failed") {
      const path = writeFailedYaml(spec, critic, loopCount, softEntropy);
      logger.error({ condition, path, loop_count: loopCount }, "workflow.failed_max_iterations");
      return {
        condition,
        status: "failed_max_iterations",
        outputPath: path,
        loopIterations: loopCount + 1,
        finalScores: critic.scores,
      };
    }
    // kind === "revise"
    diffFeedback = decision.diffFeedback;
    loopCount += 1;
  }

  // Unreachable: the supervisor's loop_count guard halts before we get here.
  throw new Error(`workflow.runaway: loop_count exceeded ${MAX_LOOPS}`);
}

// ─────────────────────────────────────────────────────────────────
// All four conditions.
// ─────────────────────────────────────────────────────────────────

export async function buildAllConditions(args: {
  kb: ValidatedPaper[];
}): Promise<{
  grounderOutput: GrounderOutput;
  results: BuildOneResult[];
}> {
  // Grounder once, results shared across the 4 conditions (CLAUDE.md §7.2).
  const grounderOutput = await runGrounder(args.kb);

  // Surface the audit notes immediately so the user sees Grounder's reads.
  if (grounderOutput.audit_notes.trim().length > 0) {
    logger.info({ audit_notes: grounderOutput.audit_notes }, "workflow.grounder_audit");
  }

  // Per CLAUDE.md §15.14: build sequentially, not in parallel, for the first
  // pass — Architect lessons from one condition shouldn't be lost via shared
  // rate limits and ordering ambiguity.
  const conditions: Condition[] = ["leader_xai", "leader_aci", "peer_xai", "peer_aci"];
  const results: BuildOneResult[] = [];
  for (const condition of conditions) {
    const r = await buildOneCondition({ condition, kb: args.kb, grounderOutput });
    results.push(r);
  }
  return { grounderOutput, results };
}

// Convenience for parsing checklist items (re-exported so scripts can render
// the checklist for debugging without importing from state/).
export { parseChecklistItem };

// ─────────────────────────────────────────────────────────────────
// Minor-version-bump helper.
// ─────────────────────────────────────────────────────────────────

function readBumpedInitialVersion(condition: Condition): string | undefined {
  const path = resolve(process.cwd(), `core_prompts/${condition}_specification.yaml`);
  if (!existsSync(path)) return undefined;
  try {
    const raw = yaml.load(readFileSync(path, "utf8")) as { version?: string } | null;
    const v = raw?.version;
    if (!v || !/^\d+\.\d+\.\d+$/.test(v)) return undefined;
    const parts = v.split(".").map(Number);
    const next = `${parts[0]}.${(parts[1] ?? 0) + 1}.0`;
    logger.info({ condition, prior: v, next }, "workflow.minor_version_bump");
    return next;
  } catch (e) {
    logger.warn({ condition, err: String(e) }, "workflow.minor_version_bump.read_failed");
    return undefined;
  }
}
