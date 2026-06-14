import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });
const JUDGE_MODEL = "gpt-4o-mini";
const JUDGE_MAX_TOKENS = 40; // [Step 37] why 제거로 출력 ~40토큰 — 원복
const JUDGE_TIMEOUT_MS = 8_000;
const JUDGE_WINDOW = 16;

// [Step 37] 거리(dist) 게이트는 cooldown으로 외재화, anti-repeat/consistency/why 제거 — judge는 순수 분류기.
const JudgeSchema = z.object({
  speak: z.boolean(),
  reason: z.enum(["directed_followup", "build_on", "mediation"]),
});
export type JudgeReason = "directed_followup" | "build_on" | "mediation";
export type JudgeDecision = { speak: boolean; reason: JudgeReason };

const JUDGE_SYSTEM = `You are the floor manager for a small, live team chat: two people plus an AI teammate named "Alex", working through a group decision. Decide right now whether Alex should SPEAK or STAY SILENT, and if speaking, the single best reason. You never write Alex's message; you only gate it.

STRONGLY default to silence. Most of the time Alex just listens. A good teammate does not weigh in on every line — Alex contributes only when it clearly belongs.

Check these in order; the FIRST one that clearly holds decides the output:
1. Alex is directly addressed or asked a question → speak=true, reason=directed_followup. Answer that.
2. In the last message or two, the people are stating their OWN candidate preferences (e.g. "I'd go with A", "I lean B") → speak=true, reason=build_on: Alex adds its read to that exchange.
3. The team is stuck, going in circles, or rushing to narrow too early → speak=true, reason=mediation: Alex refocuses them. This is a facilitation move, NOT an opinion.
4. Otherwise → speak=false. This is the COMMON case: the two people are mid-exchange and Alex would interrupt, or the moment simply doesn't call for Alex.

Cases 1 and 2 are the ONLY situations where Alex may voice a candidate opinion (its read, a comparison, a preference). Outside them Alex must NOT volunteer an opinion — mediation is a lighter, non-opinion facilitation move.

Output JSON only.`;

export async function judgeIntervention(
  transcript: { speaker: string; content: string }[],
  msgsSinceAlex: number,
): Promise<JudgeDecision | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const user = `Messages since Alex last spoke: ${msgsSinceAlex}\n\nRecent chat:\n${lines}\n\nDecide now. Output JSON only.`;
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
    if (!p) return null;
    return { speak: p.speak, reason: p.reason };
  } catch {
    clearTimeout(to);
    return null;
  }
}

export const JUDGE_WINDOW_SIZE = JUDGE_WINDOW;
