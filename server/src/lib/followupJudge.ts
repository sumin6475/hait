// [Step 54] 팔로업 판정기 — "이 사람 메시지에 Alex가 바로 이어서 답해야 하나" yes/no 하나만.
// 본 judge(interventionJudge.ts)와 분리한다: 본 judge는 매 턴 도는 예산 프롬프트이고,
// 여기에 문장을 얹으면 Step 40B 회귀(build_on 오분류)가 재현된다 (ADR D0-1/D0-2).
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });
const MODEL = "gpt-4o-mini";
const MAX_TOKENS = 16;
const TIMEOUT_MS = 5_000;
export const FOLLOWUP_WINDOW = 4; // Alex 턴 포함 최근 4줄

const Schema = z.object({ answer: z.boolean() });

const SYSTEM = `Alex just spoke in a small team chat, and one person replied right after. Decide one thing: is that reply aimed at Alex and waiting for Alex to respond?

Answer true ONLY when the reply clearly does one of these:
- asks Alex something, or asks for what Alex has or thinks
- explicitly asks Alex to clarify, defend, or check something Alex just said
- hands the floor to Alex, or asks Alex whether to proceed

Answer false for everything else, and false is the common case. In particular:
- the reply is addressed to the other teammate, not to Alex
- it is a low-signal reaction with no request in it ("ok", "yeah", "same here", "right")
- the people are carrying on with each other and simply did not take up what Alex said
- it adds their own information without asking Alex anything
- Alex asked the room for information and the reply supplies that information; answering Alex, including with a drawback or disagreement, does not by itself ask Alex to speak again
- it merely starts with "but", echoes Alex's words with question marks, or expresses surprise without making a request

When it is unclear, answer false.

Output JSON only.`;

export async function isFollowupToAlex(
  transcript: { speaker: string; content: string }[],
): Promise<boolean | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await client.responses.parse(
      {
        model: MODEL,
        temperature: 0,
        max_output_tokens: MAX_TOKENS,
        input: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `${lines}\n\nThe last line is the reply to judge. Output JSON only.`,
          },
        ],
        text: { format: zodTextFormat(Schema, "followup_decision") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(to);
    return resp.output_parsed?.answer ?? null;
  } catch {
    clearTimeout(to);
    return null; // 실패 = 판정 없음 = 면제 안 함 (보수적)
  }
}
