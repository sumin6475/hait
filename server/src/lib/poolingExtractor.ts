// poolingExtractor — 사람 메시지가 표면화한 trait id 추출 (Step 14a).
// interventionJudge 패턴: 자체 OpenAI client + responses.parse + zod, 실패 → [] (조용히 skip).
// 사람 메시지의 ledger 반영이 끝난 뒤에 해당 turn routing을 시작해 stale factual state를 막는다.
import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { TRAIT_DB, TRAIT_BY_ID, type Cand } from "./traitData.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const EXTRACT_MODEL = "gpt-4o-mini";
// Evidence-bearing objects are much larger than the former id-only array.
// Leave room for a participant to state several real traits in one message.
const EXTRACT_MAX_TOKENS = 800;
const EXTRACT_TIMEOUT_MS = 8_000;

const TraitMentionSchema = z.object({
  traitId: z.string(),
  evidenceQuote: z.string(),
  assertionType: z.enum(["asserted", "questioned", "hypothetical", "generic_reference"]),
  confidence: z.number().min(0).max(1),
});
const ExtractSchema = z.object({ mentions: z.array(TraitMentionSchema) });
export type ExtractedTraitMention = z.infer<typeof TraitMentionSchema>;

const GENERIC_ONLY =
  /^(?:(?:(?:candidate\s+[a-d]|he|she|they|his|her|their|its|the\s+candidate)(?:['’]s)?\s+))?(?:the\s+)?(?:positive|negative|good|bad)(?:\s+(?:points?|traits?|qualities|sides?|things?))?(?:\s+(?:seem|are|were|look).*)?$/i;

function normalizedEvidence(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert model suggestions into conservative, auditable surface events.
 * Every accepted id needs an exact source span and an affirmative assertion;
 * generic sentiment, questions, hypotheticals, and one span reused to reveal a
 * bundle are rejected before they can contaminate the session ledger.
 */
export function validateExtractedTraitMentions(
  messageText: string,
  mentions: readonly ExtractedTraitMention[],
): string[] {
  const message = normalizedEvidence(messageText);
  const quoteCounts = new Map<string, number>();
  for (const mention of mentions) {
    const quote = normalizedEvidence(mention.evidenceQuote);
    if (quote) quoteCounts.set(quote, (quoteCounts.get(quote) ?? 0) + 1);
  }

  const accepted = mentions.filter((mention) => {
    const trait = TRAIT_BY_ID.get(mention.traitId);
    const quote = normalizedEvidence(mention.evidenceQuote);
    if (!trait || mention.assertionType !== "asserted" || mention.confidence < 0.8) return false;
    if (!quote || !message.includes(quote) || GENERIC_ONLY.test(quote)) return false;
    if ((quoteCounts.get(quote) ?? 0) > 1) return false;
    // "responsible for passengers/people" describes situational duty, not the
    // personality trait "is very responsible" in the candidate database.
    if (/\bis very responsible\b/i.test(trait.text) && /\bresponsible for\b/i.test(quote)) {
      return false;
    }
    // A general statement that verbal skill matters is not the database MISS
    // that a specific candidate "is not verbally skillful".
    if (
      /\bis not verbally skillful\b/i.test(trait.text) &&
      !/\b(?:not|isn['’]?t|lack(?:s|ing)?|poor)\b.*\b(?:verbal|communicat|speak|skillful)\b/i.test(
        quote,
      )
    ) {
      return false;
    }
    return true;
  });
  return [...new Set(accepted.map((mention) => mention.traitId))];
}

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

You will be given one chat message from a team discussion about these candidates. Identify ONLY candidate traits affirmatively asserted in that message. For each possible item return its traitId, an evidenceQuote copied exactly from the message, assertionType, and confidence.

Use assertionType="asserted" only when the person actually says the candidate has that specific trait. Use "questioned" for a question, "hypothetical" for an if/maybe scenario, and "generic_reference" for phrases such as "positive points", "negative qualities", "their strengths", or a general job criterion. Only asserted items can enter the factual ledger.

Paraphrases count only when the evidence quote itself expresses the specific trait. Do not expand a generic phrase into the person's private list. "I choose Candidate A because his positive points seem more vital" has no trait mentions. "Being responsible for people's lives" does not assert that Candidate D is a very responsible person. "Being skillful is important" is a job criterion, not an assertion that a candidate is or is not verbally skillful. A preference, agreement, comparison, or decision with no specific trait has no mentions. If the message denies or disputes a trait, do not mark it asserted. A request for information has no asserted trait unless the person also states one.

Never invent or paraphrase the evidenceQuote; copy an exact contiguous span from the message. Do not reuse one generic evidence quote for several ids. When uncertain, omit the item. Output JSON only.`;

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
    return validateExtractedTraitMentions(messageText, p.mentions);
  } catch {
    clearTimeout(to);
    return []; // 타임아웃/네트워크/파싱 실패 → skip (다음 메시지에 보정)
  }
}
