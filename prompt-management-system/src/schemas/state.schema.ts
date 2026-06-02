import { z } from "zod";
import { ConditionEnum, ConditionSpecSchema } from "./prompt.schema.js";
import { ValidatedPaperSchema } from "./paper.schema.js";

// Per CLAUDE.md §6.4.
// The single AgentState shape passed through the LangGraph workflow.
// Reducers in src/state/agentState.ts compose deltas onto this shape.

export const MockChatTurnSchema = z
  .object({
    turn: z.number().int().min(0),
    speaker: z.enum(["human_1", "human_2", "ai"]),
    content: z.string(),
  })
  .strict();

export const EvaluationScoresSchema = z
  .object({
    status_target: z.number().min(1).max(7),
    status_opposite: z.number().min(1).max(7),
    strategy_target: z.number().min(1).max(7),
    strategy_opposite: z.number().min(1).max(7),
  })
  .strict();

export type EvaluationScores = z.infer<typeof EvaluationScoresSchema>;

export const AgentStateSchema = z
  .object({
    // Phase 2 artifacts.
    seed_paper_list: z.array(z.unknown()),
    search_keywords: z.array(z.string()),
    candidate_paper_pool: z.array(z.unknown()),
    validated_knowledge_base: z.array(ValidatedPaperSchema),

    // Phase 3 working state.
    current_condition: ConditionEnum,
    linguistic_checklist: z
      .record(z.string(), z.array(z.string()))
      .optional(),
    prompt_draft: ConditionSpecSchema.optional(),
    mock_chat_log: z.array(MockChatTurnSchema).default([]),
    evaluation_scores: EvaluationScoresSchema.optional(),
    loop_count: z.number().int().min(0).default(0),
    pass_threshold: z.number().default(4.5),
  })
  .strict();

export type AgentState = z.infer<typeof AgentStateSchema>;
