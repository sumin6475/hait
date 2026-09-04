import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { RequestIntent } from "./routeContext.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 80;
const TIMEOUT_MS = 5_000;

const SemanticIntentSchema = z.object({
  kind: z.enum([
    "complete_single_candidate",
    "complete_all_candidates",
    "new_information_request",
    "scoped_information_request",
    "candidate_information_request",
    "preference_request",
    "task_rule_question",
    "conversation_meta_request",
    "thread_reply",
    "general_direct_request",
  ]),
  candidate: z.enum(["A", "B", "C", "D"]).nullable(),
  source: z.enum(["alex_notes", "visible_board"]),
});

export type DirectRequestIntentMethod = "regex" | "semantic" | "fallback";

export interface DirectRequestIntentResolution {
  intent: RequestIntent;
  method: DirectRequestIntentMethod;
  model?: string;
  error?: string;
}

const SYSTEM = `Classify a direct request to Alex in a small team discussion. The team is comparing candidates A, B, C, and D against listed job requirements.

Choose the request kind by meaning, not by exact wording:
- complete_single_candidate: asks for every trait or the full notes for one candidate
- complete_all_candidates: asks for every candidate or all notes
- new_information_request: asks for information Alex has that the team has not heard, including paraphrases such as "anything we missed?"
- scoped_information_request: broadly asks what Alex has, without a clearer request
- candidate_information_request: asks a factual question about one candidate, but not for a complete list or specifically new information
- preference_request: asks for Alex's choice, ranking, or preferred candidate
- task_rule_question: asks how the stated criteria work, whether one criterion matters more or outweighs another, or what result would follow from a hypothetical rule
- conversation_meta_request: asks whether Alex can answer, is ready, can take another question, or otherwise manages the conversation without asking for candidate facts
- thread_reply: answers, corrects, challenges, or pushes back on Alex without making a new request
- general_direct_request: any other direct question or request that Alex should answer

source is visible_board only when the person explicitly asks about information already shared in the discussion. Otherwise use alex_notes. Use candidate only when exactly one candidate is the requested subject. Do not answer the request. Output JSON only.`;

function normalizedIntent(parsed: z.infer<typeof SemanticIntentSchema>): RequestIntent {
  const candidate = [
    "complete_all_candidates",
    "scoped_information_request",
    "preference_request",
    "task_rule_question",
    "conversation_meta_request",
    "thread_reply",
    "general_direct_request",
  ].includes(parsed.kind)
    ? null
    : parsed.candidate;
  const source = parsed.kind === "new_information_request" ? "alex_notes" : parsed.source;
  return { kind: parsed.kind, candidate, source };
}

export async function resolveDirectRequestIntent(input: {
  fastIntent: RequestIntent;
  request: string;
  recentConversation: Array<{ speaker: string; content: string }>;
  fallbackIntent?: RequestIntent;
}): Promise<DirectRequestIntentResolution> {
  if (input.fastIntent.kind !== "none") {
    return { intent: input.fastIntent, method: "regex" };
  }

  const recent = input.recentConversation
    .slice(-8)
    .map((message) => `${message.speaker}: ${message.content}`)
    .join("\n");
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await client.responses.parse(
      {
        model: MODEL,
        temperature: 0,
        max_output_tokens: MAX_TOKENS,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Recent conversation:\n${recent || "none"}\n\nDirect request to classify:\n${input.request}\n\nOutput JSON only.`,
          },
        ],
        text: { format: zodTextFormat(SemanticIntentSchema, "direct_request_intent") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(timeout);
    if (response.output_parsed) {
      return {
        intent: normalizedIntent(response.output_parsed),
        method: "semantic",
        model: MODEL,
      };
    }
    return {
      intent: input.fallbackIntent ?? {
        kind: "general_direct_request",
        candidate: null,
        source: "alex_notes",
      },
      method: "fallback",
      model: MODEL,
      error: "empty_semantic_classification",
    };
  } catch (error: any) {
    clearTimeout(timeout);
    const detail =
      error?.name === "AbortError" || error?.message?.includes("aborted")
        ? `timeout(${TIMEOUT_MS}ms)`
        : (error?.message ?? String(error));
    return {
      intent: input.fallbackIntent ?? {
        kind: "general_direct_request",
        candidate: null,
        source: "alex_notes",
      },
      method: "fallback",
      model: MODEL,
      error: detail,
    };
  }
}
