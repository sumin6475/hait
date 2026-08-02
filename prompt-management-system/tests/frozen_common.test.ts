import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

// Per CLAUDE.md §3.5, §13, §15.1.
// `config/common_framework.yaml` is the experimental control. Agents must
// never modify it. This test is a tripwire: when the file exists, its
// SHA-256 must match the value committed below. To update the file, the
// USER edits both the YAML and this checksum in the same commit.

const ROOT = resolve(import.meta.dirname, "..");
const FILE = resolve(ROOT, "config/common_framework.yaml");

// Tripwire value. Recorded 2026-05-26 when common_framework.yaml was first
// authored from docs/source_materials/experiment_design.md §4.4 +
// docs/source_materials/hidden_profile_dataset.pdf (Profile Z). Any change
// to the YAML requires the user to intentionally update this checksum in
// the same commit. See CLAUDE.md §13.

// Updated 2026-06-08: added cue_routing block (operational layer).
// Verbatim Common Prompt + ratio_rule UNCHANGED — only the new block added.
// Updated 2026-06-10: removed system_constraints, ratio_rule → real-time (Step 11).
// User-approved unfreeze; ratio_rule absorbs the removed block's load-bearing rules.
// Updated 2026-06-10: removed cue_routing → live per-cue snippets (Step 12).
// Per-turn cue guidance now lives in server/src/lib/prompts.ts (buildCueSnippet).
// Updated 2026-06-14 (user-approved): trimmed agent_calling_model (removed the
// "do not recap …" and "do not exhaust … in a single turn" clauses).
// Updated 2026-07-31 (Step 51 §3.1, user-approved): removed experimental vocabulary
// from task_environment (scenario_label → "choosing a pilot"; task_summary no longer
// names "Hidden Profile" / "Profile Z information set" / "the AI assistant").
const EXPECTED_SHA256: string | null =
  "3941854b0dd62fb40f249db9ca41784fa563b33b55111bd3399b89dc301c27d8";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("common_framework.yaml is frozen (tripwire)", () => {
  it("file is either absent (Phase 1, pre-source-materials) or checksum-matches", () => {
    if (!existsSync(FILE)) {
      // Phase 1 state. Skip the checksum branch.
      expect(EXPECTED_SHA256).toBeNull();
      return;
    }
    if (EXPECTED_SHA256 === null) {
      throw new Error(
        "config/common_framework.yaml exists but EXPECTED_SHA256 in tests/frozen_common.test.ts is null. " +
          "Compute and commit the checksum: " +
          `sha256(${sha256(readFileSync(FILE))})`,
      );
    }
    const actual = sha256(readFileSync(FILE));
    expect(
      actual,
      `common_framework.yaml drift. Expected ${EXPECTED_SHA256}, got ${actual}. ` +
        "If the change is intentional, update EXPECTED_SHA256 in this file.",
    ).toBe(EXPECTED_SHA256);
  });
});
