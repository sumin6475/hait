import {
  AgentStateSchema,
  type AgentState,
} from "../schemas/state.schema.js";
import type { ValidatedPaper } from "../schemas/paper.schema.js";
import type { Condition } from "../schemas/prompt.schema.js";

// Per CLAUDE.md §6.4. The single AgentState shape passed through the
// LangGraph workflow. Reducers below are pure — they return a NEW state
// with the given delta applied; they never mutate.

export function initialState(args: {
  condition: Condition;
  knowledge_base: ValidatedPaper[];
  pass_threshold?: number;
}): AgentState {
  return AgentStateSchema.parse({
    seed_paper_list: [],
    search_keywords: [],
    candidate_paper_pool: [],
    validated_knowledge_base: args.knowledge_base,
    current_condition: args.condition,
    mock_chat_log: [],
    loop_count: 0,
    pass_threshold: args.pass_threshold ?? 4.5,
  });
}

// ─────────────────────────────────────────────────────────────────
// Reducers — used by both the plain-TS workflow loop and any LangGraph
// channel definitions that need a merge function.
// ─────────────────────────────────────────────────────────────────

export function appendChatTurns(
  state: AgentState,
  turns: AgentState["mock_chat_log"],
): AgentState {
  return { ...state, mock_chat_log: [...state.mock_chat_log, ...turns] };
}

export function incrementLoop(state: AgentState): AgentState {
  return { ...state, loop_count: state.loop_count + 1 };
}

export function clearTransient(state: AgentState): AgentState {
  // Called between iterations: drop the prior mock chat and scores so the
  // next Critic run starts clean. Keep the prompt_draft so the Architect can
  // see what to revise.
  return {
    ...state,
    mock_chat_log: [],
    ...(state.evaluation_scores ? { evaluation_scores: undefined } : {}),
  } as AgentState;
}

// ─────────────────────────────────────────────────────────────────
// Linguistic checklist field format.
// ─────────────────────────────────────────────────────────────────
// The schema declares `linguistic_checklist: Record<string, string[]>`.
// Keys follow the pattern `<dimension>_<polarity>`, where:
//   dimension ∈ {leader, peer, xai, aci}
//   polarity  ∈ {required, forbidden}
// Each string item is formatted as:
//   "<behavior text> @cite[Key1,Key2,...]"
// This keeps the schema unchanged while letting the Architect extract both
// the behavior and the citations cleanly.

export type ChecklistKey =
  | "leader_required"
  | "leader_forbidden"
  | "peer_required"
  | "peer_forbidden"
  | "xai_required"
  | "xai_forbidden"
  | "aci_required"
  | "aci_forbidden";

export interface ChecklistItem {
  text: string;
  citations: string[];
}

const CITE_RE = /\s*@cite\[([^\]]+)\]\s*$/;

export function parseChecklistItem(s: string): ChecklistItem {
  const m = s.match(CITE_RE);
  if (!m) return { text: s.trim(), citations: [] };
  const citations = m[1]!.split(",").map((c) => c.trim()).filter(Boolean);
  return { text: s.slice(0, m.index).trim(), citations };
}

export function formatChecklistItem(item: ChecklistItem): string {
  return item.citations.length
    ? `${item.text} @cite[${item.citations.join(",")}]`
    : item.text;
}
