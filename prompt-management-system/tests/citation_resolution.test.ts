import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { ConditionSpecSchema } from "../src/schemas/prompt.schema.js";

// Per CLAUDE.md §3.7, §14.1.
// Every citation in every prompt_component must EXACTLY match a citation_key
// in knowledge_base/validated_kb.md. No fuzzy matching.

const ROOT = resolve(import.meta.dirname, "..");
const KB = join(ROOT, "knowledge_base/validated_kb.md");
const PROMPTS = join(ROOT, "core_prompts");

// Extract citation_keys from validated_kb.md. The markdown structure is
// produced by Agent 0; we expect each entry to have a heading or YAML
// frontmatter containing `citation_key:`. For Phase 1 (KB not yet built),
// this test self-skips.
function extractCitationKeys(md: string): Set<string> {
  const keys = new Set<string>();
  for (const m of md.matchAll(/citation_key:\s*([A-Za-z]+(?:EtAl)?_\d{4})/g)) {
    if (m[1]) keys.add(m[1]);
  }
  return keys;
}

describe("citation resolution", () => {
  if (!existsSync(KB)) {
    it.skip("validated_kb.md not yet built (Phase 2 has not been run)", () => {});
    return;
  }
  if (
    !existsSync(PROMPTS) ||
    readdirSync(PROMPTS).filter((f) => f.endsWith(".yaml")).length === 0
  ) {
    it.skip("no condition YAMLs yet (Phase 3 has not been run)", () => {});
    return;
  }

  const kbKeys = extractCitationKeys(readFileSync(KB, "utf8"));
  const files = readdirSync(PROMPTS).filter(
    (f) => f.endsWith(".yaml") && !f.includes(".FAILED."),
  );

  it("validated_kb.md exposes at least one citation_key", () => {
    expect(kbKeys.size).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f}: every citation resolves to a validated_kb entry`, () => {
      const raw = yaml.load(readFileSync(join(PROMPTS, f), "utf8")) as Record<string, unknown>;
      delete raw._audit;
      const spec = ConditionSpecSchema.parse(raw);
      const unresolved: { component_id: string; citation: string }[] = [];
      for (const c of spec.prompt_components) {
        for (const cite of c.citations) {
          if (!kbKeys.has(cite)) {
            unresolved.push({ component_id: c.id, citation: cite });
          }
        }
      }
      expect(unresolved, `unresolved citations: ${JSON.stringify(unresolved)}`).toEqual([]);
    });
  }
});
