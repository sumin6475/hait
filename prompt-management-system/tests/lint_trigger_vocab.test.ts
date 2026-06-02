import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { ConditionSpecSchema } from "../src/schemas/prompt.schema.js";

// Per CLAUDE.md §3.3, §8.4.
// Trigger vocabulary (timing, cadence, scheduling) MUST NOT appear in
// the RENDERED prompt content. The renderer uses `component.text`; the
// `rationale` field is audit-only documentation that never reaches the
// AI, so we scan only `text`. (Rationales legitimately reference "pass
// threshold" / "stagnation window" as meta-vocabulary about the build
// pipeline itself — those references are scoping, not directives.)

const ROOT = resolve(import.meta.dirname, "..");
const PROMPTS = join(ROOT, "core_prompts");

function loadBanlist(): string[] {
  const r = yaml.load(readFileSync(join(ROOT, "config/lint_rules.yaml"), "utf8")) as {
    trigger_vocab_banlist: string[];
  };
  return r.trigger_vocab_banlist;
}

describe("trigger vocabulary lint", () => {
  if (!existsSync(PROMPTS) || readdirSync(PROMPTS).filter((f) => f.endsWith(".yaml")).length === 0) {
    it.skip("no condition YAMLs yet (Phase 3 has not been run)", () => {});
    return;
  }

  const banlist = loadBanlist();
  const files = readdirSync(PROMPTS).filter(
    (f) => f.endsWith(".yaml") && !f.includes(".FAILED."),
  );

  for (const f of files) {
    it(`${f} contains no trigger vocabulary in prompt content`, () => {
      const raw = yaml.load(readFileSync(join(PROMPTS, f), "utf8")) as Record<string, unknown>;
      delete raw._audit;
      const spec = ConditionSpecSchema.parse(raw);
      const promptContent = spec.prompt_components
        .map((c) => c.text)
        .join("\n")
        .toLowerCase();
      const hits = banlist.filter((tok) => {
        const re = new RegExp(`\\b${tok.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        return re.test(promptContent);
      });
      expect(hits, `trigger tokens in ${f}: ${hits.join(", ")}`).toEqual([]);
    });
  }
});
