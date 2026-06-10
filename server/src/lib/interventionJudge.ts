import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { SpeakingReason } from "./computeCue.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });
const JUDGE_MODEL = "gpt-4o-mini";
const JUDGE_MAX_TOKENS = 80;
const JUDGE_TIMEOUT_MS = 8_000;
const JUDGE_WINDOW = 16;

const JudgeSchema = z.object({
  speak: z.boolean(),
  reason: z.enum(["open_floor", "build_on", "directed_followup", "mediation"]),
  why: z.string().max(200),
});
export type JudgeDecision = { speak: boolean; reason: SpeakingReason; why: string };

const JUDGE_SYSTEM = `You are the floor manager for a small, live team chat. The team is two people plus an AI teammate named "Alex", working through a group decision. Your ONLY job is to decide, right now, whether Alex should SPEAK or STAY SILENT — and if speaking, the single best reason. You never write Alex's message; you only gate it.

Default to silence. A good teammate does not comment on every line; Alex should feel like a thoughtful participant, not a bot that replies to everything.

SPEAK if any clearly holds:
- Alex is directly addressed, or a question is put that Alex should answer.
- The team is stuck, going in circles, split, or about to settle before the options are properly weighed.
- Someone just made a substantive point Alex can meaningfully build on or must respond to.
- A greeting or social message is sitting unanswered and a brief, human reply is natural.

STAY SILENT if:
- The two people are mid-exchange and Alex would interrupt their back-and-forth.
- Alex spoke very recently and has nothing genuinely new to add (never repeat a point already made).
- The latest lines don't actually need Alex.

Pick exactly one reason when speaking:
- directed_followup — addressed or asked something.
- mediation — stuck / split / looping / settling too early.
- build_on — extend or react to the immediately preceding point.
- open_floor — add one new point, or a short social/greeting reply.

You are told how many messages have passed since Alex last spoke; if that number is small, lean strongly toward silence unless Alex was addressed. Output JSON only.`;

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
    return { speak: p.speak, reason: p.reason as SpeakingReason, why: p.why };
  } catch {
    clearTimeout(to);
    return null;
  }
}

export const JUDGE_WINDOW_SIZE = JUDGE_WINDOW;
