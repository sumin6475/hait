import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";

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
    "social_uptake",
    "none",
  ]),
});
export type JudgeDecision = z.infer<typeof JudgeSchema>;

const JUDGE_SYSTEM = `You are the intervention judge for a small live team chat with two people and an AI teammate named Alex. The team is comparing candidates in a group decision.

Direct address, follow-up replies to Alex, long silence, summary, and closing have already been handled elsewhere. Classify only the current ordinary human-human exchange.

Choose exactly one decision:

CONTRIBUTE — Alex has one specific, relevant, non-redundant factual contribution or correction that would materially advance the candidate discussion right now.

ACKNOWLEDGE — Alex has no substantive information to add, but one brief acknowledgment of the immediately preceding message would be socially useful and would not interrupt the people's exchange. This must not require a question, candidate comparison, new trait, preference, or procedural nudge.

SILENT — Alex should not speak. This is the default and common result.

A candidate being mentioned, praised, criticized, compared, or preferred is not by itself a reason to contribute. Choose contribute only when the supplied availability signal identifies a concrete information gain or factual correction. Choose acknowledge sparingly. When uncertain, choose silent. Do not choose mediation or a candidate, and do not write Alex's message.

Output JSON only.`;

export async function judgeIntervention(
  transcript: { speaker: string; content: string }[],
  msgsSinceAlex: number,
  relevantUnsurfacedSignal = "none",
): Promise<JudgeDecision | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const user = `Messages since Alex last spoke: ${msgsSinceAlex}\nAvailable unsurfaced information relevant to the current topic: ${relevantUnsurfacedSignal}\n\nRecent chat:\n${lines}\n\nClassify the intervention level now. Output JSON only.`;
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
