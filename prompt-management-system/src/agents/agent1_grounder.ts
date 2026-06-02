import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import yaml from "js-yaml";
import { callAgent } from "../llm/anthropic.js";
import { logger } from "../lib/logger.js";
import type { ValidatedPaper } from "../schemas/paper.schema.js";
import type { ChecklistKey, ChecklistItem } from "../state/agentState.js";
import { formatChecklistItem } from "../state/agentState.js";

// Per CLAUDE.md §7.2. Grounder runs once per build (not once per condition);
// it emits all 8 checklist arrays (4 dimensions × required/forbidden).

const ROOT = resolve(process.cwd());
const SYSTEM_PROMPT = readFileSync(resolve(ROOT, "src/prompts/agent1.system.md"), "utf8");

// ─────────────────────────────────────────────────────────────────
// Tool schema.
// ─────────────────────────────────────────────────────────────────

const ItemSchema = z
  .object({
    text: z.string().min(10),
    citations: z.array(z.string()).min(1),
  })
  .strict();

// Lenient parse — if the model omits an array we want a clear post-parse
// error, not a Zod stack trace. The min-2 invariant is enforced after.
const ToolInputSchema = z
  .object({
    leader_required: z.array(ItemSchema).default([]),
    leader_forbidden: z.array(ItemSchema).default([]),
    peer_required: z.array(ItemSchema).default([]),
    peer_forbidden: z.array(ItemSchema).default([]),
    xai_required: z.array(ItemSchema).default([]),
    xai_forbidden: z.array(ItemSchema).default([]),
    aci_required: z.array(ItemSchema).default([]),
    aci_forbidden: z.array(ItemSchema).default([]),
    audit_notes: z.string().default(""),
  })
  .strict();

const REQUIRED_KEYS = [
  "leader_required",
  "leader_forbidden",
  "peer_required",
  "peer_forbidden",
  "xai_required",
  "xai_forbidden",
  "aci_required",
  "aci_forbidden",
] as const;

const itemArraySchema = {
  type: "array",
  minItems: 2,
  items: {
    type: "object",
    properties: {
      text: { type: "string", minLength: 10 },
      citations: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["text", "citations"],
  },
};

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_checklists",
  description: "Emit eight behavioral checklists (4 dimensions × required/forbidden).",
  input_schema: {
    type: "object",
    properties: {
      leader_required: itemArraySchema,
      leader_forbidden: itemArraySchema,
      peer_required: itemArraySchema,
      peer_forbidden: itemArraySchema,
      xai_required: itemArraySchema,
      xai_forbidden: itemArraySchema,
      aci_required: itemArraySchema,
      aci_forbidden: itemArraySchema,
      audit_notes: { type: "string" },
    },
    required: [
      "leader_required",
      "leader_forbidden",
      "peer_required",
      "peer_forbidden",
      "xai_required",
      "xai_forbidden",
      "aci_required",
      "aci_forbidden",
    ],
  },
};

// ─────────────────────────────────────────────────────────────────
// Public entry.
// ─────────────────────────────────────────────────────────────────

export interface GrounderOutput {
  checklists: Record<ChecklistKey, string[]>;
  audit_notes: string;
}

export async function runGrounder(kb: ValidatedPaper[]): Promise<GrounderOutput> {
  logger.info("grounder.start");

  const cacheablePrefix = buildCacheablePrefix(kb);
  const baseInstructions = [
    "Emit all eight checklists in a single `emit_checklists` tool call.",
    "",
    "STRICT SHAPE REQUIREMENT — every one of the eight fields",
    "(leader_required, leader_forbidden, peer_required, peer_forbidden,",
    "xai_required, xai_forbidden, aci_required, aci_forbidden) MUST be a",
    "JSON ARRAY of objects with shape `{ text: string, citations: string[] }`.",
    "Never emit a single string in place of an array. Each array must have",
    "at least 2 items.",
    "",
    "Every item MUST cite at least one validated_kb key exactly as it appears",
    "in the prefix above. Misspellings will be rejected downstream.",
  ].join("\n");

  const callOnce = async (extraNote?: string) =>
    callAgent({
      role: "grounder",
      cacheablePrefix,
      agentInstructions: extraNote ? `${baseInstructions}\n\n${extraNote}` : baseInstructions,
      messages: [
        {
          role: "user",
          content:
            "Produce the eight checklists now. Each field must be a JSON array of {text, citations} objects, never a string.",
        },
      ],
      tools: [EMIT_TOOL],
    });

  // First attempt.
  let resp = await callOnce();
  let parsed: z.infer<typeof ToolInputSchema> | null = null;
  let block = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_checklists");
  if (block && block.type === "tool_use") {
    try {
      parsed = ToolInputSchema.parse(block.input);
    } catch (e) {
      logger.warn({ err: String(e).slice(0, 400) }, "grounder.parse_failed.retrying");
    }
  }

  // One retry with explicit shape feedback.
  if (!parsed) {
    resp = await callOnce(
      "RETRY: your previous response was rejected because one of the eight required fields was not a JSON array of {text, citations} objects. Try again, paying special attention to the array shape of EVERY field.",
    );
    block = resp.content.find((b) => b.type === "tool_use" && b.name === "emit_checklists");
    if (!block || block.type !== "tool_use") {
      throw new Error("Grounder did not return an emit_checklists tool call (after retry)");
    }
    parsed = ToolInputSchema.parse(block.input);
  }

  // Enforce the min-2-per-checklist invariant post-parse with a clear error.
  const undersized = REQUIRED_KEYS.filter((k) => parsed[k].length < 2);
  if (undersized.length > 0) {
    throw new Error(
      `Grounder emitted fewer than 2 items for: ${undersized.join(", ")}. ` +
        `Likely cause: max_tokens too low. Inspect tool output and raise grounder.max_tokens in config/llm_models.yaml.`,
    );
  }

  const validKeys = new Set(kb.map((p) => p.citation_key));
  const out: Record<ChecklistKey, string[]> = {
    leader_required: itemsToStrings(parsed.leader_required, validKeys, "leader_required"),
    leader_forbidden: itemsToStrings(parsed.leader_forbidden, validKeys, "leader_forbidden"),
    peer_required: itemsToStrings(parsed.peer_required, validKeys, "peer_required"),
    peer_forbidden: itemsToStrings(parsed.peer_forbidden, validKeys, "peer_forbidden"),
    xai_required: itemsToStrings(parsed.xai_required, validKeys, "xai_required"),
    xai_forbidden: itemsToStrings(parsed.xai_forbidden, validKeys, "xai_forbidden"),
    aci_required: itemsToStrings(parsed.aci_required, validKeys, "aci_required"),
    aci_forbidden: itemsToStrings(parsed.aci_forbidden, validKeys, "aci_forbidden"),
  };

  logger.info({ audit_notes_len: parsed.audit_notes.length }, "grounder.done");
  return { checklists: out, audit_notes: parsed.audit_notes };
}

// ─────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────

function buildCacheablePrefix(kb: ValidatedPaper[]): string {
  const cf = readFileSync(resolve(ROOT, "config/common_framework.yaml"), "utf8");
  const mc = readFileSync(resolve(ROOT, "config/manipulation_checks.yaml"), "utf8");
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
    "## Frozen common_framework.yaml (reference)",
    "```yaml",
    cf,
    "```",
    "",
    "## Frozen manipulation_checks.yaml (reference)",
    "```yaml",
    mc,
    "```",
  ].join("\n");
}

function itemsToStrings(
  items: z.infer<typeof ItemSchema>[],
  validKeys: Set<string>,
  label: string,
): string[] {
  const out: string[] = [];
  for (const it of items) {
    const resolved = it.citations.filter((c) => validKeys.has(c));
    if (resolved.length === 0) {
      // Per CLAUDE.md §3.7 / §14.1 — citations must resolve exactly. We log
      // and drop the item; if too many are dropped, the Architect will fail
      // its own min-component guard and surface to the user.
      logger.warn(
        { label, text: it.text.slice(0, 80), bad_citations: it.citations },
        "grounder.unresolved_citations_dropped",
      );
      continue;
    }
    out.push(formatChecklistItem({ text: it.text, citations: resolved } satisfies ChecklistItem));
  }
  return out;
}

// Re-export the YAML loader for tests / debugging.
export const __loadCommonFrameworkRaw = () =>
  yaml.load(readFileSync(resolve(ROOT, "config/common_framework.yaml"), "utf8"));
