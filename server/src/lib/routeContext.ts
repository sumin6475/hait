import type { RouteKind } from "../types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";
import { currentTopicCandidate } from "./poolingTally.js";
import {
  CANDIDATES,
  allSurfacedIds,
  humanConfirmedIds,
  lastHumanDiscussionCandidate,
} from "./informationPools.js";

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

export function relevantUnsurfacedSignal(messages: TranscriptMessage[], revealStats: any): string {
  const topic = currentTopicCandidate(
    messages.map((message) => ({ sender: message.speaker, content: message.content })),
  );
  if (!topic) return "none";
  const surfaced = allSurfacedIds(revealStats);
  const available = ALEX_Z_IDS.filter(
    (id) => TRAIT_BY_ID.get(id)?.candidate === topic && !surfaced.has(id),
  );
  return available.length ? `yes:${topic}` : "none";
}

function formatCoverageFromIds(surfaced: Set<string>): string {
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
        `Candidate ${candidate} — ${matches.length} matches · ${misses.length} misses`,
        `  Matches: ${matches.map((trait) => trait!.text).join("; ") || "—"}`,
        `  Misses: ${misses.map((trait) => trait!.text).join("; ") || "—"}`,
      ].join("\n"),
    );
  }
  if (untouched.length) blocks.push(`Still to cover: ${untouched.join(", ")}`);
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

export interface PreferenceDecision {
  eligible: boolean;
  leaders: Cand[];
  candidate: Cand | null;
  reason: "insufficient_miss_coverage" | "top_ratio_tie" | "unique_top_ratio";
  rows: Record<Cand, { matches: number; misses: number; total: number; ratio: number | null }>;
}

export function decidePreferenceFromVisibleCoverage(revealStats: any): PreferenceDecision {
  // Preference follows the same visible board as summary/closing: human and Alex disclosures.
  const surfaced = new Set([
    ...allSurfacedIds(revealStats),
    ...humanConfirmedIds(revealStats),
  ]);
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

  // A zero-MISS denominator means the full field has not been shared enough to compare ratios.
  const eligible = CANDIDATES.every((candidate) => rows[candidate].misses > 0);
  if (!eligible) {
    return {
      eligible: false,
      leaders: [],
      candidate: null,
      reason: "insufficient_miss_coverage",
      rows,
    };
  }

  // Compare fractions exactly so floating-point rounding cannot create or hide a tie.
  let leaders: Cand[] = [];
  for (const candidate of CANDIDATES) {
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
    return { eligible: true, leaders, candidate: null, reason: "top_ratio_tie", rows };
  }
  return {
    eligible: true,
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
      "State: NO_CURRENT_PREFERENCE — the visible shared picture is not yet sufficient to compare the full field.",
      "If asked to choose, say briefly that not enough has been shared yet to compare all candidates. Do not name a candidate, expose the missing-data rule, use private notes to force a choice, or list traits.",
    ].join("\n");
  }
  if (decision.leaders.length > 1) {
    const candidates = formatCandidateList(decision.leaders);
    return [
      ...header,
      `State: CURRENT_CO_PREFERENCE — ${candidates}.`,
      `When the Route Contract permits a preference, name all of ${candidates}. Say they currently look even at the top in the overall shared MATCH/MISS picture and that you would like to discuss them more before separating them. Do not pick one, state numerical evidence, or list traits.`,
    ].join("\n");
  }
  return [
    ...header,
    `State: CURRENT_PREFERENCE — Candidate ${decision.candidate}.`,
    `When the Route Contract permits a preference, name only Candidate ${decision.candidate}. Say its overall shared profile currently looks strongest on MATCHES relative to MISSES. Do not state numerical evidence, enumerate traits, or use one standout trait as the reason.`,
  ].join("\n");
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
  "explicit_human_focus" | "recent_human_topic" | "last_human_discussion" | "comparison" | "none";

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
): boolean {
  if (routeKind !== "address" && routeKind !== "followup") return false;
  if (!anchor) return false;
  if (
    matchesAny(anchor.content, EXPLICIT_ALL_SCOPE) ||
    matchesAny(anchor.content, EXPLICIT_COMPLETE_SINGLE)
  ) {
    return true;
  }
  return FOCUS_SCOPE_OVERRIDE.test(anchor.content) || candidateMentions(anchor.content).size > 1;
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
    "This controls only the subject. The Route Contract still controls whether to answer, ask, explain, contribute, or remain brief.",
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
  maxTraitIds: 1;
  reason: "scopeless_information_request" | "focus_depth";
}

const BROAD_INFORMATION_REQUESTS = [
  /\bwhat\s+(?:do|have)\s+you\s+(?:have|got)\b/i,
  /\bwhat(?:'s|\s+is)\s+in\s+your\s+notes\b/i,
  /\bshare\s+(?:your\s+notes|what\s+you(?:'ve|\s+have)\s+got)\b/i,
  /(?:뭐|무엇을?).*(?:가지고|갖고|메모|노트)/,
];
const EXPLICIT_ALL_SCOPE = [
  /\b(?:all|every|each)\s+(?:of\s+the\s+)?(?:candidates?|finalists?|profiles?)\b/i,
  /\b(?:all|everything|complete|full)\s+(?:of\s+)?(?:your\s+)?notes\b/i,
  /\ball\s+of\s+them\b/i,
  /(?:모든|전체)\s*(?:후보|후보자|프로필|노트|메모)/,
];
const EXPLICIT_COMPLETE_SINGLE = [
  /\b(?:all|every|complete|full)\s+(?:of\s+)?(?:the\s+)?(?:traits?|matches|misses|profile|notes?)\b/i,
  /\beverything\s+you\s+(?:have|got)\b/i,
  /(?:전부|모두|전체).*(?:속성|장단점|매치|미스)/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function requestScopeForRoute(input: {
  routeKind: RouteKind;
  window: TranscriptMessage[];
  revealStats: any;
  anchorSeq: number;
}): { block: string; guard?: RouteOutputScopeGuard } | null {
  if (input.routeKind !== "address" && input.routeKind !== "followup") return null;
  const anchor = anchorHumanMessage(input.window, input.anchorSeq);
  if (!anchor || !matchesAny(anchor.content, BROAD_INFORMATION_REQUESTS)) return null;
  if (matchesAny(anchor.content, EXPLICIT_ALL_SCOPE)) {
    return {
      block:
        "Request scope (server-derived): the participant explicitly requested an all-candidate or all-notes scope. Answer only that explicit scope and remain concise.",
    };
  }

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
  if (matchesAny(anchor.content, EXPLICIT_COMPLETE_SINGLE)) {
    return {
      block: `Request scope (server-derived): the explicit complete-list request applies only to the current focus, Candidate ${focus}. Do not expand to another candidate.`,
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

export function buildRouteUserContext(input: {
  routeKind: RouteKind;
  messages: TranscriptMessage[];
  revealStats: any;
  language: "en" | "ko";
  anchorSeq: number;
}): {
  userPrompt: string;
  contextFromSeq: number | null;
  contextToSeq: number | null;
  outputScopeGuard?: RouteOutputScopeGuard;
  focusDepthState: FocusDepthState;
} {
  const window = input.messages.slice(-WINDOWS[input.routeKind]);
  const transcript = window
    .map(
      (message) =>
        `[${message.seq}] ${message.speaker}: ${message.content.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const blocks = [
    `Route: ${input.routeKind}`,
    `Anchor message sequence: ${input.anchorSeq}`,
    input.language === "ko"
      ? "Session language: Korean. Return Alex's visible message in natural Korean."
      : "Session language: English. Return Alex's visible message in English.",
  ];

  if (input.routeKind === "summary" || input.routeKind === "closing") {
    blocks.push(
      `Visible on-table coverage (human and Alex disclosures; deduplicated):\n${formatVisibleBoardCoverage(input.revealStats)}`,
    );
  } else if (input.routeKind === "mediation" || input.routeKind === "long_silence") {
    blocks.push(
      `Confirmed on-table coverage (human-grounded; AI-only disclosures excluded):\n${formatConfirmedCoverage(input.revealStats)}`,
    );
  } else if (
    input.routeKind === "build_on" ||
    input.routeKind === "address" ||
    input.routeKind === "followup"
  ) {
    const notes = formatUnsurfacedNotes(window, input.revealStats);
    if (notes) blocks.push(notes);
  }
  if (input.routeKind === "long_silence") {
    blocks.push(formatLongSilenceContinuity(window));
  }
  const focusDepthState = deriveFocusDepthState({
    routeKind: input.routeKind,
    messages: window,
    revealStats: input.revealStats,
  });
  const focusControlOverridden = requestOverridesFocusControl(
    input.routeKind,
    anchorHumanMessage(window, input.anchorSeq),
  );
  const focusControl = focusControlOverridden ? null : formatInternalFocusControl(focusDepthState);
  if (focusControl) blocks.push(focusControl);
  if (
    input.routeKind === "address" ||
    input.routeKind === "followup" ||
    input.routeKind === "build_on" ||
    input.routeKind === "closing"
  ) {
    blocks.push(formatPreferenceDecision(input.revealStats));
  }
  const requestScope = requestScopeForRoute({
    routeKind: input.routeKind,
    window,
    revealStats: input.revealStats,
    anchorSeq: input.anchorSeq,
  });
  if (requestScope) blocks.push(requestScope.block);
  if (transcript) blocks.push(`Recent conversation:\n${transcript}`);
  blocks.push("Return only Alex's next visible chat message.");
  const focusGuard: RouteOutputScopeGuard | undefined =
    focusControl && focusDepthState.candidate
      ? {
          candidate: focusDepthState.candidate,
          maxTraitIds: 1,
          reason: "focus_depth",
        }
      : undefined;
  return {
    userPrompt: blocks.join("\n\n"),
    contextFromSeq: window[0]?.seq ?? null,
    contextToSeq: window.at(-1)?.seq ?? null,
    outputScopeGuard: requestScope?.guard ?? focusGuard,
    focusDepthState,
  };
}
