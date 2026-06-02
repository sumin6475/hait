import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { logger } from "../lib/logger.js";
import type { ConditionSpec } from "../schemas/prompt.schema.js";
import type { CriticResult } from "./agent3_critic.js";
import { formatDiffForArchitect } from "./agent3_critic.js";

// Per CLAUDE.md §7.5. Pure-TS logic; no LLM call. See agent4.system.md
// for the contract this implementation honors.

const ROOT = resolve(process.cwd());

// ─────────────────────────────────────────────────────────────────
// Thresholds loaded from config/thresholds.yaml (single source of truth).
// ─────────────────────────────────────────────────────────────────

interface Thresholds {
  pass_threshold: number;
  opposite_max: number;
  loop_limit: number;
  soft_entropy_stagnation_window: number;
  soft_entropy_min_improvement: number;
  soft_entropy_decay: number;
}

let cachedThresholds: Thresholds | null = null;
function loadThresholds(): Thresholds {
  if (cachedThresholds) return cachedThresholds;
  cachedThresholds = yaml.load(
    readFileSync(resolve(ROOT, "config/thresholds.yaml"), "utf8"),
  ) as Thresholds;
  return cachedThresholds;
}

// ─────────────────────────────────────────────────────────────────
// Decision types.
// ─────────────────────────────────────────────────────────────────

export type Sub =
  | "status_target"
  | "status_opposite"
  | "strategy_target"
  | "strategy_opposite";

export interface SoftEntropyState {
  // Per sub-scale: history of scores across iterations.
  history: Record<Sub, number[]>;
  // Sub-scales whose threshold has already been loosened (one-time only).
  loosened: Partial<Record<Sub, number>>;
}

export function newSoftEntropyState(): SoftEntropyState {
  return {
    history: {
      status_target: [],
      status_opposite: [],
      strategy_target: [],
      strategy_opposite: [],
    },
    loosened: {},
  };
}

export type SupervisorDecision =
  | { kind: "passed"; auditedSpec: ConditionSpec }
  | { kind: "revise"; diffFeedback: string }
  | { kind: "halt_failed" };

export interface SupervisorInput {
  spec: ConditionSpec;
  critic: CriticResult;
  loopCount: number;
  softEntropy: SoftEntropyState;
}

// ─────────────────────────────────────────────────────────────────
// Public entry.
// ─────────────────────────────────────────────────────────────────

export function runSupervisor(input: SupervisorInput): SupervisorDecision {
  const t = loadThresholds();

  // Update history.
  for (const k of ["status_target", "status_opposite", "strategy_target", "strategy_opposite"] as const) {
    input.softEntropy.history[k].push(input.critic.scores[k]);
  }

  // Apply per-sub-scale threshold loosening (Soft Entropy).
  applySoftEntropy(input.softEntropy, t);

  // Decide pass using (possibly loosened) thresholds.
  const passed = decidePass(input.critic.scores, input.softEntropy, t);
  if (passed) {
    logger.info(
      { condition: input.spec.condition, scores: input.critic.scores, loop_count: input.loopCount },
      "supervisor.passed",
    );
    return { kind: "passed", auditedSpec: input.spec };
  }

  // Else: route back or halt.
  if (input.loopCount + 1 < t.loop_limit) {
    const diff = formatDiffForArchitect(input.critic);
    logger.info(
      { condition: input.spec.condition, loop_count: input.loopCount, scores: input.critic.scores },
      "supervisor.revise",
    );
    return { kind: "revise", diffFeedback: diff };
  }

  logger.error(
    { condition: input.spec.condition, loop_count: input.loopCount, scores: input.critic.scores },
    "supervisor.failed_max_iterations",
  );
  return { kind: "halt_failed" };
}

// ─────────────────────────────────────────────────────────────────
// Output writers.
// ─────────────────────────────────────────────────────────────────

export function writeFinalYaml(
  spec: ConditionSpec,
  critic: CriticResult,
  loopCount: number,
  softEntropy: SoftEntropyState,
): string {
  const path = resolve(ROOT, `core_prompts/${spec.condition}_specification.yaml`);
  mkdirSync(dirname(path), { recursive: true });
  const out = {
    ...spec,
    _audit: {
      generated_at: new Date().toISOString(),
      loop_iterations: loopCount + 1,
      final_scores: critic.scores,
      pass_criteria_used: passCriteriaSnapshot(softEntropy),
      soft_entropy_loosened: softEntropy.loosened,
      critic_rationale: critic.rationale,
      transcript_turn_count: critic.transcript.length,
    },
  };
  writeFileSync(path, yaml.dump(out, { lineWidth: 100, noRefs: true, sortKeys: false }), "utf8");
  return path;
}

export function writeFailedYaml(
  spec: ConditionSpec,
  critic: CriticResult,
  loopCount: number,
  softEntropy: SoftEntropyState,
): string {
  const path = resolve(ROOT, `core_prompts/${spec.condition}_specification.FAILED.yaml`);
  mkdirSync(dirname(path), { recursive: true });
  const out = {
    ...spec,
    _audit: {
      generated_at: new Date().toISOString(),
      status: "FAILED_MAX_ITERATIONS",
      loop_iterations: loopCount + 1,
      final_scores: critic.scores,
      pass_criteria_used: passCriteriaSnapshot(softEntropy),
      soft_entropy_loosened: softEntropy.loosened,
      critic_rationale: critic.rationale,
      score_history: softEntropy.history,
    },
  };
  writeFileSync(path, yaml.dump(out, { lineWidth: 100, noRefs: true, sortKeys: false }), "utf8");
  return path;
}

// ─────────────────────────────────────────────────────────────────
// Internals.
// ─────────────────────────────────────────────────────────────────

function decidePass(
  scores: CriticResult["scores"],
  softEntropy: SoftEntropyState,
  t: Thresholds,
): boolean {
  const targetMin = (sub: Sub) => softEntropy.loosened[sub] ?? t.pass_threshold;
  const oppositeMax = (sub: Sub) =>
    softEntropy.loosened[sub] !== undefined
      ? t.opposite_max + (t.pass_threshold - softEntropy.loosened[sub]!)
      : t.opposite_max;
  return (
    scores.status_target >= targetMin("status_target") &&
    scores.status_opposite <= oppositeMax("status_opposite") &&
    scores.strategy_target >= targetMin("strategy_target") &&
    scores.strategy_opposite <= oppositeMax("strategy_opposite")
  );
}

function applySoftEntropy(state: SoftEntropyState, t: Thresholds): void {
  // For each target sub-scale, check the last `window` iterations for
  // stagnation. If under-improvement is consistent, loosen once.
  for (const sub of ["status_target", "strategy_target"] as const) {
    if (state.loosened[sub] !== undefined) continue;
    const h = state.history[sub];
    if (h.length < t.soft_entropy_stagnation_window + 1) continue;
    const window = h.slice(-1 - t.soft_entropy_stagnation_window);
    let stagnant = true;
    for (let i = 1; i < window.length; i++) {
      const delta = (window[i]! - window[i - 1]!);
      if (delta >= t.soft_entropy_min_improvement) {
        stagnant = false;
        break;
      }
    }
    if (stagnant) {
      const loosened = Math.max(1, t.pass_threshold - t.soft_entropy_decay);
      state.loosened[sub] = loosened;
      logger.warn(
        { sub, window, loosened, reason: "consecutive_stagnation" },
        "supervisor.soft_entropy_applied",
      );
    }
  }
}

function passCriteriaSnapshot(softEntropy: SoftEntropyState): Record<string, number> {
  const t = loadThresholds();
  return {
    pass_threshold_default: t.pass_threshold,
    opposite_max_default: t.opposite_max,
    status_target_used: softEntropy.loosened.status_target ?? t.pass_threshold,
    strategy_target_used: softEntropy.loosened.strategy_target ?? t.pass_threshold,
  };
}
