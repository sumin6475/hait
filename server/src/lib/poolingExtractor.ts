import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { TRAIT_DB, TRAIT_BY_ID, type Cand } from "./traitData.js";
import type { ProfileSlot } from "../types.js";
import { TRAIT_KEYWORD_REGISTRY, type TraitKeywordEntry } from "./traitKeywordRegistry.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const EXTRACT_MODEL = "gpt-4o-mini";
const EXTRACT_TIMEOUT_MS = 8_000;
const TraitMentionSchema = z.object({
  traitId: z.string(), evidenceQuote: z.string(),
  assertionType: z.enum(["asserted", "questioned", "hypothetical", "generic_reference"]),
  confidence: z.number().min(0).max(1),
});
const ExtractSchema = z.object({ mentions: z.array(TraitMentionSchema) });
export type ExtractedTraitMention = z.infer<typeof TraitMentionSchema>;

export interface FastTraitCandidate {
  traitId: string;
  evidenceQuote: string;
  reason: "ambiguous" | "lexical_near_match" | "assertion_context";
}
export interface FastTraitExtraction { acceptedIds: string[]; verificationCandidates: FastTraitCandidate[] }

function normalizedEvidence(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, " ").trim();
}
interface CandidateMention {
  candidate: Cand;
  start: number;
  end: number;
}

function candidateMentions(text: string): CandidateMention[] {
  const mentions: CandidateMention[] = [];
  for (const match of text.matchAll(/\bcandidate\s+([a-d])\b/gi)) {
    mentions.push({
      candidate: match[1]!.toUpperCase() as Cand,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  // Candidate letters in the corpus occur in possessives, list fragments, and
  // before punctuation ("A's", "I have B."). Keep this case-sensitive so the
  // English article "a" can never become Candidate A.
  for (const match of text.matchAll(/\b([ABCD])\b/g)) {
    if (mentions.some((mention) => match.index >= mention.start && match.index < mention.end)) continue;
    mentions.push({
      candidate: match[1]! as Cand,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return mentions.sort((left, right) => left.start - right.start);
}

function candidateAtEvidence(
  text: string,
  mentions: readonly CandidateMention[],
  evidenceStart: number,
  evidenceLength: number,
): Cand | undefined {
  const sentenceStart = Math.max(
    text.lastIndexOf(".", evidenceStart - 1),
    text.lastIndexOf("!", evidenceStart - 1),
    text.lastIndexOf("?", evidenceStart - 1),
    text.lastIndexOf("\n", evidenceStart - 1),
  ) + 1;
  const sentenceEnds = [".", "!", "?", "\n"]
    .map((boundary) => text.indexOf(boundary, evidenceStart + evidenceLength))
    .filter((position) => position >= 0);
  const sentenceEnd = sentenceEnds.length ? Math.min(...sentenceEnds) + 1 : text.length;
  const before = mentions.filter((mention) => mention.start >= sentenceStart && mention.end <= evidenceStart);
  const nearestBefore = before.at(-1);
  const after = mentions.find((mention) => mention.start >= evidenceStart + evidenceLength && mention.end <= sentenceEnd);
  if (after) {
    const between = text.slice(evidenceStart + evidenceLength, after.start);
    if (/^\s*[([]?\s*$/.test(between)) return after.candidate;
  }
  if (nearestBefore && evidenceStart - nearestBefore.end <= 160) return nearestBefore.candidate;
  const clauseEnds = [",", ";", ":", "—", "(", ")"]
    .map((boundary) => text.indexOf(boundary, evidenceStart + evidenceLength))
    .filter((position) => position >= 0);
  const clauseEnd = clauseEnds.length ? Math.min(...clauseEnds) : sentenceEnd;
  if (after && after.start < clauseEnd && after.start - (evidenceStart + evidenceLength) <= 80) return after.candidate;
  const distinctCandidates = [...new Set(mentions.map((mention) => mention.candidate))];
  if (distinctCandidates.length === 1 && mentions.some((mention) => mention.end <= evidenceStart)) return distinctCandidates[0];
  return undefined;
}

interface EvidenceContext {
  clause: string;
  prefix: string;
  suffix: string;
}

function evidenceContext(text: string, evidenceStart: number, evidenceLength: number): EvidenceContext {
  const boundaries = [".", "!", "?", "\n", ";", ":", ",", "—", "(", ")"];
  const clauseStart = Math.max(...boundaries.map((boundary) => text.lastIndexOf(boundary, evidenceStart - 1))) + 1;
  const possibleEnds = boundaries
    .map((boundary) => text.indexOf(boundary, evidenceStart + evidenceLength))
    .filter((position) => position >= 0);
  const clauseEnd = possibleEnds.length ? Math.min(...possibleEnds) + 1 : text.length;
  return {
    clause: text.slice(clauseStart, clauseEnd),
    prefix: text.slice(clauseStart, evidenceStart + evidenceLength),
    suffix: text.slice(evidenceStart, clauseEnd),
  };
}

function hasAmbiguousAssertionContext(
  text: string,
  evidenceStart: number,
  evidenceLength: number,
): boolean {
  const { clause, prefix } = evidenceContext(text, evidenceStart, evidenceLength);
  const uncertainty = /\b(?:if|maybe|might|could|would|whether|suppose|supposing|assuming)\b/i;
  const reported = /\b(?:heard|reported|was told|were told|according to|said|says|claims?|claimed)\b/i;
  // [Issue 15] Quote marks alone no longer defer; an attributed quote still does.
  //
  // The rule was written to stop reported speech — "They said Candidate B is
  // 'considered arrogant'" — from surfacing a trait, and what makes that
  // reported is the attribution, not the marks. `reported` below cannot carry
  // the load on its own because it reads the *clause*, and an attribution often
  // sits in an earlier one ("My note says: ..."), so quoted evidence is checked
  // against everything before it instead.
  //
  // T-C2-045 seq 33 was deferred on the marks alone, the bounded verifier
  // declined, and a trait said aloud reached no record at all — not
  // `sharedInfoIds`, not the pooling DV, not the count read back to the group.
  const quotePrefix = text.slice(0, evidenceStart).replace(/[^"“”]/g, "");
  const evidenceInsideQuote = quotePrefix.length % 2 === 1;
  const trimmed = text.trim();
  const wholeMessageQuote = /^(?:"|“)[\s\S]*(?:"|”)$/.test(trimmed);
  const attributedQuote =
    evidenceInsideQuote && !wholeMessageQuote && reported.test(text.slice(0, evidenceStart));
  return (
    clause.includes("?") ||
    attributedQuote ||
    uncertainty.test(prefix) ||
    reported.test(prefix) ||
    /\b(?:i\s+(?:do\s+not|don't)\s+(?:think|believe)|no evidence|not true|disagree|dispute|deny|denies|denied)\b/i.test(prefix)
  );
}
function phrasePattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]");
  // `\\b` only works when both phrase edges are word characters. Approved
  // evidence such as "100%" ends in punctuation, so a trailing word boundary
  // made an otherwise exact phrase impossible to match.
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escaped.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}_])`,
    "giu",
  );
}
function entryPhrases(entry: TraitKeywordEntry): string[] { return [...entry.corePhrases, ...entry.acceptedVariants]; }
function eligible(entry: TraitKeywordEntry, profile?: ProfileSlot): boolean { return !profile || entry.profiles.includes(profile); }

function isGenericOrNonCandidateContext(text: string, evidenceStart: number, evidenceLength: number): boolean {
  const { clause } = evidenceContext(text, evidenceStart, evidenceLength);
  return (
    /\b(?:for|in)\s+(?:this|the|a|our)\s+(?:job|role|position)\b/i.test(clause) ||
    /\b(?:we|they)\s+(?:need|want|require|are looking for|should hire)\b/i.test(clause) ||
    /\b(?:the\s+)?(?:crew|team|group|discussion|meeting|notes?|plan|process|drill|job|role|position|workplace)\s+(?:is|are|was|were|seems?|looks?|should|must|needs?)\b/i.test(clause)
  );
}

function isLocallyNegated(text: string, evidenceStart: number, evidenceLength: number): boolean {
  const { prefix } = evidenceContext(text, evidenceStart, evidenceLength);
  const beforeEvidence = prefix.slice(0, -evidenceLength);
  return /\b(?:not(?!\s+only\b)|never|no|cannot|can't|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|hardly)\s+(?:(?:really|very|so|always|that|particularly)\s+){0,2}$/i.test(beforeEvidence);
}

function hasRequiredTraitSemantics(traitId: string, prefix: string, evidenceQuote: string): boolean {
  const context = `${prefix} ${evidenceQuote}`;
  switch (traitId) {
    case "A_n1":
      return /\b(?:not|cannot|can't|doesn['’]?t|dont|don't|isn['’]?t|unable)\b/i.test(context);
    case "A_n4":
      return /\b(?:not|isn['’]?t|closed[- ]minded)\b/i.test(context);
    case "A_n5":
      return /\b(?:unfriendly|not\s+friendly|isn['’]?t\s+friendly)\b/i.test(context);
    case "B_n2":
      return /\b(?:not|isn['’]?t|uncooperative|lack(?:s|ing)?|bad\s+at)\b/i.test(context);
    case "B_n3":
      return /\b(?:below[- ]average|poor|weak|not\s+good|bad)\b/i.test(context);
    case "C_n1":
      return /\b(?:not|isn['’]?t|miss(?:es|ing|ed)?|lack(?:s|ing|ed)?|poor)\b/i.test(context);
    case "D_n2":
      return /\b(?:not|isn['’]?t|unfit|no\s+fit)\b/i.test(context);
    default:
      return true;
  }
}

interface TextToken {
  value: string;
  start: number;
  end: number;
}

function lexicalTokens(text: string): TextToken[] {
  return [...text.matchAll(/[\p{L}\p{N}%]+/gu)].map((match) => ({
    value: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

const FUZZY_PHRASE_CACHE = new Map<string, { tokenCount: number; compact: string }>();

function findLexicalNearMatch(
  text: string,
  messageTokens: readonly TextToken[],
  phrases: readonly string[],
  candidateReferences: readonly CandidateMention[],
  expectedCandidate: Cand,
): { evidenceQuote: string; start: number } | undefined {
  let best: { evidenceQuote: string; start: number; score: number } | undefined;
  for (const phrase of phrases) {
    let cachedPhrase = FUZZY_PHRASE_CACHE.get(phrase);
    if (!cachedPhrase) {
      const phraseTokens = lexicalTokens(phrase);
      cachedPhrase = {
        tokenCount: phraseTokens.length,
        compact: phraseTokens.map((token) => token.value).join(""),
      };
      FUZZY_PHRASE_CACHE.set(phrase, cachedPhrase);
    }
    const phraseCompact = cachedPhrase.compact;
    if (!phraseCompact) continue;
    const minWindow = Math.max(1, cachedPhrase.tokenCount - 1);
    const maxWindow = cachedPhrase.tokenCount + 1;
    for (let startIndex = 0; startIndex < messageTokens.length; startIndex += 1) {
      for (let size = minWindow; size <= maxWindow; size += 1) {
        const endIndex = startIndex + size - 1;
        if (endIndex >= messageTokens.length) continue;
        const first = messageTokens[startIndex]!;
        const last = messageTokens[endIndex]!;
        const attributedCandidate = candidateAtEvidence(text, candidateReferences, first.start, last.end - first.start);
        if (attributedCandidate && attributedCandidate !== expectedCandidate) continue;
        if (cachedPhrase.tokenCount === 1 && attributedCandidate !== expectedCandidate) continue;
        if (isGenericOrNonCandidateContext(text, first.start, last.end - first.start)) continue;
        const windowCompact = messageTokens.slice(startIndex, endIndex + 1).map((token) => token.value).join("");
        const threshold = cachedPhrase.tokenCount === 1 ? 0.78 : phraseCompact.length >= 18 ? 0.84 : 0.88;
        const maxLength = Math.max(phraseCompact.length, windowCompact.length);
        if (Math.abs(phraseCompact.length - windowCompact.length) > Math.floor((1 - threshold) * maxLength)) continue;
        const score = 1 - editDistance(phraseCompact, windowCompact) / maxLength;
        if (score < threshold || score >= 1 || (best && best.score >= score)) continue;
        best = { evidenceQuote: text.slice(first.start, last.end), start: first.start, score };
      }
    }
  }
  return best;
}

/** Network-free closed-pool matcher for the human-message fast path. */
export function extractHumanTraitsFast(input: { messageText: string; assignedProfile?: ProfileSlot }): FastTraitExtraction {
  const text = input.messageText;
  if (!normalizedEvidence(text)) return { acceptedIds: [], verificationCandidates: [] };
  const candidateReferences = candidateMentions(text);
  const messageTokens = lexicalTokens(text);
  const accepted = new Set<string>();
  const verification = new Map<string, FastTraitCandidate>();
  for (const entry of TRAIT_KEYWORD_REGISTRY) {
    if (!eligible(entry, input.assignedProfile)) continue;
    for (const phrase of entryPhrases(entry)) {
      const samePhraseEntries = TRAIT_KEYWORD_REGISTRY.filter((other) =>
        eligible(other, input.assignedProfile) && entryPhrases(other).some((p) => normalizedEvidence(p) === normalizedEvidence(phrase)),
      );
      const phraseCandidates = new Set(samePhraseEntries.map((other) => other.candidate));
      for (const match of text.matchAll(phrasePattern(phrase))) {
        const attributedCandidate = candidateAtEvidence(text, candidateReferences, match.index, match[0].length);
        const explicitlyAttributed = attributedCandidate === entry.candidate;
        if (attributedCandidate && !explicitlyAttributed) continue;
        if (isGenericOrNonCandidateContext(text, match.index, match[0].length)) continue;
        if (entry.traitId === "D_p4" && /\bresponsible\s+for\b/i.test(evidenceContext(text, match.index, match[0].length).suffix)) continue;
        const shortPhraseNeedsCandidate =
          (entry.traitId === "B_p1" && normalizedEvidence(match[0]) === "cool head") ||
          (entry.traitId === "B_p2" && normalizedEvidence(match[0]) === "reliability") ||
          (entry.traitId === "A_p4" && /^(?:very organized|very organised)$/.test(normalizedEvidence(match[0]))) ||
          (entry.traitId === "B_p4" && /^(?:can multitask|multitasks)$/.test(normalizedEvidence(match[0]))) ||
          (entry.traitId === "B_n1" && /^(?:nagging|are nagging)$/.test(normalizedEvidence(match[0]))) ||
          (entry.traitId === "C_n2" && normalizedEvidence(match[0]) === "egocentric") ||
          (entry.traitId === "D_n3" && normalizedEvidence(match[0]) === "know all");
        if (shortPhraseNeedsCandidate && !explicitlyAttributed) continue;
        if (phraseCandidates.size === 0 || (phraseCandidates.size > 1 && !explicitlyAttributed)) continue;
        const localNegation = isLocallyNegated(text, match.index, match[0].length);
        if (localNegation && entry.traitId !== "C_n1") continue;
        const { prefix } = evidenceContext(text, match.index, match[0].length);
        const needsNegativeSemantics = !hasRequiredTraitSemantics(entry.traitId, prefix, match[0]);
        // A bare parenthetical label can be a direct disclosure, but the local
        // matcher lacks enough syntax to decide it safely. Let the bounded
        // verifier confirm it; the post-verification validator still permits a
        // genuinely asserted parenthetical span.
        const parentheticalLabel = /\(\s*$/.test(text.slice(0, match.index));
        const ambiguousContext =
          parentheticalLabel || hasAmbiguousAssertionContext(text, match.index, match[0].length);
        if (ambiguousContext || needsNegativeSemantics) {
          if (!accepted.has(entry.traitId) && !verification.has(entry.traitId)) {
            verification.set(entry.traitId, { traitId: entry.traitId, evidenceQuote: match[0], reason: "assertion_context" });
          }
        } else {
          accepted.add(entry.traitId);
          verification.delete(entry.traitId);
        }
      }
    }
    if (accepted.has(entry.traitId) || verification.has(entry.traitId)) continue;
    const nearMatch = findLexicalNearMatch(text, messageTokens, entryPhrases(entry), candidateReferences, entry.candidate);
    if (!nearMatch) continue;
    if (entry.traitId === "D_p4" && /\bresponsible\s+for\b/i.test(evidenceContext(text, nearMatch.start, nearMatch.evidenceQuote.length).suffix)) continue;
    if (isLocallyNegated(text, nearMatch.start, nearMatch.evidenceQuote.length) && entry.traitId !== "C_n1") continue;
    const { prefix } = evidenceContext(text, nearMatch.start, nearMatch.evidenceQuote.length);
    if (!hasRequiredTraitSemantics(entry.traitId, prefix, nearMatch.evidenceQuote)) continue;
    verification.set(entry.traitId, {
      traitId: entry.traitId,
      evidenceQuote: nearMatch.evidenceQuote,
      reason: "lexical_near_match",
    });
  }
  return { acceptedIds: [...accepted], verificationCandidates: [...verification.values()] };
}

const GENERIC_ONLY =
  /^(?:(?:(?:candidate\s+[a-d]|he|she|they|his|her|their|its|the\s+candidate)(?:['’]s)?\s+))?(?:the\s+)?(?:positive|negative|good|bad)(?:\s+(?:points?|traits?|qualities|sides?|things?))?(?:\s+(?:seem|are|were|look).*)?$/i;

function evidenceOnlyAppearsInRejectedContext(message: string, quote: string, traitId: string): boolean {
  let offset = 0;
  let found = false;
  while (offset <= message.length) {
    const index = message.indexOf(quote, offset);
    if (index < 0) break;
    found = true;
    const { prefix, suffix } = evidenceContext(message, index, quote.length);
    const rejected =
      hasAmbiguousAssertionContext(message, index, quote.length) ||
      isGenericOrNonCandidateContext(message, index, quote.length) ||
      (isLocallyNegated(message, index, quote.length) && traitId !== "C_n1") ||
      !hasRequiredTraitSemantics(traitId, prefix, quote) ||
      (traitId === "D_p4" && /\bresponsible\s+for\b/i.test(suffix));
    if (!rejected) return false;
    offset = index + Math.max(quote.length, 1);
  }
  return found;
}

export function validateExtractedTraitMentions(
  messageText: string,
  mentions: readonly ExtractedTraitMention[],
  allowedTraitIds?: ReadonlySet<string>,
): string[] {
  const message = normalizedEvidence(messageText);
  const quoteCounts = new Map<string, number>();
  for (const m of mentions) { const q = normalizedEvidence(m.evidenceQuote); if (q) quoteCounts.set(q, (quoteCounts.get(q) ?? 0) + 1); }
  return [...new Set(mentions.filter((m) => {
    const trait = TRAIT_BY_ID.get(m.traitId); const quote = normalizedEvidence(m.evidenceQuote);
    if (!trait || m.assertionType !== "asserted" || m.confidence < 0.8) return false;
    if (allowedTraitIds && !allowedTraitIds.has(m.traitId)) return false;
    if (!quote || !message.includes(quote) || GENERIC_ONLY.test(quote) || (quoteCounts.get(quote) ?? 0) > 1) return false;
    // The verifier is advisory. Keep deterministic vetoes for evidence that is
    // only present inside a question, hypothetical, report, or explicit denial.
    if (evidenceOnlyAppearsInRejectedContext(message, quote, m.traitId)) return false;
    if (/\bis very responsible\b/i.test(trait.text) && /\bresponsible for\b/i.test(quote)) return false;
    if (/\bis not verbally skillful\b/i.test(trait.text) && !/\b(?:not|isn['’]?t|lack(?:s|ing)?|poor)\b.*\b(?:verbal|communicat|speak|skillful)\b/i.test(quote)) return false;
    return true;
  }).map((m) => m.traitId))];
}

const TRAIT_LIST = (["A", "B", "C", "D"] as Cand[])
  .map(
    (candidate) =>
      `Candidate ${candidate}:\n` +
      TRAIT_DB.filter((trait) => trait.candidate === candidate)
        .map((trait) => `  ${trait.id}: ${trait.text}`)
        .join("\n"),
  )
  .join("\n");

// Keep this prompt behavior-compatible with the pre-human-fast-path AI guard.
const EXTRACT_SYSTEM = `Below is the full list of known traits of four candidates (A, B, C, D), each with an id.

${TRAIT_LIST}

You will be given one chat message from a team discussion about these candidates. Identify ONLY candidate traits affirmatively asserted in that message. For each possible item return its traitId, an evidenceQuote copied exactly from the message, assertionType, and confidence.

Use assertionType="asserted" only when the person actually says the candidate has that specific trait. Use "questioned" for a question, "hypothetical" for an if/maybe scenario, and "generic_reference" for phrases such as "positive points", "negative qualities", "their strengths", or a general job criterion. Only asserted items can enter the factual ledger.

Paraphrases count only when the evidence quote itself expresses the specific trait. Do not expand a generic phrase into the person's private list. "I choose Candidate A because his positive points seem more vital" has no trait mentions. "Being responsible for people's lives" does not assert that Candidate D is a very responsible person. "Being skillful is important" is a job criterion, not an assertion that a candidate is or is not verbally skillful. A preference, agreement, comparison, or decision with no specific trait has no mentions. If the message denies or disputes a trait, do not mark it asserted. A request for information has no asserted trait unless the person also states one.

Never invent or paraphrase the evidenceQuote; copy an exact contiguous span from the message. Do not reuse one generic evidence quote for several ids. When uncertain, omit the item. Output JSON only.`;

export type HumanTraitVerificationResult = {
  ids: string[];
  status: "no_candidates" | "verified" | "no_matches" | "failed";
  error?: string;
};

/** Bounded verifier; it only receives lexical candidates found locally. */
export async function verifyHumanTraitCandidates(input: { messageText: string; candidates: readonly FastTraitCandidate[] }): Promise<HumanTraitVerificationResult> {
  if (!input.candidates.length) return { ids: [], status: "no_candidates" };
  const ctrl = new AbortController(); const timeout = setTimeout(() => ctrl.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const resp = await client.responses.parse({
      model: EXTRACT_MODEL, temperature: 0, max_output_tokens: 500,
      input: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: JSON.stringify({ message: input.messageText, candidates: input.candidates }) }],
      text: { format: zodTextFormat(ExtractSchema, "surfaced_traits") },
    }, { signal: ctrl.signal });
    if (!resp.output_parsed) return { ids: [], status: "failed", error: "empty parsed response" };
    const allowedTraitIds = new Set(input.candidates.map((candidate) => candidate.traitId));
    const ids = validateExtractedTraitMentions(
      input.messageText,
      resp.output_parsed.mentions,
      allowedTraitIds,
    );
    return { ids, status: ids.length ? "verified" : "no_matches" };
  } catch (error) {
    return { ids: [], status: "failed", error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}

/** Existing AI guard API. Human callers should use fast + verify instead. */
export async function extractSurfacedTraits(messageText: string): Promise<string[]> {
  const ctrl = new AbortController(); const timeout = setTimeout(() => ctrl.abort(), EXTRACT_TIMEOUT_MS);
  try {
    const resp = await client.responses.parse({
      model: EXTRACT_MODEL, temperature: 0, max_output_tokens: 800,
      input: [{ role: "system", content: EXTRACT_SYSTEM }, { role: "user", content: `Message:\n${messageText}\n\nOutput JSON only.` }],
      text: { format: zodTextFormat(ExtractSchema, "surfaced_traits") },
    }, { signal: ctrl.signal });
    return resp.output_parsed ? validateExtractedTraitMentions(messageText, resp.output_parsed.mentions) : [];
  } catch { return []; } finally { clearTimeout(timeout); }
}
