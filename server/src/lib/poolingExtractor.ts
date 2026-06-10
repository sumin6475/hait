// poolingExtractor — 사람 메시지가 표면화한 trait id 추출 (Step 14a).
// interventionJudge 패턴: 자체 OpenAI client + responses.parse + zod, 실패 → [] (조용히 skip).
// fire-and-forget로 호출됨 → Alex 응답경로를 절대 막지 않는다.
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { TRAIT_DB, TRAIT_BY_ID, type Cand } from "./traitData.js";

const client = new OpenAI({ apiKey: config.openaiApiKey });
const EXTRACT_MODEL = "gpt-4o-mini";
const EXTRACT_MAX_TOKENS = 150;
const EXTRACT_TIMEOUT_MS = 8_000;

const ExtractSchema = z.object({ surfaced: z.array(z.string()) });

// TRAIT_DB 압축목록 (후보별 "id: text") — 시스템 프롬프트에 1회 포함, 모듈 로드 시 생성.
const TRAIT_LIST = (["A", "B", "C", "D"] as Cand[])
  .map(
    (c) =>
      `Candidate ${c}:\n` +
      TRAIT_DB.filter((t) => t.candidate === c)
        .map((t) => `  ${t.id}: ${t.text}`)
        .join("\n"),
  )
  .join("\n");

const EXTRACT_SYSTEM = `Below is the full list of known traits of four candidates (A, B, C, D), each with an id.

${TRAIT_LIST}

You will be given one chat message from a team discussion about these candidates. Return in "surfaced" the ids of ONLY the traits this message explicitly mentions or asserts about a candidate. Paraphrases count as mentions. Do not guess or extrapolate beyond what is said. If the message denies or disputes a trait ("A is not arrogant"), that trait is NOT surfaced. Ignore opinions, preferences, and judgments that don't state a trait. If nothing matches, return an empty array. Output JSON only.`;

export async function extractSurfacedTraits(messageText: string): Promise<string[]> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const resp = await client.responses.parse(
      {
        model: EXTRACT_MODEL,
        temperature: 0,
        max_output_tokens: EXTRACT_MAX_TOKENS,
        input: [
          { role: "system", content: EXTRACT_SYSTEM },
          { role: "user", content: `Message:\n${messageText}\n\nOutput JSON only.` },
        ],
        text: { format: zodTextFormat(ExtractSchema, "surfaced_traits") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(to);
    const p = resp.output_parsed;
    if (!p) return [];
    return p.surfaced.filter((id) => TRAIT_BY_ID.has(id)); // 모델 환각 id 제거
  } catch {
    clearTimeout(to);
    return []; // 타임아웃/네트워크/파싱 실패 → skip (다음 메시지에 보정)
  }
}
