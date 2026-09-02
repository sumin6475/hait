import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { MainJudgeSignal } from "./routeContext.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const JUDGE_MODEL = "gpt-4o-mini";
const JUDGE_MAX_TOKENS = 40; // [Step 37] why 제거로 출력 ~40토큰 — 원복
const JUDGE_TIMEOUT_MS = 8_000;
const JUDGE_WINDOW = 16;

// [Step 37] 거리(dist) 게이트는 cooldown으로 외재화, anti-repeat/consistency/why 제거 — judge는 순수 분류기.
const JudgeSchema = z.object({
  decision: z.enum(["contribute", "acknowledge", "silent"]),
  evidence: z.enum([
    "relevant_unsurfaced_information",
    "factual_correction",
    "conversation_grounded_synthesis",
    "social_uptake",
    "none",
  ]),
});
export type JudgeDecision = z.infer<typeof JudgeSchema>;

const JUDGE_SYSTEM = `You are the intervention judge for a small live team chat with two people and an AI teammate named Alex. The team is comparing candidates in a group decision.

Direct address, follow-up replies to Alex, long silence, summary, and closing have already been handled elsewhere. Classify only the current ordinary human-human exchange.

Choose exactly one decision:

CONTRIBUTE — Alex can materially advance the candidate discussion right now through exactly one of these:
1. One specific, relevant, non-redundant piece of unsurfaced factual information;
2. A concrete factual correction that should be made now; or
3. One specific conversation-grounded synthesis: a non-redundant connection, implication, tension, or unresolved distinction derived entirely from points the humans have already stated.

A conversation-grounded synthesis must add relational value between already-spoken human points. It must not introduce a new candidate fact, present an inference as a fact, merely repeat or summarize the conversation, express generic agreement, praise the discussion, redirect the agenda, or ask broadly for more information.

ACKNOWLEDGE — Alex has no substantive information to add, but one brief acknowledgment of the immediately preceding message would be socially useful and would not interrupt the people's exchange. This must not require a question, candidate comparison, new trait, preference, or procedural nudge.

SILENT — Alex should not speak. This is the default and common result.

A candidate being mentioned, praised, criticized, compared, or preferred is not by itself a reason to contribute. The user message includes three compact server-derived fields: current focus, exchange class, and whether Alex has one unsurfaced private contribution for that focus. Treat them as authoritative.

Decision policy for those fields:
- For exchange_class=substantive with private_contribution=available, choose CONTRIBUTE with evidence=relevant_unsurfaced_information unless the recent chat already contains that contribution.
- For exchange_class=substantive with private_contribution=none and current_focus=A, B, C, or D, choose CONTRIBUTE with evidence=conversation_grounded_synthesis only when there is one specific connection, implication, tension, or unresolved distinction grounded entirely in the recent human exchange that would materially advance the comparison.
- Do not choose conversation_grounded_synthesis for a paraphrase, recap, generic agreement, unsupported interpretation, topic change, procedural prompt, or broad request for the humans to provide more information. Otherwise choose SILENT.
- Choose CONTRIBUTE with evidence=factual_correction only when the recent chat contains a concrete factual error that should be corrected now.
- For exchange_class=acknowledgment, choose ACKNOWLEDGE with evidence=social_uptake when a brief social response would be useful and non-interruptive.
- For exchange_class=preference, procedural, or unclear, choose SILENT unless there is a concrete factual correction that must be made now.
- When current_focus=none and private_contribution=none, do not choose conversation_grounded_synthesis; choose SILENT unless correcting a concrete factual error.

Evidence must match the decision:
- relevant_unsurfaced_information, factual_correction, or conversation_grounded_synthesis → CONTRIBUTE
- social_uptake → ACKNOWLEDGE
- none → SILENT

Choose acknowledgment and conversation-grounded synthesis sparingly. When uncertain whether a reaction adds new relational value, choose SILENT.

Do not decide whether Alex should express an allowed contribution as a statement or a question. Do not decide whether Alex should speak as a peer or a leader. Those choices are controlled downstream by the condition-specific route contract. Do not choose mediation or a candidate, and do not write Alex's message.

Output JSON only.`;

export async function judgeIntervention(
  transcript: { speaker: string; content: string }[],
  msgsSinceAlex: number,
  signal: MainJudgeSignal,
): Promise<JudgeDecision | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const user = `Messages since Alex last spoke: ${msgsSinceAlex}\nCurrent focus: ${signal.focusCandidate ?? "none"}\nExchange class: ${signal.exchangeClass}\nPrivate contribution: ${signal.privateContributionAvailable ? "available" : "none"}\n\nRecent chat:\n${lines}\n\nClassify the intervention level now. Output JSON only.`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
  try {
    const resp = await client.responses.parse(
      {
        model: JUDGE_MODEL,
        temperature: 0,
        max_output_tokens: JUDGE_MAX_TOKENS,
        input: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: user },
        ],
        text: { format: zodTextFormat(JudgeSchema, "judge_decision") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(to);
    const p = resp.output_parsed;
    if (!p) {
      // [진단] 게이트웨이 이전 후 null 원인 가시화 — 안정화되면 이 로그는 제거 가능
      console.error(`[judge] output_parsed null (status=${resp.status})`);
      return null;
    }
    return p;
  } catch (err: any) {
    clearTimeout(to);
    // [진단] timeout / 429(rate limit) / 기타 구분 — null이 왜 나는지 한 번 확인용
    const kind =
      err?.name === "AbortError" || err?.message?.includes("aborted")
        ? `timeout(${JUDGE_TIMEOUT_MS}ms)`
        : `status=${err?.status ?? "?"} ${err?.message ?? String(err)}`;
    console.error(`[judge] call failed → null: ${kind}`);
    return null;
  }
}

export const JUDGE_WINDOW_SIZE = JUDGE_WINDOW;
