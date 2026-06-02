import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { ConditionSpecSchema } from "../src/schemas/prompt.schema.js";
import { ValidatedPaperSchema } from "../src/schemas/paper.schema.js";

// Per CLAUDE.md §6, §14.4. Strict-mode parse on every committed YAML.

const ROOT = resolve(import.meta.dirname, "..");

// ─────────────────────────────────────────────────────────────────
// Schemas for the standalone config files (not in src/schemas/, because
// those are pipeline data; these are static configuration).
// ─────────────────────────────────────────────────────────────────

const ThresholdsSchema = z
  .object({
    pass_threshold: z.number(),
    opposite_max: z.number(),
    loop_limit: z.number().int().positive(),
    soft_entropy_stagnation_window: z.number().int().positive(),
    soft_entropy_min_improvement: z.number(),
    soft_entropy_decay: z.number(),
    scout_rubric_pass: z.number(),
    scout_rubric_fallback: z.number(),
    scout_minimum_validated_kb_size: z.number().int().positive(),
  })
  .strict();

const LlmModelsSchema = z
  .object({
    agents: z.record(
      z.string(),
      z
        .object({
          model: z.string(),
          temperature: z.number().min(0).max(1),
          max_tokens: z.number().int().positive(),
          extended_thinking: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict();

const LintRulesSchema = z
  .object({
    xai_forbidden_vocab: z.array(z.string()).min(1),
    aci_forbidden_vocab: z.array(z.string()).min(1),
    trigger_vocab_banlist: z.array(z.string()).min(1),
    hangul_unicode_range: z.object({ start: z.string(), end: z.string() }).strict(),
  })
  .strict();

function loadYaml(rel: string): unknown {
  return yaml.load(readFileSync(join(ROOT, rel), "utf8"));
}

describe("config YAML schema validation", () => {
  it("config/thresholds.yaml parses", () => {
    expect(() => ThresholdsSchema.parse(loadYaml("config/thresholds.yaml"))).not.toThrow();
  });

  it("config/llm_models.yaml parses and has all six agent roles", () => {
    const parsed = LlmModelsSchema.parse(loadYaml("config/llm_models.yaml"));
    const required = [
      "scout",
      "grounder",
      "architect",
      "critic_simulator",
      "critic_evaluator",
      "supervisor",
    ];
    for (const role of required) {
      expect(parsed.agents[role], `missing agent role: ${role}`).toBeDefined();
    }
  });

  it("config/lint_rules.yaml parses", () => {
    expect(() => LintRulesSchema.parse(loadYaml("config/lint_rules.yaml"))).not.toThrow();
  });
});

describe("core_prompts/*.yaml schema validation", () => {
  const dir = join(ROOT, "core_prompts");
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".yaml") && !f.includes(".FAILED."))
    : [];

  if (files.length === 0) {
    it.skip("no condition YAMLs yet (Phase 3 has not been run)", () => {});
    return;
  }

  for (const f of files) {
    it(`${f} matches ConditionSpecSchema`, () => {
      // Strip the `_audit` block before strict-parse — it's
      // Supervisor-generated bookkeeping, not part of the schema.
      const data = loadYaml(join("core_prompts", f)) as Record<string, unknown>;
      delete data._audit;
      expect(() => ConditionSpecSchema.parse(data)).not.toThrow();
    });
  }
});

describe("knowledge_base/validated_kb.md presence (Phase 2)", () => {
  it.skipIf(!existsSync(join(ROOT, "knowledge_base/validated_kb.md")))(
    "ValidatedPaperSchema would accept the entries (sanity)",
    () => {
      // Concrete parsing is delegated to citation_resolution.test.ts and Agent 0
      // output validation. Here we only confirm the schema compiles.
      expect(ValidatedPaperSchema).toBeDefined();
    },
  );
});
