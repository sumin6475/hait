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
1. The last message is aimed at Alex — either it names Alex, OR it directly follows up on the point Alex made in the turn just before (a question, challenge, or request to clarify Alex's own words, pointed at Alex rather than the other person). For an unnamed follow-up you may use this ONLY when the message comes right after Alex's turn: you are told "Messages since Alex last spoke" and whether the turn right before the last message was Alex's — only count an unnamed follow-up when that number is 1 and that is yes. If two or more messages have passed since Alex spoke, the follow-up window is closed; do not treat an unnamed message as directed at Alex. → speak=true, reason=directed_followup. Answer that.
2. In the last message or two, the people are discussing or weighing a candidate — stating a preference, giving a reason, or putting a trait on the table → speak=true, reason=build_on: Alex adds its read or its own information to that exchange.
3. The team is stuck, going in circles, or rushing to narrow too early → speak=true, reason=mediation: Alex refocuses them. This is a facilitation move, NOT an opinion.
4. Otherwise → speak=false. This is the COMMON case: the two people are mid-exchange and Alex would interrupt, or the moment simply doesn't call for Alex.

Cases 1 and 2 are the only situations where Alex may volunteer a verdict or preference (which candidate it favors). Sharing a concrete piece of information Alex holds that hasn't come up — a specific trait about a candidate — is NOT a verdict and is welcome whenever it's relevant, even outside cases 1 and 2.

Output JSON only.`;

export async function judgeIntervention(
  transcript: { speaker: string; content: string }[],
  msgsSinceAlex: number,
  prevTurnWasAlex: boolean, // [Step 40] 마지막 메시지 직전 턴이 Alex였나 (코드가 아는 사실 — 추론 안 맡김)
): Promise<JudgeDecision | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const user =
    `Messages since Alex last spoke: ${msgsSinceAlex}\n` +
    `The turn right before the last message was Alex's: ${prevTurnWasAlex ? "yes" : "no"}\n\n` + // [Step 40]
    `Recent chat:\n${lines}\n\nDecide now. Output JSON only.`;
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
