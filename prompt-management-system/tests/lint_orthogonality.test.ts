import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { ConditionSpecSchema } from "../src/schemas/prompt.schema.js";

// Per CLAUDE.md §14.2.
// XAI condition must not use facilitative-questioning vocabulary.
// ACI condition must not use contrastive-explanation vocabulary.
// Banlists live in config/lint_rules.yaml.

const ROOT = resolve(import.meta.dirname, "..");
const PROMPTS = join(ROOT, "core_prompts");

interface LintRules {
  xai_forbidden_vocab: string[];
  aci_forbidden_vocab: string[];
}

function loadRules(): LintRules {
  return yaml.load(readFileSync(join(ROOT, "config/lint_rules.yaml"), "utf8")) as LintRules;
}

function renderedText(spec: { prompt_components: { text: string }[] }): string {
  return spec.prompt_components.map((c) => c.text).join("\n");
}

describe("orthogonality lint", () => {
  if (!existsSync(PROMPTS) || readdirSync(PROMPTS).filter((f) => f.endsWith(".yaml")).length === 0) {
    it.skip("no condition YAMLs yet (Phase 3 has not been run)", () => {});
    return;
  }

  const rules = loadRules();
  const files = readdirSync(PROMPTS).filter(
    (f) => f.endsWith(".yaml") && !f.includes(".FAILED."),
  );

  for (const f of files) {
    const raw = yaml.load(readFileSync(join(PROMPTS, f), "utf8")) as Record<string, unknown>;
    delete raw._audit;
    const spec = ConditionSpecSchema.parse(raw);
    const text = renderedText(spec).toLowerCase();
    const strategy = spec.manipulation_check_alignment.strategy_perception_target;
    const banlist =
      strategy === "xai" ? rules.xai_forbidden_vocab : rules.aci_forbidden_vocab;

    it(`${f} (${strategy.toUpperCase()}) contains no forbidden cross-strategy vocab`, () => {
      // Word-boundary match so "task" doesn't trigger a hit for "ask".
      const hits = banlist.filter((tok) => {
        const re = new RegExp(`\\b${tok.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        return re.test(text);
      });
      expect(hits, `forbidden tokens in ${f}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
