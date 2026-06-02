import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callAgent } from "../llm/anthropic.js";
import { logger } from "../lib/logger.js";
import { compileSystemPrompt } from "../lib/compile_prompt.js";
import type { ConditionSpec } from "../schemas/prompt.schema.js";

// Per CLAUDE.md §7.4 and §14.5. Two SEPARATE Anthropic calls:
//   A. Naive Simulator (not told it will be scored) — produces transcript.
//   B. External Evaluator — scores transcript against manipulation_checks.

const ROOT = resolve(process.cwd());
const FULL_SYSTEM = readFileSync(resolve(ROOT, "src/prompts/agent3.system.md"), "utf8");

// Split the file into the two sub-role sections so we can send only one half.
const SUBROLE_A = extractSection(FULL_SYSTEM, "Sub-role A — Naive Simulator");
const SUBROLE_B = extractSection(FULL_SYSTEM, "Sub-role B — External Evaluator");

function extractSection(text: string, headingFragment: string): string {
  const ix = text.indexOf(headingFragment);
  if (ix < 0) throw new Error(`Could not find heading '${headingFragment}' in agent3.system.md`);
  const start = text.lastIndexOf("\n## ", ix) >= 0 ? text.lastIndexOf("\n## ", ix) + 1 : ix;
  const nextHeading = text.indexOf("\n## ", ix + headingFragment.length);
  return text.slice(start, nextHeading >= 0 ? nextHeading : text.length).trim();
}

// ─────────────────────────────────────────────────────────────────
// Sub-role A — Simulator tool.
// ─────────────────────────────────────────────────────────────────

const TurnSchema = z
  .object({
    turn: z.number().int().min(1),
    speaker: z.enum(["human_1", "human_2", "ai"]),
    content: z.string().min(1),
  })
  .strict();

const TranscriptToolInputSchema = z
  .object({
    turns: z.array(TurnSchema).min(6),
  })
  .strict();

const TRANSCRIPT_TOOL: Anthropic.Tool = {
  name: "emit_transcript",
  description: "Emit the simulated 6+ turn discussion transcript.",
  input_schema: {
    type: "object",
    properties: {
      turns: {
        type: "array",
        minItems: 6,
        items: {
          type: "object",
          properties: {
            turn: { type: "integer", minimum: 1 },
            speaker: { type: "string", enum: ["human_1", "human_2", "ai"] },
            content: { type: "string", minLength: 1 },
          },
          required: ["turn", "speaker", "content"],
        },
      },
    },
    required: ["turns"],
  },
};

// ─────────────────────────────────────────────────────────────────
// Sub-role B — Evaluator tool.
// ─────────────────────────────────────────────────────────────────

const DiffEntrySchema = z
  .object({
    component_id: z.string(),
    dimension: z.enum(["status_target", "status_opposite", "strategy_target", "strategy_opposite"]),
    observation: z.string().min(5),
    suggestion: z.string().min(5),
  })
  .strict();

const EvaluationToolInputSchema = z
  .object({
    status_target: z.number().min(1).max(7),
    status_opposite: z.number().min(1).max(7),
    strategy_target: z.number().min(1).max(7),
    strategy_opposite: z.number().min(1).max(7),
    diff: z.array(DiffEntrySchema).default([]),
    passed: z.boolean(),
    rationale: z.string().min(10),
  })
  .strict();

const EVAL_TOOL: Anthropic.Tool = {
  name: "emit_evaluation",
  description: "Emit per-dimension scores and diff feedback for the transcript.",
  input_schema: {
    type: "object",
    properties: {
      status_target: { type: "number", minimum: 1, maximum: 7 },
      status_opposite: { type: "number", minimum: 1, maximum: 7 },
      strategy_target: { type: "number", minimum: 1, maximum: 7 },
      strategy_opposite: { type: "number", minimum: 1, maximum: 7 },
      diff: {
        type: "array",
        items: {
          type: "object",
          properties: {
            component_id: { type: "string" },
            dimension: {
              type: "string",
              enum: ["status_target", "status_opposite", "strategy_target", "strategy_opposite"],
            },
            observation: { type: "string", minLength: 5 },
            suggestion: { type: "string", minLength: 5 },
          },
          required: ["component_id", "dimension", "observation", "suggestion"],
        },
      },
      passed: { type: "boolean" },
      rationale: { type: "string", minLength: 10 },
    },
    required: [
      "status_target",
      "status_opposite",
      "strategy_target",
      "strategy_opposite",
      "passed",
      "rationale",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// Public types.
// ─────────────────────────────────────────────────────────────────

export interface CriticResult {
  transcript: z.infer<typeof TurnSchema>[];
  scores: {
    status_target: number;
    status_opposite: number;
    strategy_target: number;
    strategy_opposite: number;
  };
  diff: z.infer<typeof DiffEntrySchema>[];
  passed: boolean;
  rationale: string;
}

export interface CriticInput {
  spec: ConditionSpec;
  /** Iteration number — used to seed Simulator variance for repeatability. */
  loopIteration: number;
}

// ─────────────────────────────────────────────────────────────────
// Public entry.
// ─────────────────────────────────────────────────────────────────

export async function runCritic(input: CriticInput): Promise<CriticResult> {
  // Stage 1 — Simulator.
  logger.info({ condition: input.spec.condition, loop: input.loopIteration }, "critic.simulator.start");
  const candidatePrompt = compileSystemPrompt(input.spec);
  const transcript = await runSimulator(candidatePrompt, input.spec.condition, input.loopIteration);
  logger.info({ turns: transcript.length }, "critic.simulator.done");

  // Stage 2 — Evaluator.
  logger.info("critic.evaluator.start");
  const evalOut = await runEvaluator(input.spec, transcript);
  logger.info({ scores: evalOut.scores, passed: evalOut.passed }, "critic.evaluator.done");

  return { transcript, ...evalOut };
}

// ─────────────────────────────────────────────────────────────────
// Simulator runner.
// ─────────────────────────────────────────────────────────────────

async function runSimulator(
  candidatePrompt: string,
  condition: string,
  loopIteration: number,
): Promise<z.infer<typeof TurnSchema>[]> {
  const cacheablePrefix = SUBROLE_A;
  const agentInstructions = [
    "Simulate the discussion using the candidate system prompt below as the",
    "*description* of how the AI teammate behaves. Two human personas exhibit",
    `shared-info bias. Seed: ${condition}_${loopIteration}.`,
    "",
    "## Candidate system prompt (governs ai's behavior)",
    "```",
    candidatePrompt,
    "```",
  ].join("\n");

  const resp = await callAgent({
    role: "critic_simulator",
    cacheablePrefix,
    agentInstructions,
    messages: [
      {
        role: "user",
        content:
          "Produce the transcript now. Call emit_transcript exactly once. Do not narrate.",
      },
    ],
    tools: [TRANSCRIPT_TOOL],
  });

  const block = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_transcript");
  if (!block || block.type !== "tool_use") {
    throw new Error("Simulator did not return an emit_transcript tool call");
  }
  return TranscriptToolInputSchema.parse(block.input).turns;
}

// ─────────────────────────────────────────────────────────────────
// Evaluator runner.
// ─────────────────────────────────────────────────────────────────

async function runEvaluator(
  spec: ConditionSpec,
  transcript: z.infer<typeof TurnSchema>[],
): Promise<Omit<CriticResult, "transcript">> {
  const cacheablePrefix = [
    SUBROLE_B,
    "",
    "## Manipulation checks (verbatim from config/manipulation_checks.yaml)",
    "```yaml",
    readFileSync(resolve(ROOT, "config/manipulation_checks.yaml"), "utf8"),
    "```",
  ].join("\n");

  const align = spec.manipulation_check_alignment;
  const targetMap = {
    status_target: align.status_perception_target,
    strategy_target: align.strategy_perception_target,
  };
  const agentInstructions = [
    `Condition under evaluation: ${spec.condition}.`,
    `Status target dimension: ${targetMap.status_target} (opposite = ${targetMap.status_target === "leader" ? "peer" : "leader"}).`,
    `Strategy target dimension: ${targetMap.strategy_target} (opposite = ${targetMap.strategy_target === "xai" ? "aci" : "xai"}).`,
    "",
    "Pass criteria: status_target >= 4.5 AND strategy_target >= 4.5 AND both opposites <= 3.0.",
    "",
    "## Candidate spec (component ids for diff feedback)",
    "```json",
    JSON.stringify(spec, null, 2),
    "```",
    "",
    "## Transcript",
    "```json",
    JSON.stringify(transcript, null, 2),
    "```",
  ].join("\n");

  const resp = await callAgent({
    role: "critic_evaluator",
    cacheablePrefix,
    agentInstructions,
    messages: [
      {
        role: "user",
        content: "Score the transcript and emit the evaluation. Call emit_evaluation exactly once.",
      },
    ],
    tools: [EVAL_TOOL],
  });

  const block = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_evaluation");
  if (!block || block.type !== "tool_use") {
    throw new Error("Evaluator did not return an emit_evaluation tool call");
  }
  const parsed = EvaluationToolInputSchema.parse(block.input);

  return {
    scores: {
      status_target: parsed.status_target,
      status_opposite: parsed.status_opposite,
      strategy_target: parsed.strategy_target,
      strategy_opposite: parsed.strategy_opposite,
    },
    diff: parsed.diff,
    passed: parsed.passed,
    rationale: parsed.rationale,
  };
}

// Re-export the diff-feedback formatter used by the Supervisor when handing
// the diff back to the Architect.
export function formatDiffForArchitect(result: CriticResult): string {
  const lines = [
    `## Critic scores`,
    `- status_target:    ${result.scores.status_target}`,
    `- status_opposite:  ${result.scores.status_opposite}`,
    `- strategy_target:  ${result.scores.strategy_target}`,
    `- strategy_opposite: ${result.scores.strategy_opposite}`,
    `- passed:           ${result.passed}`,
    ``,
    `## Rationale`,
    result.rationale,
    ``,
    `## Diff entries`,
  ];
  for (const d of result.diff) {
    lines.push(
      `- [${d.dimension}] component=${d.component_id}`,
      `  observation: ${d.observation}`,
      `  suggestion:  ${d.suggestion}`,
    );
  }
  return lines.join("\n");
}
