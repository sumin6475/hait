import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });
const JUDGE_MODEL = "gpt-4o-mini";
const JUDGE_MAX_TOKENS = 80;
const JUDGE_TIMEOUT_MS = 8_000;
const JUDGE_WINDOW = 16;

const JudgeSchema = z.object({
  speak: z.boolean(),
  reason: z.enum(["directed_followup", "build_on", "open_floor", "mediation", "react", "social"]),
  why: z.string().max(200),
});
// react/social은 SpeakingReason(task cue)과 분리된 judge 전용 신호 — 전용 프롬프트로 라우팅(task 페르소나 우회).
export type JudgeReason = "directed_followup" | "build_on" | "open_floor" | "mediation" | "react" | "social";
export type JudgeDecision = { speak: boolean; reason: JudgeReason; why: string };

const JUDGE_SYSTEM = `You are the floor manager for a small, live team chat: two people plus an AI teammate named "Alex", working through a group decision. Decide right now whether Alex should SPEAK or STAY SILENT, and if speaking, the single best reason. You never write Alex's message; you only gate it.

STRONGLY default to silence. Most of the time Alex just listens. A good teammate does not weigh in on every line — Alex contributes only when it clearly belongs.

Check these in order; the FIRST one that clearly holds decides the output:
1. Alex is directly addressed or asked a question → speak=true, reason=directed_followup. Answer that.
2. In the last message or two, the people are stating their OWN candidate preferences (e.g. "I'd go with A", "I lean B") → speak=true, reason=build_on: Alex adds its read to that exchange.
3. The team is stuck, going in circles, or rushing to narrow too early → speak=true, reason=mediation: Alex refocuses them. This is a facilitation move, NOT an opinion.
4. A greeting, small talk, or an off-task/emotional remark is sitting unanswered → speak=true, reason=social: a short human reply.
5. Someone just made a point and a brief, human acknowledgment fits ("yeah, that makes sense", "good point") and several messages have passed since Alex last spoke → speak=true, reason=react. NOT a full opinion or analysis. Use sparingly, not every turn.
6. Rare: the discussion is clearly missing one genuinely new, useful piece Alex can put on the table → speak=true, reason=open_floor.
7. Otherwise → speak=false. This is the COMMON case: the two people are mid-exchange and Alex would interrupt, Alex spoke very recently and has nothing genuinely new, or the moment simply doesn't call for Alex.

Cases 1 and 2 are the ONLY situations where Alex may voice a candidate opinion (its read, a comparison, a preference). Outside them Alex must NOT volunteer an opinion, even if it could — mediation, react, and social are lighter, non-opinion moves, so they may fire outside cases 1–2.

You are told how many messages have passed since Alex last spoke. If that number is 1, output speak=false unless Alex was directly addressed (case 1). If it is small, lean hard toward silence unless Alex was directly addressed. Prefer react or silence over volunteering an opinion. Output JSON only.`;

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
    return { speak: p.speak, reason: p.reason, why: p.why };
  } catch {
    clearTimeout(to);
    return null;
  }
}

export const JUDGE_WINDOW_SIZE = JUDGE_WINDOW;
