import type { ConditionCode, RouteKind } from "../types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";
import { currentTopicCandidate } from "./poolingTally.js";
import {
  CANDIDATES,
  allSurfacedIds,
  humanConfirmedIds,
  lastHumanDiscussionCandidate,
} from "./informationPools.js";
import { deriveSignalFromLLM, type JudgeExchangeClass } from "./signalJudge.js";

export type { JudgeExchangeClass } from "./signalJudge.js";

export interface TranscriptMessage {
  seq: number;
  senderRole: string;
  speaker: string;
  content: string;
}

const WINDOWS: Record<RouteKind, number> = {
  greeting: 0,
  address: 8,
  followup: 8,
  long_silence: 16,
  build_on: 12,
  mediation: 16,
  backchannel: 4,
  summary: 40,
  closing: 40,
};

// 리더 조건은 여기서만 정의한다 (interventionEngine도 이 함수를 사용).
export function isLeaderCondition(conditionCode: ConditionCode): boolean {
  return conditionCode === "C2" || conditionCode === "C4";
}

/**
 * Compact, server-derived input for the Main Judge. This intentionally carries
 * only a focus, an exchange class, and the eligible unsurfaced Alex-note ids—not
 * raw tally state or a second interpretation of the conversation.
 */
export interface MainJudgeSignal {
  focusCandidate: Cand | null;
  exchangeClass: JudgeExchangeClass;
  privateContributionAvailable: boolean;
  privateContributionIds: string[];
}

const ACKNOWLEDGMENT_ONLY =
  /^\s*(?:ok(?:ay)?|yeah|yep|right|same here|me too|i agree|exactly|got it|thanks|fair enough)[.!\s]*$/i;
const PROCEDURAL_MESSAGE =
  /\b(?:let'?s|we should|we need to|time to|move on|sum up|wrap up|decide|vote|pick|choose|go through)\b/i;
const PREFERENCE_MESSAGE =
  /\b(?:i think|i prefer|i choose|i'?m leaning|my pick|best|worst|strongest|weakest)\b/i;
const QUESTION_LIKE = /\?\s*$|^\s*(?:what|which|who|how|why|can|could|would|do|does|is|are)\b/i;

function judgeAnchorHumanMessage(
  messages: TranscriptMessage[],
  anchorSeq: number,
): TranscriptMessage | undefined {
  return (
    messages.find((message) => message.seq === anchorSeq && message.senderRole !== "ai") ??
    [...messages].reverse().find((message) => message.senderRole !== "ai")
  );
}

function classifyJudgeExchange(message?: TranscriptMessage): JudgeExchangeClass {
  const content = message?.content.trim() ?? "";
  if (!content) return "unclear";
  if (ACKNOWLEDGMENT_ONLY.test(content)) return "acknowledgment";
  if (PROCEDURAL_MESSAGE.test(content)) return "procedural";
  if (PREFERENCE_MESSAGE.test(content)) return "preference";
  if (QUESTION_LIKE.test(content)) return "unclear";
  return "substantive";
}

function privateContributionIdsFor(focusCandidate: Cand | null, revealStats: any): string[] {
  if (!focusCandidate) return [];
  const surfaced = allSurfacedIds(revealStats);
  return ALEX_Z_IDS.filter(
    (id) => TRAIT_BY_ID.get(id)?.candidate === focusCandidate && !surfaced.has(id),
  );
}

/**
 * [Step 55] 규칙 기반 시그널 계산 — LLM 실패 시 fallback이자 단위 테스트용 동기 경로.
 * 동작은 기존 deriveMainJudgeSignal과 동일하게 유지한다.
 */
export function deriveMainJudgeSignalFromRules(input: {
  messages: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
}): MainJudgeSignal {
  const topicFromTranscript = currentTopicCandidate(
    input.messages.map((message) => ({ sender: message.speaker, content: message.content })),
  );
  const recentSeqFloor = Math.max(0, input.anchorSeq - 8);
  const focusCandidate =
    topicFromTranscript ?? lastHumanDiscussionCandidate(input.revealStats, recentSeqFloor);
  const privateContributionIds = privateContributionIdsFor(focusCandidate, input.revealStats);
  return {
    focusCandidate,
    exchangeClass: classifyJudgeExchange(judgeAnchorHumanMessage(input.messages, input.anchorSeq)),
    privateContributionAvailable: privateContributionIds.length > 0,
    privateContributionIds,
  };
}

/**
 * [Step 55] Main Judge 시그널 — LLM 우선, 실패 시 규칙 fallback.
 * anchor 휴먼 메시지가 없거나 빈 내용이면 LLM을 부르지 않고 바로 규칙 경로를 탄다.
 * privateContributionAvailable은 포커스 출처와 무관하게 항상 서버가 계산한다.
 */
export async function deriveMainJudgeSignal(input: {
  messages: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
}): Promise<MainJudgeSignal> {
  const anchor = judgeAnchorHumanMessage(input.messages, input.anchorSeq);
  if (anchor && anchor.content.trim()) {
    const llmSignal = await deriveSignalFromLLM({
      messages: input.messages.map(({ speaker, content }) => ({ speaker, content })),
      anchorMessage: { speaker: anchor.speaker, content: anchor.content },
    });
    if (llmSignal) {
      const privateContributionIds = privateContributionIdsFor(
        llmSignal.focusCandidate,
        input.revealStats,
      );
      return {
        ...llmSignal,
        privateContributionAvailable: privateContributionIds.length > 0,
        privateContributionIds,
      };
    }
  }
  return deriveMainJudgeSignalFromRules(input);
}

export function formatMainJudgeSignal(signal: MainJudgeSignal): string {
  return [
    `focus=${signal.focusCandidate ?? "none"}`,
    `class=${signal.exchangeClass}`,
    `private=${signal.privateContributionAvailable ? "available" : "none"}`,
  ].join(" ");
}

function formatCoverageFromIds(surfaced: Set<string>, includeUntouched = true): string {
  const blocks: string[] = [];
  const untouched: Cand[] = [];
  for (const candidate of CANDIDATES) {
    const traits = [...surfaced]
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait) => trait?.candidate === candidate);
    if (!traits.length) {
      untouched.push(candidate);
      continue;
    }
    const matches = traits.filter((trait) => trait?.valence === "pos");
    const misses = traits.filter((trait) => trait?.valence === "neg");
    blocks.push(
      [
        `Candidate ${candidate} — ${matches.length} ${matches.length === 1 ? "match" : "matches"} · ${misses.length} ${misses.length === 1 ? "miss" : "misses"}`,
        `  Matches: ${matches.map((trait) => trait!.text).join("; ") || "—"}`,
        `  Misses: ${misses.map((trait) => trait!.text).join("; ") || "—"}`,
      ].join("\n"),
    );
  }
  if (includeUntouched && untouched.length) blocks.push(`Still to cover: ${untouched.join(", ")}`);
  return blocks.join("\n\n") || "No confirmed candidate information is on the table yet.";
}

/** Human-grounded board used for depth, eligibility, preference, and intervention judgment. */
export function formatConfirmedCoverage(revealStats: any): string {
  return formatCoverageFromIds(humanConfirmedIds(revealStats));
}

/** Everything visibly stated in chat, used for participant-facing summary and closing recaps. */
export function formatVisibleBoardCoverage(revealStats: any): string {
  return formatCoverageFromIds(
    new Set([...allSurfacedIds(revealStats), ...humanConfirmedIds(revealStats)]),
  );
}

/**
 * Participant-facing summary with the frozen visual layout rendered entirely
 * from the visible board. Keeping the factual body out of model generation
 * prevents omissions, candidate swaps, and token truncation without changing
 * the established summary shape.
 */
export function formatDeterministicSummary(revealStats: any, conditionCode: ConditionCode): string {
  const surfaced = new Set([...allSurfacedIds(revealStats), ...humanConfirmedIds(revealStats)]);
  const coverage = formatCoverageFromIds(surfaced);
  const untouched = CANDIDATES.filter(
    (candidate) => ![...surfaced].some((id) => TRAIT_BY_ID.get(id)?.candidate === candidate),
  );
  const factualBody = coverage.startsWith("No confirmed candidate information")
    ? `Still to cover: ${CANDIDATES.join(", ")}`
    : coverage.includes("Still to cover:")
      ? coverage
      : `${coverage}\n\nAll candidates have at least one confirmed point on the table.`;
  const ending =
    conditionCode === "C4"
      ? untouched.length
        ? `Which of the still-uncovered candidates should the team put on the table next?`
        : "Which of these candidate differences should we resolve next to move toward a decision?"
      : untouched.length
        ? `Remaining coverage: ${untouched.map((candidate) => `Candidate ${candidate}`).join(", ")} ${untouched.length === 1 ? "is" : "are"} not yet on the table; the next step is to add that coverage before deliberating across the full field.`
        : "All finalists now have some on-table information; the next step is to resolve the most relevant differences in these visible profiles.";

  return `Quick check-in\n\n${factualBody}\n\n${ending}`;
}

export interface PreferenceDecision {
  eligible: boolean;
  scope: "none" | "partial" | "full";
  comparedCandidates: Cand[];
  leaders: Cand[];
  candidate: Cand | null;
  reason: "insufficient_comparable_coverage" | "top_ratio_tie" | "unique_top_ratio";
  rows: Record<Cand, { matches: number; misses: number; total: number; ratio: number | null }>;
}

export function decidePreferenceFromVisibleCoverage(revealStats: any): PreferenceDecision {
  // Preference follows the same visible board as summary/closing: human and Alex disclosures.
  const surfaced = new Set([...allSurfacedIds(revealStats), ...humanConfirmedIds(revealStats)]);
  const rows = {} as PreferenceDecision["rows"];

  for (const candidate of CANDIDATES) {
    const traits = [...surfaced]
      .map((id) => TRAIT_BY_ID.get(id))
      .filter((trait) => trait?.candidate === candidate);
    const matches = traits.filter((trait) => trait?.valence === "pos").length;
    const misses = traits.filter((trait) => trait?.valence === "neg").length;
    rows[candidate] = {
      matches,
      misses,
      total: matches + misses,
      ratio: misses === 0 ? null : matches / misses,
    };
  }

  // Compare only profiles that have enough two-sided information on the visible
  // board. Hidden Alex notes are never added here. This keeps a zero-MISS or
  // barely mentioned candidate from winning through missing-data arithmetic,
  // while an untouched fourth candidate no longer blocks a provisional read of
  // the profiles the group has actually discussed.
  const comparedCandidates = CANDIDATES.filter(
    (candidate) =>
      rows[candidate].matches > 0 && rows[candidate].misses > 0 && rows[candidate].total >= 3,
  );
  if (comparedCandidates.length < 2) {
    return {
      eligible: false,
      scope: "none",
      comparedCandidates,
      leaders: [],
      candidate: null,
      reason: "insufficient_comparable_coverage",
      rows,
    };
  }

  // Compare fractions exactly so floating-point rounding cannot create or hide a tie.
  let leaders: Cand[] = [];
  for (const candidate of comparedCandidates) {
    if (!leaders.length) {
      leaders = [candidate];
      continue;
    }
    const row = rows[candidate];
    const leader = rows[leaders[0]!];
    const comparison = row.matches * leader.misses - leader.matches * row.misses;
    if (comparison > 0) leaders = [candidate];
    else if (comparison === 0) leaders.push(candidate);
  }

  if (leaders.length > 1) {
    return {
      eligible: true,
      scope: comparedCandidates.length === CANDIDATES.length ? "full" : "partial",
      comparedCandidates,
      leaders,
      candidate: null,
      reason: "top_ratio_tie",
      rows,
    };
  }
  return {
    eligible: true,
    scope: comparedCandidates.length === CANDIDATES.length ? "full" : "partial",
    comparedCandidates,
    leaders,
    candidate: leaders[0]!,
    reason: "unique_top_ratio",
    rows,
  };
}

/** Backwards-compatible name; preference now uses visible, not human-only, coverage. */
export function decidePreferenceFromConfirmedCoverage(revealStats: any): PreferenceDecision {
  return decidePreferenceFromVisibleCoverage(revealStats);
}

export function preferredCandidateFromVisibleCoverage(revealStats: any): Cand | null {
  return decidePreferenceFromVisibleCoverage(revealStats).candidate;
}

/** Backwards-compatible name; preference now uses visible, not human-only, coverage. */
export function preferredCandidateFromConfirmedCoverage(revealStats: any): Cand | null {
  return preferredCandidateFromVisibleCoverage(revealStats);
}

function formatCandidateList(candidates: Cand[]): string {
  const names = candidates.map((candidate) => `Candidate ${candidate}`);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function formatPreferenceDecision(revealStats: any): string {
  const decision = decidePreferenceFromVisibleCoverage(revealStats);
  const header = [
    "Internal preference cue (mandatory; never expose this label or its computation):",
    "Use only the supplied outcome. Never state numerical evidence, describe how the outcome was computed, or mention a server rule.",
  ];

  if (!decision.eligible) {
    return [
      ...header,
      "State: NO_CURRENT_PREFERENCE — the visible shared picture does not yet contain at least two sufficiently covered MATCH/MISS profiles.",
      "If asked to choose, say briefly that not enough has been shared yet for a grounded comparison. Do not name a candidate, expose the missing-data rule, use private notes to force a choice, or list traits.",
    ].join("\n");
  }
  const compared = formatCandidateList(decision.comparedCandidates);
  const partialQualification =
    decision.scope === "partial"
      ? `This is provisional among the sufficiently covered candidates currently on the table (${compared}), not a full-field conclusion.`
      : null;
  if (decision.leaders.length > 1) {
    const candidates = formatCandidateList(decision.leaders);
    return [
      ...header,
      `State: CURRENT_CO_PREFERENCE — ${candidates}.`,
      partialQualification,
      `When the Turn Metadata permits a preference, name all of ${candidates}. ${decision.scope === "partial" ? "Explicitly qualify the read as applying only among the sufficiently covered candidates so far. " : ""}Say they currently look even at the top in the overall shared MATCH/MISS picture and that you would like to discuss them more before separating them. Do not pick one, state numerical evidence, or list traits.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    ...header,
    `State: CURRENT_PREFERENCE — Candidate ${decision.candidate}.`,
    partialQualification,
    `When the Turn Metadata permits a preference, name only Candidate ${decision.candidate}. ${decision.scope === "partial" ? "Explicitly say this is the current read among the sufficiently covered candidates so far. " : ""}Say its overall shared profile currently looks strongest on MATCHES relative to MISSES. Do not state numerical evidence, enumerate traits, or use one standout trait as the reason.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function compactMessage(content: string, maxChars = 360): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maxChars ? compact : `${compact.slice(0, maxChars - 1)}…`;
}

export function formatLongSilenceContinuity(messages: TranscriptMessage[]): string {
  // Make repetition state explicit because a transcript window alone did not stop confirmation loops.
  const alexMessages = messages.filter((message) => message.senderRole === "ai").slice(-2);
  const lastAlex = alexMessages.at(-1);
  const humanSinceLastAlex = messages.filter(
    (message) => message.senderRole !== "ai" && (!lastAlex || message.seq > lastAlex.seq),
  );

  const previousAlexLines = alexMessages.length
    ? alexMessages
        .map((message) => `[${message.seq}] ${compactMessage(message.content)}`)
        .join("\n")
    : "None";
  const humanLines = humanSinceLastAlex.length
    ? humanSinceLastAlex
        .map((message) => `[${message.seq}] ${message.speaker}: ${compactMessage(message.content)}`)
        .join("\n")
    : "None";

  return [
    "Long-silence continuity state:",
    "Recent Alex messages (a request in these lines has already been made):",
    previousAlexLines,
    "Human updates since Alex last spoke:",
    humanLines,
    "Do not repeat a prior Alex request, unresolved item, or opening phrase unless the human updates add concrete new factual evidence to that same item or explicitly return to it. If nothing materially changed, use the route's neutral no-new-evidence behavior.",
  ].join("\n");
}

export type FocusDepthBasis =
  | "explicit_human_focus"
  | "recent_human_topic"
  | "last_human_discussion"
  | "comparison"
  | "none";

export interface FocusDepthState {
  candidate: Cand | null;
  basis: FocusDepthBasis;
  humanConfirmedCount: number;
  threshold: number;
  directive: "stay" | "free";
}

const FOCUS_ROUTES = new Set<RouteKind>(["address", "followup", "long_silence", "build_on"]);
const CANDIDATE_LABEL = /\bCandidate\s+([ABCD])\b/gi;
const CANDIDATE_TOKEN = /\b([ABCD])(?:'s|’s)?\b/g;
const EXPLICIT_FOCUS_DIRECTION =
  /\b(?:stick|stay|continue|keep|remain|focus|start|begin|return|go back|move on|discuss|talk about|explore|look at)\b|(?:계속|더\s*보|집중|머물|돌아가|시작|논의|이야기|얘기)/i;
const FOCUS_SCOPE_OVERRIDE =
  /\b(?:best|winner|rank|ranking|recommend|recommendation|preference|prefer|which\s+(?:one|candidate)|who\s+(?:would\s+you\s+pick|is\s+best)|your\s+(?:choice|pick)|compare|comparison|between|versus|vs\.?|differ|difference|contrast)\b|(?:최고|우승|순위|추천|선호|어느\s*후보|누가\s*제일|비교|차이|전체)/i;

function candidateMentions(content: string): Set<Cand> {
  const found = new Set<Cand>();
  let match: RegExpExecArray | null;
  CANDIDATE_LABEL.lastIndex = 0;
  while ((match = CANDIDATE_LABEL.exec(content))) found.add(match[1]!.toUpperCase() as Cand);
  CANDIDATE_TOKEN.lastIndex = 0;
  while ((match = CANDIDATE_TOKEN.exec(content))) found.add(match[1]! as Cand);
  return found;
}

function recentHumanTopicSignal(messages: TranscriptMessage[]): {
  candidate: Cand | null;
  basis: "explicit_human_focus" | "recent_human_topic" | "comparison" | "none";
} {
  const recent = messages
    .filter((message) => message.senderRole !== "ai")
    .slice(-TRIGGER_CONFIG.DEPTH_LOOKBACK_MSGS)
    .reverse();
  for (const message of recent) {
    const candidates = candidateMentions(message.content);
    if (candidates.size === 0) continue;
    if (candidates.size > 1) return { candidate: null, basis: "comparison" };
    return {
      candidate: [...candidates][0]!,
      basis: EXPLICIT_FOCUS_DIRECTION.test(message.content)
        ? "explicit_human_focus"
        : "recent_human_topic",
    };
  }
  return { candidate: null, basis: "none" };
}

export function deriveFocusDepthState(input: {
  routeKind: RouteKind;
  messages: TranscriptMessage[];
  revealStats: any;
}): FocusDepthState {
  const threshold = TRIGGER_CONFIG.DEPTH_MIN_PER_CAND;
  if (!FOCUS_ROUTES.has(input.routeKind)) {
    return {
      candidate: null,
      basis: "none",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const recent = recentHumanTopicSignal(input.messages);
  if (recent.basis === "comparison") {
    return {
      candidate: null,
      basis: "comparison",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const candidate =
    recent.candidate ??
    lastHumanDiscussionCandidate(input.revealStats, input.messages[0]?.seq ?? 0);
  if (!candidate) {
    return {
      candidate: null,
      basis: "none",
      humanConfirmedCount: 0,
      threshold,
      directive: "free",
    };
  }

  const humanConfirmedCount = [...humanConfirmedIds(input.revealStats)].filter(
    (id) => TRAIT_BY_ID.get(id)?.candidate === candidate,
  ).length;
  const basis = recent.candidate ? recent.basis : "last_human_discussion";
  return {
    candidate,
    basis,
    humanConfirmedCount,
    threshold,
    directive:
      basis === "explicit_human_focus" || humanConfirmedCount < threshold ? "stay" : "free",
  };
}

function anchorHumanMessage(
  window: TranscriptMessage[],
  anchorSeq: number,
): TranscriptMessage | undefined {
  return (
    window.find((message) => message.seq === anchorSeq && message.senderRole !== "ai") ??
    [...window].reverse().find((message) => message.senderRole !== "ai")
  );
}

function requestOverridesFocusControl(
  routeKind: RouteKind,
  anchor: TranscriptMessage | undefined,
  intent: RequestIntent,
): boolean {
  if (routeKind !== "address" && routeKind !== "followup") return false;
  if (!anchor) return false;
  // Any classified direct request determines its own subject. A stale depth
  // lock must never redirect an answer back to the prior candidate.
  if (intent.kind !== "none") return true;
  return FOCUS_SCOPE_OVERRIDE.test(anchor.content) || candidateMentions(anchor.content).size > 1;
}

// A peer build-on may state a preference only when the discussion is already
// weighing candidates or a person has just stated one (Turn Metadata).
const PEER_PREFERENCE_STATEMENT =
  /\b(?:i prefer|i choose|i'?m leaning|my pick|go with|vote for|rather have|best|worst|strongest|weakest)\b/i;

function peerBuildOnPreferenceRelevant(anchor: TranscriptMessage | undefined): boolean {
  if (!anchor) return false;
  return (
    PEER_PREFERENCE_STATEMENT.test(anchor.content) ||
    FOCUS_SCOPE_OVERRIDE.test(anchor.content) ||
    candidateMentions(anchor.content).size > 1
  );
}

function formatInternalFocusControl(state: FocusDepthState): string | null {
  if (state.directive !== "stay" || !state.candidate) return null;
  const explicitReturn =
    state.basis === "explicit_human_focus"
      ? "A human explicitly chose or returned to this candidate. Treat that as an active topic choice, not as mere agreement or no-new-evidence repetition."
      : "The current candidate is still being explored.";
  return [
    "Internal conversation control (not user-facing; never quote, paraphrase, or mention this block):",
    `Conversational target: Candidate ${state.candidate}.`,
    explicitReturn,
    "Stay naturally on this candidate for this turn and do not redirect to another candidate.",
    "This controls only the subject. The Turn Metadata still controls whether to answer, ask, explain, contribute, or remain brief.",
    "Never mention internal control, focus calculation, depth, thresholds, counts used for routing, or why the target was selected.",
  ].join("\n");
}

function formatUnsurfacedNotes(messages: TranscriptMessage[], revealStats: any): string | null {
  const topic = currentTopicCandidate(
    messages.map((message) => ({ sender: message.speaker, content: message.content })),
  );
  if (!topic) return null;
  const surfaced = allSurfacedIds(revealStats);
  const traits = ALEX_Z_IDS.map((id) => TRAIT_BY_ID.get(id))
    .filter((trait) => trait?.candidate === topic && !surfaced.has(trait.id))
    .map((trait) => `${trait!.valence === "pos" ? "MATCH" : "MISS"}: ${trait!.text}`);
  return traits.length
    ? `Relevant not-yet-surfaced notes for Candidate ${topic}:\n${traits.join("\n")}`
    : null;
}

export interface RouteOutputScopeGuard {
  candidate: Cand;
  // Candidate focus and trait-count limits are independent. A depth lock keeps
  // the subject stable; only Turn Metadata or an explicitly scope-less
  // request should mechanically limit how many traits can be answered.
  maxTraitIds?: number;
  // NOTE_CONTRIBUTION may disclose exactly the Judge-selected note and no
  // other trait, including traits that were already on the table.
  allowedTraitIds?: string[];
  requiredTraitId?: string;
  reason:
    | "new_information_request"
    | "scopeless_information_request"
    | "focus_depth"
    | "route_single_point"
    | "selected_note_contribution"
    | "conversation_grounded_synthesis"
    | "explicit_complete_request";
}

const BROAD_INFORMATION_REQUESTS = [
  /\bwhat\s+(?:do|have)\s+you\s+(?:have|got)\b/i,
  /\bwhat(?:'s|\s+is)\s+in\s+your\s+notes\b/i,
  /\bshare\s+(?:your\s+notes|what\s+you(?:'ve|\s+have)\s+got)\b/i,
  /(?:뭐|무엇을?).*(?:가지고|갖고|메모|노트)/,
];
const NEW_INFORMATION_REQUESTS = [
  /\b(?:do|did)\s+you\s+have\s+(?:any|some)?\s*(?:new|other|additional|more)?\s*(?:information|info|insight|points?|traits?|notes?)\b/i,
  /\bis\s+there\s+(?:anything|something)\s+(?:new|else|more|additional)?\s*(?:that\s+)?you\s+(?:have|know|got)\b/i,
  /\bis\s+there\s+(?:some|any)\s+(?:new|other|additional|more)?\s*(?:information|info|insight|points?|traits?|notes?)\s+(?:that\s+)?you\s+(?:have|know|got).*(?:we|the team)\s+(?:do(?:es)?n['’]?t|haven['’]?t|hasn['’]?t)\s+(?:have|know|got|heard|covered)\b/i,
  /\b(?:anything|something|what)\s+(?:new|else|more|additional)?\s*(?:that\s+)?(?:we|the team)\s+(?:do(?:es)?n['’]?t|haven['’]?t|hasn['’]?t)\s+(?:have|know|got|heard|covered)\b/i,
  /\b(?:new|additional)\s+insight\b|\banything\s+else\b/i,
  /(?:새로운|추가|더).*(?:정보|내용|특성|속성|인사이트)|(?:우리가|팀이).*(?:모르는|없는).*(?:정보|내용)/,
];
const EXPLICIT_ALL_SCOPE = [
  /\ball\s+(?:of\s+the\s+)?(?:candidates|finalists|profiles)\b|\b(?:every|each)\s+(?:candidate|finalist|profile)\b/i,
  /\b(?:all|everything|complete|full)\s+(?:of\s+)?(?:your\s+)?notes\b/i,
  /\ball\s+of\s+them\b/i,
  /(?:모든|전체)\s*(?:후보|후보자|프로필|노트|메모)/,
];
const EXPLICIT_COMPLETE_SINGLE = [
  /\b(?:all|every|complete|full)\s+(?:of\s+)?(?:the\s+)?(?:traits?|matches|misses|profiles?|notes?)\b/i,
  /\ball\s+(?:the\s+)?(?:Candidate\s+)?[ABCD](?:'s|’s)?\s+traits?\b/i,
  /\beverything\s+you\s+(?:have|got|know)\b/i,
  /(?:전부|모두|전체|모든)\s*(?:특성|속성|장단점|매치|미스|프로필|노트|메모)/,
];
const EVERYTHING_REQUEST = /\beverything\s+(?:you\s+(?:have|got|know)|you've\s+got|on)\b/i;

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/* ────────────────────────────────────────────────────────────────────────────
 * RequestIntent — the anchor human message's request is classified exactly once,
 * and that single classification drives the request-scope block, the output
 * guard, the focus-control override, and the preference-cue injection. This
 * keeps those four consumers from making independent (and conflicting) calls
 * about the same sentence.
 * ──────────────────────────────────────────────────────────────────────────── */

export type RequestIntentKind =
  | "complete_single_candidate" // explicit complete list for one candidate
  | "complete_all_candidates" // all candidates / all notes
  | "new_information_request" // information Alex has that is not yet visible
  | "scoped_information_request" // broad request with no explicit scope → one trait
  | "candidate_information_request" // ordinary factual request about one candidate
  | "preference_request" // who is best / which one / your pick
  | "task_rule_question" // criteria, weighting, or hypothetical task-rule question
  | "conversation_meta_request" // readiness, permission, or another-question request
  | "thread_reply" // answer, correction, or pushback to Alex without a new request
  | "general_direct_request" // other direct request already routed to Alex
  | "none";

// Where the participant asked Alex to source the answer. Visible-board reads
// are exact server state in every condition; private Alex-note reads use only
// ALEX_Z_IDS. Status manipulation must not change factual answer competence.
export type RequestSource = "alex_notes" | "visible_board";

export interface RequestIntent {
  kind: RequestIntentKind;
  candidate: Cand | null;
  source: RequestSource;
}

export const NO_REQUEST_INTENT: RequestIntent = {
  kind: "none",
  candidate: null,
  source: "alex_notes",
};

const VISIBLE_BOARD_SCOPE =
  /\b(?:on the table|so far|at this point|already (?:shared|said|mentioned|discussed)|been (?:said|shared|discussed|covered)|we(?:'ve| have)(?: all)? (?:heard|got|covered|said|shared|mentioned|discussed)|we all (?:heard|covered|said|shared|mentioned|discussed)|(?:our|everyone's|the team'?s|the group'?s) (?:all )?(?:traits?|points?|information|notes?)|in the (?:chat|discussion))\b|(?:테이블|지금까지|여태|나온|공유된|말해진|논의된)/i;

// Keep the inexpensive, deterministic wording matcher while the experiment is
// frozen. If a future smoke exposes another semantically equivalent whole-board
// phrasing, replace this source decision with one shared semantic classifier
// rather than continuing to grow route-specific phrase patches.

export function classifyRequestIntent(content: string | undefined | null): RequestIntent {
  const text = content?.trim() ?? "";
  if (!text) return NO_REQUEST_INTENT;
  const source: RequestSource = VISIBLE_BOARD_SCOPE.test(text) ? "visible_board" : "alex_notes";
  const mentions = candidateMentions(text);
  const completeMarker =
    matchesAny(text, EXPLICIT_COMPLETE_SINGLE) || EVERYTHING_REQUEST.test(text);
  const allMarker = matchesAny(text, EXPLICIT_ALL_SCOPE);
  const named = mentions.size === 1 ? [...mentions][0]! : null;

  // Priority 1 — a named candidate plus a complete marker is a complete list
  // for THAT candidate. It is not gated behind broad-information phrasing
  // ("Can you give me all traits of Candidate B?" carries no "what do you
  // have") and it outranks the current conversational focus and the one-trait
  // guard.
  if (completeMarker && named && !allMarker) {
    return { kind: "complete_single_candidate", candidate: named, source };
  }
  // Priority 2 — whole-field requests.
  if (allMarker || (completeMarker && mentions.size > 1)) {
    return { kind: "complete_all_candidates", candidate: null, source };
  }
  // Complete marker without a named candidate → complete list of the current
  // focus (resolved when the scope block is built).
  if (completeMarker) {
    return { kind: "complete_single_candidate", candidate: null, source };
  }
  // Priority 3 — specifically request information that has not appeared yet.
  if (matchesAny(text, NEW_INFORMATION_REQUESTS)) {
    return { kind: "new_information_request", candidate: named, source: "alex_notes" };
  }
  // Priority 4 — broad information request with no explicit scope.
  if (matchesAny(text, BROAD_INFORMATION_REQUESTS)) {
    return { kind: "scoped_information_request", candidate: null, source };
  }
  // Priority 5 — preference questions; only these make the preference cue
  // relevant on address/followup routes.
  if (FOCUS_SCOPE_OVERRIDE.test(text)) {
    return { kind: "preference_request", candidate: null, source };
  }
  return NO_REQUEST_INTENT;
}

function formatAlexCandidateNotes(candidate: Cand): string {
  const traits = ALEX_Z_IDS.map((id) => TRAIT_BY_ID.get(id)).filter(
    (trait) => trait?.candidate === candidate,
  );
  const matches = traits
    .filter((trait) => trait?.valence === "pos")
    .map((trait) => trait!.text)
    .join("; ");
  const misses = traits
    .filter((trait) => trait?.valence === "neg")
    .map((trait) => trait!.text)
    .join("; ");
  return `For Candidate ${candidate}, my notes have these matches: ${matches}. The misses are: ${misses}.`;
}

function deterministicCompleteResponse(input: {
  language: "en" | "ko";
  intent: RequestIntent;
  candidate: Cand | null;
  revealStats: any;
}): string | undefined {
  if (
    input.language !== "en" ||
    (input.intent.kind !== "complete_single_candidate" &&
      input.intent.kind !== "complete_all_candidates")
  ) {
    return undefined;
  }

  const ids =
    input.intent.source === "visible_board"
      ? new Set([...allSurfacedIds(input.revealStats), ...humanConfirmedIds(input.revealStats)])
      : new Set(ALEX_Z_IDS);
  if (input.intent.kind === "complete_all_candidates") {
    const label =
      input.intent.source === "visible_board"
        ? "Here is what is on the table so far:"
        : "Here is everything in my notes:";
    return `${label}\n\n${formatCoverageFromIds(ids)}`;
  }

  if (!input.candidate) return undefined;
  if (input.intent.source === "alex_notes") return formatAlexCandidateNotes(input.candidate);
  const candidateIds = new Set(
    [...ids].filter((id) => TRAIT_BY_ID.get(id)?.candidate === input.candidate),
  );
  return candidateIds.size
    ? `Here is what is on the table for Candidate ${input.candidate}:\n\n${formatCoverageFromIds(candidateIds, false)}`
    : `There is no confirmed information on the table yet for Candidate ${input.candidate}.`;
}

const BARE_ALEX_ADDRESS = /^\s*(?:hey\s+)?alex[\s?!.,]*$/i;

export function requestBundleForAnchor(
  window: TranscriptMessage[],
  anchorSeq: number,
): { anchor?: TranscriptMessage; content: string } {
  const anchor = anchorHumanMessage(window, anchorSeq);
  if (!anchor) return { content: "" };
  const anchorIndex = window.findIndex((message) => message.seq === anchor.seq);
  if (anchorIndex < 0) return { anchor, content: anchor.content };

  let start = anchorIndex;
  if (BARE_ALEX_ADDRESS.test(anchor.content)) {
    const previous = window[anchorIndex - 1];
    if (previous && previous.senderRole !== "ai") start = anchorIndex - 1;
  } else {
    while (
      start > 0 &&
      window[start - 1]!.senderRole !== "ai" &&
      window[start - 1]!.senderRole === anchor.senderRole
    ) {
      start -= 1;
    }
  }

  return {
    anchor,
    content: window
      .slice(start, anchorIndex + 1)
      .filter((message) => message.senderRole !== "ai")
      .map((message) => message.content)
      .join("\n"),
  };
}

function requestScopeFromIntent(input: {
  routeKind: RouteKind;
  conditionCode: ConditionCode;
  window: TranscriptMessage[];
  revealStats: any;
  language: "en" | "ko";
  intent: RequestIntent;
}): { block: string; guard?: RouteOutputScopeGuard } | null {
  if (input.routeKind !== "address" && input.routeKind !== "followup") return null;
  const { intent } = input;

  if (intent.kind === "task_rule_question") {
    return {
      block:
        "Direct request type (server-derived): TASK_RULE_QUESTION. Answer the rule question itself first. All explicitly listed requirements count equally. Do not invent a new criterion, priority, weighting, threshold, or predicted outcome. If the question assumes one criterion outweighs another, correct that assumption briefly.",
    };
  }

  if (intent.kind === "conversation_meta_request") {
    return {
      block:
        "Direct request type (server-derived): CONVERSATION_META_REQUEST. Answer the conversational request naturally and briefly. Do not volunteer candidate notes, redirect the agenda, or turn the reply into a discussion-management move.",
    };
  }

  if (intent.kind === "thread_reply") {
    return {
      block:
        "Direct response type (server-derived): THREAD_REPLY. Respond to the substance of what the participant just said to Alex. Do not treat it as a request for new notes, replace it with an agenda question, or volunteer a candidate summary.",
    };
  }

  if (intent.kind === "general_direct_request") {
    return {
      block:
        "Direct request type (server-derived): GENERAL_DIRECT_REQUEST. Answer the latest request itself in a natural, concise way. Do not substitute a candidate summary, a new agenda question, or an unsolicited note.",
    };
  }

  if (intent.kind === "complete_all_candidates") {
    return {
      block:
        "Request scope (server-derived): the participant explicitly requested an all-candidate or all-notes scope. Answer only that explicit scope and remain concise.",
    };
  }

  if (intent.kind === "complete_single_candidate") {
    const focus =
      intent.candidate ??
      currentTopicCandidate(
        input.window.map((message) => ({ sender: message.speaker, content: message.content })),
      ) ??
      lastHumanDiscussionCandidate(input.revealStats, input.window[0]?.seq ?? 0);
    if (!focus) {
      return {
        block:
          "Request scope (server-derived): this is a complete-list request, but no single candidate can be established from the request or the current discussion. Do not dump notes or expand across candidates; give a brief scope limitation consistent with the condition style.",
      };
    }
    return {
      block: `Request scope (server-derived): the explicit complete-list request applies only to Candidate ${focus}. List every match and every miss you hold for Candidate ${focus}, and do not expand to another candidate.`,
      guard: { candidate: focus, reason: "explicit_complete_request" },
    };
  }

  if (intent.kind === "new_information_request") {
    const transcriptFocus = currentTopicCandidate(
      input.window.map((message) => ({ sender: message.speaker, content: message.content })),
    );
    const focus =
      intent.candidate ??
      transcriptFocus ??
      lastHumanDiscussionCandidate(input.revealStats, input.window[0]?.seq ?? 0);
    if (!focus) {
      return {
        block:
          "The participant asked for new information, but no single candidate is established. Ask one brief clarification question instead of listing candidates or notes.",
      };
    }
    const surfaced = allSurfacedIds(input.revealStats);
    const allowedTraitIds = ALEX_Z_IDS.filter(
      (id) => TRAIT_BY_ID.get(id)?.candidate === focus && !surfaced.has(id),
    );
    const allowedFacts = allowedTraitIds
      .map((id) => TRAIT_BY_ID.get(id))
      .filter(Boolean)
      .map(
        (trait) => `${trait!.valence === "pos" ? "MATCH" : "MISS"} — ${trait!.text} [${trait!.id}]`,
      );
    return {
      block: allowedFacts.length
        ? [
            `The participant asked for new information about Candidate ${focus}.`,
            "Answer directly with at most one of these facts that is not yet visible; do not repeat an already-visible fact:",
            ...allowedFacts,
          ].join("\n")
        : `The participant asked for new information about Candidate ${focus}, but Alex has no additional unsurfaced note for that candidate. Say that directly without repeating the existing list or changing candidates.`,
      guard: {
        candidate: focus,
        maxTraitIds: 1,
        allowedTraitIds,
        reason: "new_information_request",
      },
    };
  }

  if (intent.kind === "candidate_information_request") {
    const focus =
      intent.candidate ??
      currentTopicCandidate(
        input.window.map((message) => ({ sender: message.speaker, content: message.content })),
      ) ??
      lastHumanDiscussionCandidate(input.revealStats, input.window[0]?.seq ?? 0);
    return {
      block: focus
        ? `Direct request type (server-derived): CANDIDATE_INFORMATION_REQUEST. Answer the participant's actual question about Candidate ${focus}; do not replace it with a generic profile summary or a different question.`
        : "Direct request type (server-derived): CANDIDATE_INFORMATION_REQUEST. The requested candidate is unclear; ask one brief necessary clarification instead of guessing or listing candidates.",
    };
  }

  if (intent.kind === "scoped_information_request") {
    const transcriptFocus = currentTopicCandidate(
      input.window.map((message) => ({ sender: message.speaker, content: message.content })),
    );
    const focus =
      transcriptFocus ?? lastHumanDiscussionCandidate(input.revealStats, input.window[0]?.seq ?? 0);
    if (!focus) {
      return {
        block:
          "Request scope (server-derived): this is not an all-candidate request, but no single current candidate focus can be established. Do not dump notes or expand across candidates; give a brief scope limitation consistent with the condition style.",
      };
    }
    return {
      block: `Request scope (server-derived; mandatory): this is not an all-candidate or complete-list request. The current discussion focus is Candidate ${focus}. Answer only about Candidate ${focus}, include at most one trait, and do not expand to another candidate.`,
      guard: {
        candidate: focus,
        maxTraitIds: 1,
        reason: "scopeless_information_request",
      },
    };
  }

  return null;
}

function routePrimaryGoal(routeKind: RouteKind): string {
  switch (routeKind) {
    case "greeting":
      return "Open the live discussion briefly and naturally in the assigned peer or leader status.";
    case "address":
      return "Answer the person's direct question or request first, using only the supplied factual scope.";
    case "followup":
      return "Respond directly to the person's reply, challenge, or clarification on the same thread.";
    case "build_on":
      return "Engage the latest human point and add exactly the supplied non-redundant contribution in natural conversation.";
    case "mediation":
      return "Make the current discussion state clear and give the team one useful direction for what to resolve or cover next.";
    case "backchannel":
      return "Give one brief social reaction without adding candidate information or changing the direction.";
    case "long_silence":
      return "Re-enter the quiet discussion naturally with one grounded continuation that does not repeat Alex's prior move.";
    case "summary":
      return "Present the exact supplied visible-board checkpoint without changing its facts or scope.";
    case "closing":
      return "Present the exact final visible board, then express only the supplied preference state and hand the decision to the humans.";
  }
}

export function buildRouteUserContext(input: {
  routeKind: RouteKind;
  conditionCode: ConditionCode;
  messages: TranscriptMessage[];
  revealStats: any;
  language: "en" | "ko";
  anchorSeq: number;
  judgeEvidence?: string | null;
  selectedTraitId?: string | null;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons" | null;
  mediationFocusCandidate?: Cand | null;
  mediationEvidence?: string[];
  buildOnsSinceMediation?: number;
  requestIntentOverride?: RequestIntent;
}): {
  userPrompt: string;
  contextFromSeq: number | null;
  contextToSeq: number | null;
  outputScopeGuard?: RouteOutputScopeGuard;
  focusDepthState: FocusDepthState;
  requestIntent: RequestIntent;
  deterministicResponse?: string;
} {
  const conversationGroundedSynthesis =
    input.routeKind === "build_on" && input.judgeEvidence === "conversation_grounded_synthesis";
  const selectedTrait =
    input.routeKind === "build_on" && input.judgeEvidence === "relevant_unsurfaced_information"
      ? TRAIT_BY_ID.get(input.selectedTraitId ?? "")
      : undefined;
  const inquiryCondition = input.conditionCode === "C3" || input.conditionCode === "C4";
  // The synthesis judge sees 16 messages. Give the generator the same evidence
  // window without changing the established context size for ordinary routes.
  const window = input.messages.slice(
    -(conversationGroundedSynthesis ? 16 : WINDOWS[input.routeKind]),
  );
  const transcript = window
    .map(
      (message) =>
        `[${message.seq}] ${message.speaker}: ${message.content.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const blocks = [
    "# Turn Metadata",
    `Route kind: ${input.routeKind}`,
    `Primary goal: ${routePrimaryGoal(input.routeKind)}`,
    `Anchor message sequence: ${input.anchorSeq}`,
    input.language === "ko"
      ? "Session language: Korean. Return Alex's visible message in natural Korean."
      : "Session language: English. Return Alex's visible message in English.",
  ];
  // Direct routes are already committed to answering Alex. Classify their
  // bundled request before injecting role-specific candidate context, so a
  // rules/meta question is not accidentally steered into a candidate monologue.
  const requestBundle = requestBundleForAnchor(window, input.anchorSeq);
  const anchor = requestBundle.anchor;
  const requestIntent =
    input.routeKind === "address" || input.routeKind === "followup"
      ? (input.requestIntentOverride ?? classifyRequestIntent(requestBundle.content))
      : NO_REQUEST_INTENT;
  const suppressAmbientCandidateContext =
    (input.routeKind === "address" || input.routeKind === "followup") &&
    [
      "task_rule_question",
      "conversation_meta_request",
      "thread_reply",
      "general_direct_request",
      "new_information_request",
    ].includes(requestIntent.kind);
  if (input.routeKind === "address" || input.routeKind === "followup") {
    blocks.push(
      "Direct-response override (server-derived): respond to the latest participant message itself. If it contains a question or request, begin with the substantive answer; otherwise respond directly to its substance. Peer/leader style and explanatory/inquiry style control only how the response is phrased; they never replace the response. Ask a clarification question only when information necessary to answer is genuinely missing.",
    );
  }
  if (input.routeKind === "build_on") {
    blocks.push(
      conversationGroundedSynthesis
        ? "Contribution mode (server-derived): CONVERSATION_GROUNDED_SYNTHESIS. Use only points already stated by the humans in the recent conversation; do not introduce a new candidate fact or private note."
        : selectedTrait
          ? [
              "Contribution mode (server-derived): NOTE_CONTRIBUTION.",
              `Selected new factual contribution (mandatory): ${selectedTrait.valence === "pos" ? "MATCH" : "MISS"} — ${selectedTrait.text}.`,
              inquiryCondition
                ? "Use this as the only new fact, then ask one short alignment question about that same fact. Do not introduce, weigh, or combine another new fact."
                : "Use this as the only new fact and state it directly. Add a short connection only when that connection is explicitly supported by the recent conversation; otherwise stop after the fact. Do not recap the candidate's overall profile or restate the equal-weight rule.",
              "Make the contribution relevant to the latest human message. A separate acknowledgment is optional and usually unnecessary. Because this note was not previously on the table, present it as an additional or separate fact; never falsely call it 'that point' as though the person just said it.",
              "Use complete conversational prose with a varied sentence opening. Do not use mechanical meta-language such as 'Acknowledging that point,' 'Noted,' or 'Taking that in,' and do not emit a bare 'MATCH:' or 'MISS:' record.",
              "Do not invent an operational scenario, causal effect, job-performance consequence, or tradeoff that is absent from the recent conversation.",
            ].join("\n")
          : "Contribution mode (server-derived): NOTE_CONTRIBUTION.",
    );
  }
  if (input.routeKind === "mediation") {
    const currentFocus = input.mediationFocusCandidate
      ? `Current discussion focus: Candidate ${input.mediationFocusCandidate}.`
      : "Current discussion focus: a cross-candidate comparison or no single candidate.";
    const conditionMove =
      input.conditionCode === "C4"
        ? "After briefly making the state clear, ask at most one inclusive, grounded question that lets the team address the most useful unresolved comparison or coverage gap."
        : "Use one or two concise declarative sentences: make the state clear and state the most useful unresolved comparison or coverage gap to address next. Ask no question.";
    blocks.push(
      [
        `Mediation trigger: ${input.mediationTrigger ?? "process-state evidence"}.`,
        `Successful leader build-ons since the last mediation: ${input.buildOnsSinceMediation ?? 0}.`,
        currentFocus,
        input.mediationEvidence?.length
          ? `Observed process evidence: ${input.mediationEvidence.join(", ")}.`
          : "Observed process evidence: cadence checkpoint.",
        conditionMove,
        "Add no new candidate trait. Mediation means orienting the team's discussion state and next direction; it does not require conflict, does not require switching candidates, and must not tell the team which candidate to choose.",
        "Keep the whole mediation to two short sentences and aim for 45 words or fewer. Name only the current focus and the coverage gap; do not enumerate discussed traits, counts, or lettered options. Put the next-step sentence or question on a new line.",
      ].join("\n"),
    );
  }
  const focusDepthState = deriveFocusDepthState({
    routeKind: input.routeKind,
    messages: window,
    revealStats: input.revealStats,
  });

  if (input.routeKind === "summary" || input.routeKind === "closing") {
    blocks.push(
      `Visible on-table coverage (human and Alex disclosures; deduplicated):\n${formatVisibleBoardCoverage(input.revealStats)}`,
    );
  } else if (input.routeKind === "mediation") {
    // Mediation describes the live discussion state, so both human and Alex
    // disclosures must be visible. Human-only coverage would erase the two
    // build-ons that triggered this checkpoint.
    blocks.push(
      `Visible on-table coverage (human and Alex disclosures; deduplicated):\n${formatVisibleBoardCoverage(input.revealStats)}`,
    );
  } else if (
    input.routeKind === "long_silence" ||
    input.routeKind === "address" ||
    input.routeKind === "followup"
  ) {
    // 리더: 전체 가시 보드를 줘서 종합·정리 역할을 가능하게 한다.
    // (파일럿 근거: 리더가 전체 그림을 모르면 리더 이미지가 훼손됨)
    // 피어: 아직 안 꺼낸 비공개 노트만 줘서 "자기 관점 기여"의 자연스러움을 유지한다.
    // (long_silence 피어에 팀 커버리지가 들어가면 리더식 중재 말투가 누출됨 — T-C3-011 관측)
    if (suppressAmbientCandidateContext) {
      // The intent-specific block below supplies only the facts needed to answer.
    } else if (isLeaderCondition(input.conditionCode)) {
      const coverage =
        input.routeKind === "long_silence"
          ? formatConfirmedCoverage(input.revealStats)
          : formatVisibleBoardCoverage(input.revealStats);
      const label =
        input.routeKind === "long_silence"
          ? "Confirmed on-table coverage (human-grounded; AI-only disclosures excluded)"
          : "Visible on-table coverage (human and Alex disclosures; deduplicated)";
      blocks.push(`${label}:\n${coverage}`);
    } else {
      const notes = formatUnsurfacedNotes(window, input.revealStats);
      if (notes) blocks.push(notes);
    }
  }
  if (input.routeKind === "long_silence") {
    blocks.push(formatLongSilenceContinuity(window));
  }
  const focusControlOverridden = requestOverridesFocusControl(
    input.routeKind,
    anchor,
    requestIntent,
  );
  const focusControl = focusControlOverridden ? null : formatInternalFocusControl(focusDepthState);
  if (focusControl) blocks.push(focusControl);
  // Inject the preference cue only where the Turn Metadata can actually spend
  // it: closing always; address/followup on explicit preference requests;
  // peer build-on while the discussion is already weighing candidates. A
  // leader build-on must not state a preference, so the cue is noise there.
  const preferenceCueWanted =
    input.routeKind === "closing" ||
    ((input.routeKind === "address" || input.routeKind === "followup") &&
      requestIntent.kind === "preference_request") ||
    (input.routeKind === "build_on" &&
      !isLeaderCondition(input.conditionCode) &&
      peerBuildOnPreferenceRelevant(anchor));
  if (preferenceCueWanted) {
    blocks.push(formatPreferenceDecision(input.revealStats));
  }
  const requestScope = requestScopeFromIntent({
    routeKind: input.routeKind,
    conditionCode: input.conditionCode,
    window,
    revealStats: input.revealStats,
    language: input.language,
    intent: requestIntent,
  });
  const completeRequestCandidate =
    requestIntent.kind === "complete_single_candidate"
      ? (requestIntent.candidate ??
        currentTopicCandidate(
          window.map((message) => ({ sender: message.speaker, content: message.content })),
        ) ??
        lastHumanDiscussionCandidate(input.revealStats, window[0]?.seq ?? 0))
      : null;
  const deterministicResponse = deterministicCompleteResponse({
    language: input.language,
    intent: requestIntent,
    candidate: completeRequestCandidate,
    revealStats: input.revealStats,
  });
  if (requestScope) blocks.push(requestScope.block);
  // [T-C4-019] address/followup had no repeat guard: the same either-or question
  // was broadcast three times in a row (seq 36/39/41). build_on already says
  // "don't restate what you've already said" and long_silence "vary the opening";
  // this closes the gap for the two direct-response routes, condition-neutrally.
  // Runtime context only — the frozen route prompts are untouched.
  if (input.routeKind === "address" || input.routeKind === "followup") {
    blocks.push(
      "Anti-repeat (server-derived): if your recent messages already asked this same question or offered the same options, do not repeat them — acknowledge what was just said and move the discussion forward instead.",
    );
  }
  // [T-C4-019] The frozen "# Your Notes" section teaches Alex the +/− note symbols,
  // while every dynamic block and contract uses the words match/miss — with no rule
  // to translate, visible messages oscillated between "+" and "MATCH". summary is
  // exempt on purpose: its frozen recap format requires the "+:/−:" keyword shape.
  // Runtime context only — the frozen route prompts are untouched.
  if (input.routeKind !== "summary") {
    blocks.push(
      "Notation (server-derived): the + and − signs exist only for reading your notes. In your visible message never write '+', '−', or a plus/minus list — describe each trait in words as a match or a miss.",
    );
  }
  if (transcript) blocks.push(`Recent conversation:\n${transcript}`);
  blocks.push("Return only Alex's next visible chat message.");
  const focusGuard: RouteOutputScopeGuard | undefined =
    focusControl && focusDepthState.candidate
      ? {
          candidate: focusDepthState.candidate,
          reason: "focus_depth",
        }
      : undefined;
  // Build-on is a one-point route by contract even after depth has been met.
  // Keep that output limit separate from focus depth so direct answers can
  // satisfy their exact request without being clipped to one trait.
  const routeSinglePointGuard: RouteOutputScopeGuard | undefined =
    input.routeKind === "build_on" && focusDepthState.candidate
      ? {
          candidate: focusDepthState.candidate,
          maxTraitIds: conversationGroundedSynthesis ? 0 : 1,
          reason: conversationGroundedSynthesis
            ? "conversation_grounded_synthesis"
            : "route_single_point",
        }
      : undefined;
  const selectedContributionGuard: RouteOutputScopeGuard | undefined = selectedTrait
    ? {
        candidate: selectedTrait.candidate,
        maxTraitIds: 1,
        allowedTraitIds: [selectedTrait.id],
        requiredTraitId: selectedTrait.id,
        reason: "selected_note_contribution",
      }
    : undefined;
  const outputScopeGuard =
    requestScope?.guard ?? selectedContributionGuard ?? routeSinglePointGuard ?? focusGuard;
  return {
    userPrompt: blocks.join("\n\n"),
    contextFromSeq: window[0]?.seq ?? null,
    contextToSeq: window.at(-1)?.seq ?? null,
    outputScopeGuard,
    focusDepthState,
    requestIntent,
    deterministicResponse,
  };
}
