import { z } from "zod";

// Per CLAUDE.md §6.1 and §6.2.
// Authoritative schemas. Do NOT bypass (CLAUDE.md §15.9).

export const ThemeAnchorEnum = z.enum([
  "status_characteristics_theory",
  "information_asymmetry_model",
  "biased_information_sampling",
  "contrastive_explanation",
  "facilitative_questioning",
  "nudge_choice_architecture",
  "proactive_intervention",
  "common_ground_calculation",
]);

export const PromptComponentSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z_]+_\d{2}$/,
        "id must be snake_case + 2-digit suffix, e.g. status_setup_01",
      ),
    text: z
      .string()
      .min(20, "text must be substantive (>=20 chars)")
      .max(2000),
    rationale: z
      .string()
      .min(
        30,
        "rationale must explain the theoretical mechanism, not restate text",
      ),
    citations: z
      .array(z.string())
      .min(1, "every component requires at least one citation"),
    theory_anchor: ThemeAnchorEnum.optional(),
  })
  .strict();

export type PromptComponent = z.infer<typeof PromptComponentSchema>;

export const ConditionEnum = z.enum([
  "leader_xai",
  "leader_aci",
  "peer_xai",
  "peer_aci",
]);

export type Condition = z.infer<typeof ConditionEnum>;

export const ConditionSpecSchema = z
  .object({
    condition: ConditionEnum,
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    last_updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    prompt_components: z.array(PromptComponentSchema).min(3),
    manipulation_check_alignment: z
      .object({
        status_perception_target: z.enum(["leader", "peer"]),
        strategy_perception_target: z.enum(["xai", "aci"]),
      })
      .strict(),
  })
  .strict();

export type ConditionSpec = z.infer<typeof ConditionSpecSchema>;
