import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { TRAIT_BY_ID } from "./traitData.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 6_000;

const Schema = z.object({
  decision: z.enum(["contribute", "acknowledge", "silent"]),
  evidence: z.enum([
    "unresolved_difference",
    "relevant_unsurfaced_information",
    "cross_response_synthesis",
    "social_closure",
    "humans_resolved",
    "humans_still_carrying",
    "topic_shift",
    "none",
  ]),
  selectedTraitId: z.string().nullable(),
});

export type QuestionUptakeDecision = z.infer<typeof Schema>;

const SYSTEM = `You are a condition-blind uptake evaluator for a small-team chat with two humans and an AI teammate named Alex. Alex asked a question, the humans responded, and the response cluster may now be ending. Decide whether one brief Alex uptake would be useful. Do not infer an experimental condition, status role, or communication style, and do not write Alex's message.

CONTRIBUTE only for one unresolved difference between the responses, one material cross-response synthesis, or one listed unsurfaced Alex note that directly answers the thread. For relevant_unsurfaced_information, select exactly one eligible id.

ACKNOWLEDGE only when the humans are done and a brief social closure from the question asker is genuinely useful.

SILENT is the default. Choose it when the humans resolved the issue, are still carrying the exchange, changed topic, or when Alex would only repeat, praise, or paraphrase them.

Evidence must match the decision:
- unresolved_difference, relevant_unsurfaced_information, cross_response_synthesis -> contribute
- social_closure -> acknowledge
- humans_resolved, humans_still_carrying, topic_shift, none -> silent

selectedTraitId is non-null only for relevant_unsurfaced_information. Output JSON only.`;

export function validateQuestionUptakeDecision(
  decision: QuestionUptakeDecision,
  eligibleTraitIds: readonly string[],
): boolean {
  const contributionEvidence = new Set([
    "unresolved_difference",
    "relevant_unsurfaced_information",
    "cross_response_synthesis",
  ]);
  if (decision.decision === "contribute" && !contributionEvidence.has(decision.evidence)) {
    return false;
  }
  if (decision.decision === "acknowledge" && decision.evidence !== "social_closure") return false;
  if (
    decision.decision === "silent" &&
    !["humans_resolved", "humans_still_carrying", "topic_shift", "none"].includes(decision.evidence)
  ) {
    return false;
  }
  if (decision.evidence === "relevant_unsurfaced_information") {
    return Boolean(decision.selectedTraitId && eligibleTraitIds.includes(decision.selectedTraitId));
  }
  return decision.selectedTraitId === null;
}

export async function judgeQuestionUptake(input: {
  question: string;
  responseCluster: Array<{ seq: number; speaker: string; content: string }>;
  eligibleTraitIds: string[];
}): Promise<
  | {
      ok: true;
      decision: QuestionUptakeDecision;
      model: string;
      responseId?: string;
      latencyMs: number;
    }
  | { ok: false; error: string; model: string; latencyMs: number }
> {
  const eligible = input.eligibleTraitIds
    .map((id) => {
      const trait = TRAIT_BY_ID.get(id);
      return trait
        ? `${id} | Candidate ${trait.candidate} | ${trait.valence === "pos" ? "MATCH" : "MISS"} | ${trait.text}`
        : null;
    })
    .filter((value): value is string => Boolean(value));
  const cluster = input.responseCluster
    .map((message) => `[${message.seq}] ${message.speaker}: ${message.content}`)
    .join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await client.responses.parse(
      {
        model: MODEL,
        temperature: 0,
        max_output_tokens: 100,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Alex question:\n${input.question}\n\nHuman response cluster:\n${cluster || "none"}\n\nEligible unsurfaced Alex notes:\n${eligible.join("\n") || "none"}\n\nOutput JSON only.`,
          },
        ],
        text: { format: zodTextFormat(Schema, "question_uptake_decision") },
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    const decision = response.output_parsed;
    if (!decision) {
      return {
        ok: false,
        error: "output_parsed_null",
        model: response.model ?? MODEL,
        latencyMs: Date.now() - started,
      };
    }
    if (!validateQuestionUptakeDecision(decision, input.eligibleTraitIds)) {
      return {
        ok: false,
        error: "invalid_decision_contract",
        model: response.model ?? MODEL,
        latencyMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      decision,
      model: response.model ?? MODEL,
      responseId: response.id,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      model: MODEL,
      latencyMs: Date.now() - started,
    };
  }
}
