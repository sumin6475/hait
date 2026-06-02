import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import type { ConditionSpec } from "../schemas/prompt.schema.js";

// Per CLAUDE.md §3.6, §8, common_framework.yaml.injection_dock.
// Compile order (rendered into the AI teammate's system prompt):
//   1. task_environment
//   2. ground_truth_dataset
//   3. system_constraints
//   4. agent_calling_model
//   5. <condition.prompt_components in array order>
//   6. critical_rules.ratio_rule WRAPPED IN [CRITICAL SYSTEM RULE] (LAST for recency)

// ─────────────────────────────────────────────────────────────────
// Frozen common framework loader.
// ─────────────────────────────────────────────────────────────────

interface CommonFramework {
  task_environment: {
    scenario_label: string;
    agent_persona_name: string;
    task_summary: string;
  };
  ground_truth_dataset: {
    profile_label: string;
    optimal_candidate: string;
    optimal_candidate_rationale: string;
    candidates: Record<string, {
      positive_count: number;
      negative_count: number;
      positive_traits: string[];
      negative_traits: string[];
    }>;
  };
  system_constraints: { text: string };
  critical_rules: {
    ratio_rule: {
      wrap_with_tag_open: string;
      wrap_with_tag_close: string;
      text: string;
    };
  };
  agent_calling_model: { text: string };
}

let cachedFramework: CommonFramework | null = null;

export function loadCommonFramework(): CommonFramework {
  if (cachedFramework) return cachedFramework;
  const path = resolve(process.cwd(), "config/common_framework.yaml");
  cachedFramework = yaml.load(readFileSync(path, "utf8")) as CommonFramework;
  return cachedFramework;
}

// ─────────────────────────────────────────────────────────────────
// Renderers for each compile-order block.
// ─────────────────────────────────────────────────────────────────

function renderTaskEnvironment(cf: CommonFramework): string {
  const te = cf.task_environment;
  return [
    `# Task Environment`,
    `Scenario: ${te.scenario_label}`,
    `You are the assistant named ${te.agent_persona_name}.`,
    te.task_summary.trim(),
  ].join("\n");
}

function renderGroundTruth(cf: CommonFramework): string {
  const gt = cf.ground_truth_dataset;
  const lines: string[] = [
    `# Your Information Set (Profile ${gt.profile_label})`,
    `You hold only Profile ${gt.profile_label}. Other team members hold complementary information.`,
    ``,
  ];
  for (const c of ["A", "B", "C", "D"] as const) {
    const cand = gt.candidates[c];
    if (!cand) continue;
    lines.push(`Candidate ${c}:`);
    lines.push(`  ${cand.positive_count} of the positive traits of Candidate ${c} are:`);
    for (const t of cand.positive_traits) lines.push(`    + ${t}`);
    lines.push(`  ${cand.negative_count} of the negative traits of Candidate ${c} are:`);
    for (const t of cand.negative_traits) lines.push(`    - ${t}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function renderSystemConstraints(cf: CommonFramework): string {
  return `# System Constraints\n${cf.system_constraints.text.trim()}`;
}

function renderAgentCallingModel(cf: CommonFramework): string {
  return `# Calling Model\n${cf.agent_calling_model.text.trim()}`;
}

const CRITICAL_GUARDRAIL_ID = "critical_guardrail_99";

function renderConditionComponents(spec: ConditionSpec, cf: CommonFramework): string {
  const lines = [`# Behavioral Specification (${spec.condition})`, ``];
  for (const c of spec.prompt_components) {
    if (c.id === CRITICAL_GUARDRAIL_ID) {
      // Architect-emitted critical guardrail: wrap at render time per
      // CLAUDE.md §3.6 / §14.7. The YAML on disk stores the unwrapped text
      // so the audit trail is clean.
      const r = cf.critical_rules.ratio_rule;
      lines.push(r.wrap_with_tag_open);
      lines.push(c.text.trim());
      lines.push(r.wrap_with_tag_close);
    } else {
      lines.push(c.text.trim());
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function renderCriticalRulesFallback(cf: CommonFramework): string {
  // Safety net: rendered only when the spec omits critical_guardrail_99.
  const r = cf.critical_rules.ratio_rule;
  return [
    "# [defensive] critical_guardrail_99 missing from spec — rendering common_framework fallback",
    r.wrap_with_tag_open,
    r.text.trim(),
    r.wrap_with_tag_close,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Public entry — compile the AI teammate's full system prompt.
// ─────────────────────────────────────────────────────────────────

export function compileSystemPrompt(spec: ConditionSpec): string {
  const cf = loadCommonFramework();
  const hasGuardrail = spec.prompt_components.some((c) => c.id === CRITICAL_GUARDRAIL_ID);
  const blocks = [
    renderTaskEnvironment(cf),
    renderGroundTruth(cf),
    renderSystemConstraints(cf),
    renderAgentCallingModel(cf),
    renderConditionComponents(spec, cf),
  ];
  if (!hasGuardrail) blocks.push(renderCriticalRulesFallback(cf));
  return blocks.join("\n\n");
}
