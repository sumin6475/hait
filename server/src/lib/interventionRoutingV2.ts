import { createHash } from "node:crypto";
import type { ConditionCode, MainJudgeDecision, PriorityRoute, RouteKind } from "../types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";

export interface AddressDetection {
  addressed: boolean;
  evidence: "name_prefix" | "name_suffix" | "direct_request" | "group_request" | "none";
}

const NAME = "(?:alex|알렉스)";
const THIRD_PERSON = new RegExp(
  `\\b(?:agree with (?:what )?${NAME}(?: said)?|what ${NAME} said|(?:according to|as) ${NAME}|${NAME}(?:'s|’s) (?:note|point|message)|${NAME} (?:said|mentioned|noted|argued))`,
  "i",
);
// Accept bare-name and trailing-name English address forms without treating third-person mentions as calls.
const PREFIX = new RegExp(`^\\s*${NAME}(?=\\s|[,!?:;–—-]|$)`, "i");
const SUFFIX = new RegExp(
  `\\b(?:what|which|why|how|who|where|when|do|can|could|would|will|should|is|are|have|has|your thoughts|how about you|what about you)\\b[^.!?]{0,120}[,!:;–—-]?\\s*${NAME}\\s*[?!.]*$`,
  "i",
);
const DIRECT_REQUEST = new RegExp(
  `${NAME}[^.!?]{0,100}(?:can you|could you|would you|please|tell|explain|share|answer|what|why|how|which|do you|is there|are there|have you|your (?:view|take|thoughts?)|알려|말해|답해|어떻게|뭐|왜)`,
  "i",
);
const GROUP_REQUEST =
  /(?:\b(?:both|either|all|the two) of you\b|\byou (?:both|two|all)\b|\b(?:what|how) (?:do|does) (?:everyone|the rest of you)\b|\bdoes (?:everyone|anyone else)\b|(?:두 분|둘 다|두 사람|다들|모두).*(?:생각|의견|동의|어때|어떻게)).*[?？]\s*$/i;

export function detectDirectAddress(message: string): AddressDetection {
  const text = message.trim();
  if (!text || THIRD_PERSON.test(text)) return { addressed: false, evidence: "none" };
  if (PREFIX.test(text)) return { addressed: true, evidence: "name_prefix" };
  if (SUFFIX.test(text)) return { addressed: true, evidence: "name_suffix" };
  if (DIRECT_REQUEST.test(text)) return { addressed: true, evidence: "direct_request" };
  if (GROUP_REQUEST.test(text)) return { addressed: true, evidence: "group_request" };
  return { addressed: false, evidence: "none" };
}

export interface MediationStateView {
  latched: boolean;
  buildOnsSinceMediation: number;
}

/**
 * Global leader cadence reducer. Candidate identity is deliberately absent:
 * changing focus cannot reset the count. Only a successful mediation clears
 * it; every other successful route preserves the accumulated debt.
 */
export function mediationBuildOnCountAfterSuccessfulRoute(
  current: number,
  routeKind: RouteKind,
): number {
  if (routeKind === "mediation") return 0;
  if (routeKind === "build_on") return Math.max(0, Math.trunc(current)) + 1;
  return Math.max(0, Math.trunc(current));
}

export interface ResolverContext {
  conditionCode: ConditionCode;
  priorityRoute: PriorityRoute;
  decision: MainJudgeDecision | null;
  mediation: MediationStateView;
  backchannelGapPassed: boolean;
  sessionId: string;
  turnSeq: number;
  backchannelRate: number;
}

export interface ResolvedRoute {
  routeKind: RouteKind | null;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons";
  reason:
    | "priority"
    | "judge_silent"
    | "backchannel_gap"
    | "backchannel_rate"
    | "backchannel"
    | "build_on"
    | "mediation";
}

export type LongSilenceGateReason =
  | "eligible"
  | "session_cap"
  | "human_cooldown"
  | "minimum_interval"
  | "stale_anchor";

export function evaluateLongSilenceGate(input: {
  broadcastCount: number;
  maxBroadcasts: number;
  messagesSinceAI: number;
  minimumHumanMessagesSinceAI: number;
  lastBroadcastAt?: number;
  minimumIntervalMs: number;
  now: number;
  latestPushSeq: number;
  anchorSeq: number;
}): { eligible: boolean; reason: LongSilenceGateReason; retryAfterMs?: number } {
  if (input.broadcastCount >= input.maxBroadcasts) {
    return { eligible: false, reason: "session_cap" };
  }
  if (input.messagesSinceAI < input.minimumHumanMessagesSinceAI) {
    return { eligible: false, reason: "human_cooldown" };
  }
  if (input.latestPushSeq !== input.anchorSeq) {
    return { eligible: false, reason: "stale_anchor" };
  }
  if (input.lastBroadcastAt !== undefined) {
    const retryAfterMs = input.minimumIntervalMs - (input.now - input.lastBroadcastAt);
    if (retryAfterMs > 0) {
      return { eligible: false, reason: "minimum_interval", retryAfterMs };
    }
  }
  return { eligible: true, reason: "eligible" };
}

export function deterministicRateGate(sessionId: string, turnSeq: number, rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const hex = createHash("sha256").update(`${sessionId}:${turnSeq}:backchannel`).digest("hex");
  const sample = Number.parseInt(hex.slice(0, 8), 16) / 0xffffffff;
  return sample < rate;
}

export function resolveRoute(ctx: ResolverContext): ResolvedRoute {
  if (ctx.priorityRoute) return { routeKind: ctx.priorityRoute, reason: "priority" };
  if (
    (ctx.conditionCode === "C2" || ctx.conditionCode === "C4") &&
    ctx.mediation.buildOnsSinceMediation >= TRIGGER_CONFIG.MEDIATION_BUILD_ON_THRESHOLD
  ) {
    return {
      routeKind: "mediation",
      reason: "mediation",
      mediationTrigger: ctx.mediation.latched ? "evidence_latch" : "cadence_after_two_build_ons",
    };
  }
  if (!ctx.decision || ctx.decision === "silent") {
    return { routeKind: null, reason: "judge_silent" };
  }
  if (ctx.decision === "acknowledge") {
    if (!ctx.backchannelGapPassed) return { routeKind: null, reason: "backchannel_gap" };
    if (!deterministicRateGate(ctx.sessionId, ctx.turnSeq, ctx.backchannelRate)) {
      return { routeKind: null, reason: "backchannel_rate" };
    }
    return { routeKind: "backchannel", reason: "backchannel" };
  }
  return { routeKind: "build_on", reason: "build_on" };
}

const CONVERGENCE_RE =
  /\b(?:let'?s (?:just )?(?:pick|choose|settle)|either [ABCD] or [ABCD]|we(?:'re| are) done|good enough)\b/i;

export function detectMediationEvidence(
  recentHumanMessages: string[],
): Array<"repetition" | "candidate_concentration" | "premature_convergence"> {
  const evidence = new Set<"repetition" | "candidate_concentration" | "premature_convergence">();
  const recent = recentHumanMessages.slice(-6);
  const joined = recent.join(" ");
  if (CONVERGENCE_RE.test(joined)) evidence.add("premature_convergence");

  const candidates = recent.flatMap((message) => {
    const matches = message.match(/\b(?:Candidate\s+)?([ABCD])(?:'s)?\b/g) ?? [];
    return matches.map((match) => match.match(/([ABCD])/i)?.[1]?.toUpperCase()).filter(Boolean);
  });
  if (recent.length >= 4 && candidates.length >= 4 && new Set(candidates).size <= 2) {
    evidence.add("candidate_concentration");
  }
  const normalized = recent.map((message) =>
    message
      .toLowerCase()
      .replace(/[^a-z0-9가-힣 ]/g, "")
      .trim(),
  );
  if (new Set(normalized.filter(Boolean)).size < normalized.filter(Boolean).length) {
    evidence.add("repetition");
  }
  return [...evidence];
}
