import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callAgent } from "../llm/anthropic.js";
import { logger } from "../lib/logger.js";
import {
  ConditionSpecSchema,
  type ConditionSpec,
  type Condition,
} from "../schemas/prompt.schema.js";
import type { ValidatedPaper } from "../schemas/paper.schema.js";

// Per CLAUDE.md §7.3. Architect produces ONE ConditionSpec per call.
// Iterates with the Critic via Supervisor's diff feedback.

const ROOT = resolve(process.cwd());
const SYSTEM_PROMPT = readFileSync(resolve(ROOT, "src/prompts/agent2.system.md"), "utf8");

// ─────────────────────────────────────────────────────────────────
// Tool schema.
// ─────────────────────────────────────────────────────────────────

const ComponentInputSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+_\d{2}$/),
    text: z.string().min(20).max(2000),
    rationale: z.string().min(30),
    citations: z.array(z.string()).min(1),
    theory_anchor: z.string().optional(),
  })
  .strict();

const ToolInputSchema = z
  .object({
    condition: z.enum(["leader_xai", "leader_aci", "peer_xai", "peer_aci"]),
    prompt_components: z.array(ComponentInputSchema).min(3),
    manipulation_check_alignment: z
      .object({
        status_perception_target: z.enum(["leader", "peer"]),
        strategy_perception_target: z.enum(["xai", "aci"]),
      })
      .strict(),
  })
  .strict();

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_condition_spec",
  description: "Emit one ConditionSpec for the current condition.",
  input_schema: {
    type: "object",
    properties: {
      condition: { type: "string", enum: ["leader_xai", "leader_aci", "peer_xai", "peer_aci"] },
      prompt_components: {
        type: "array",
        minItems: 3,
        items: {
          type: "object",
          properties: {
            id: { type: "string", pattern: "^[a-z_]+_\\d{2}$" },
            text: { type: "string", minLength: 20, maxLength: 2000 },
            rationale: { type: "string", minLength: 30 },
            citations: { type: "array", items: { type: "string" }, minItems: 1 },
            theory_anchor: {
              type: "string",
              enum: [
                "status_characteristics_theory",
                "information_asymmetry_model",
                "biased_information_sampling",
                "contrastive_explanation",
                "facilitative_questioning",
                "nudge_choice_architecture",
                "proactive_intervention",
                "common_ground_calculation",
              ],
            },
          },
          required: ["id", "text", "rationale", "citations"],
        },
      },
      manipulation_check_alignment: {
        type: "object",
        properties: {
          status_perception_target: { type: "string", enum: ["leader", "peer"] },
          strategy_perception_target: { type: "string", enum: ["xai", "aci"] },
        },
        required: ["status_perception_target", "strategy_perception_target"],
      },
    },
    required: ["condition", "prompt_components", "manipulation_check_alignment"],
  },
};

// ─────────────────────────────────────────────────────────────────
// Public entry.
// ─────────────────────────────────────────────────────────────────

export interface ArchitectInput {
  condition: Condition;
  kb: ValidatedPaper[];
  /** Strings from AgentState.linguistic_checklist for the two relevant dimensions. */
  statusChecklist: { required: string[]; forbidden: string[] };
  strategyChecklist: { required: string[]; forbidden: string[] };
  /** If revising: previous draft + Critic's feedback. */
  previousDraft?: ConditionSpec;
  criticFeedback?: string;
  /**
   * Version to stamp on iteration 0 of THIS build. If omitted, defaults to
   * "1.0.0" (cold start). Used to perform minor-version bumps when an
   * existing on-disk spec is being intentionally replaced — caller reads
   * the prior file, bumps minor, and passes the result here.
   */
  initialVersion?: string;
}

export async function runArchitect(input: ArchitectInput): Promise<ConditionSpec> {
  logger.info({ condition: input.condition, revising: !!input.criticFeedback }, "architect.start");

  const cacheablePrefix = buildCacheablePrefix(input.kb);
  const agentInstructions = buildAgentInstructions(input);
  const userMsg = buildUserMessage(input);

  const resp = await callAgent({
    role: "architect",
    cacheablePrefix,
    agentInstructions,
    messages: [{ role: "user", content: userMsg }],
    tools: [EMIT_TOOL],
  });

  const block = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_condition_spec");
  if (!block || block.type !== "tool_use") {
    throw new Error("Architect did not return an emit_condition_spec tool call");
  }
  const parsed = ToolInputSchema.parse(block.input);
  if (parsed.condition !== input.condition) {
    throw new Error(
      `Architect emitted condition=${parsed.condition} but was asked for ${input.condition}`,
    );
  }

  // Validate every citation against the KB.
  const validKeys = new Set(input.kb.map((p) => p.citation_key));
  const unresolved: { id: string; key: string }[] = [];
  for (const c of parsed.prompt_components) {
    for (const k of c.citations) if (!validKeys.has(k)) unresolved.push({ id: c.id, key: k });
  }
  if (unresolved.length > 0) {
    throw new Error(
      `Architect emitted unresolved citations: ${JSON.stringify(unresolved)} — per CLAUDE.md §3.7 this halts the pipeline.`,
    );
  }

  // Confirm the critical guardrail is present and last.
  const lastIdx = parsed.prompt_components.length - 1;
  const last = parsed.prompt_components[lastIdx];
  if (!last || last.id !== "critical_guardrail_99") {
    logger.warn(
      { last_id: last?.id ?? null },
      "architect.missing_critical_guardrail (will be defensively rendered from common_framework)",
    );
  }

  // Hand off to the Zod ConditionSpec parser so downstream stays strict.
  const version = input.previousDraft
    ? bumpPatch(input.previousDraft.version)
    : input.initialVersion ?? "1.0.0";
  const spec: ConditionSpec = ConditionSpecSchema.parse({
    condition: parsed.condition,
    version,
    last_updated: new Date().toISOString().slice(0, 10),
    prompt_components: parsed.prompt_components,
    manipulation_check_alignment: parsed.manipulation_check_alignment,
  });

  logger.info({ condition: spec.condition, components: spec.prompt_components.length }, "architect.done");
  return spec;
}

// ─────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────

function buildCacheablePrefix(kb: ValidatedPaper[]): string {
  const cf = readFileSync(resolve(ROOT, "config/common_framework.yaml"), "utf8");
  const kbBlock = kb
    .map(
      (p) =>
        `- ${p.citation_key} (${p.source_tier}): ${p.full_citation}\n  insight: ${p.actionable_insight}`,
    )
    .join("\n");
  return [
    SYSTEM_PROMPT,
    "",
    "## Validated Knowledge Base",
    "Use ONLY these citation_keys. Exact-match strings.",
    "",
    kbBlock,
    "",
    "## Frozen common_framework.yaml (reference — critical_rules text lives here)",
    "```yaml",
    cf,
    "```",
  ].join("\n");
}

function buildAgentInstructions(input: ArchitectInput): string {
  const lines = [
    `Compose the prompt for condition: ${input.condition}.`,
    "",
    "Relevant checklists (Grounder output):",
    "",
    "### Status — required behaviors",
    ...input.statusChecklist.required.map((s) => `- ${s}`),
    "",
    "### Status — forbidden behaviors",
    ...input.statusChecklist.forbidden.map((s) => `- ${s}`),
    "",
    "### Strategy — required behaviors",
    ...input.strategyChecklist.required.map((s) => `- ${s}`),
    "",
    "### Strategy — forbidden behaviors",
    ...input.strategyChecklist.forbidden.map((s) => `- ${s}`),
  ];
  return lines.join("\n");
}

function buildUserMessage(input: ArchitectInput): string {
  if (!input.previousDraft || !input.criticFeedback) {
    return `Produce the initial ConditionSpec for ${input.condition}. Call emit_condition_spec exactly once.`;
  }
  const prev = JSON.stringify(input.previousDraft, null, 2);
  return [
    `Revise the ConditionSpec for ${input.condition}.`,
    "",
    "## Previous draft",
    "```json",
    prev,
    "```",
    "",
    "## Critic diff feedback",
    input.criticFeedback,
    "",
    "Modify the components named in the diff. Preserve other component ids and content unless the diff calls for restructuring. Call emit_condition_spec exactly once.",
  ].join("\n");
}

function bumpPatch(v: string): string {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "1.0.0";
  const major = m[1]!;
  const minor = m[2]!;
  const patch = String(Number(m[3]!) + 1);
  return `${major}.${minor}.${patch}`;
}
