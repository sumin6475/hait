import { createHash } from "node:crypto";
import type { ConditionCode, MainJudgeDecision, PriorityRoute, RouteKind } from "../types.js";

export interface AddressDetection {
  addressed: boolean;
  evidence: "name_prefix" | "name_suffix" | "direct_request" | "none";
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
  `${NAME}[^.!?]{0,80}(?:can you|could you|would you|please|tell|explain|share|answer|what|why|how|which|do you|알려|말해|답해|어떻게|뭐|왜)`,
  "i",
);

export function detectDirectAddress(message: string): AddressDetection {
  const text = message.trim();
  if (!text || THIRD_PERSON.test(text)) return { addressed: false, evidence: "none" };
  if (PREFIX.test(text)) return { addressed: true, evidence: "name_prefix" };
  if (SUFFIX.test(text)) return { addressed: true, evidence: "name_suffix" };
  if (DIRECT_REQUEST.test(text)) return { addressed: true, evidence: "direct_request" };
  return { addressed: false, evidence: "none" };
}

export interface MediationStateView {
  latched: boolean;
  buildOnsSinceMediation: number;
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
  reason:
    | "priority"
    | "judge_silent"
    | "backchannel_gap"
    | "backchannel_rate"
    | "backchannel"
    | "build_on"
    | "mediation";
}

export function deterministicRateGate(
  sessionId: string,
  turnSeq: number,
  rate: number,
): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const hex = createHash("sha256").update(`${sessionId}:${turnSeq}:backchannel`).digest("hex");
  const sample = Number.parseInt(hex.slice(0, 8), 16) / 0xffffffff;
  return sample < rate;
}

export function resolveRoute(ctx: ResolverContext): ResolvedRoute {
  if (ctx.priorityRoute) return { routeKind: ctx.priorityRoute, reason: "priority" };
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
  const leader = ctx.conditionCode === "C2" || ctx.conditionCode === "C4";
  if (leader && ctx.mediation.latched && ctx.mediation.buildOnsSinceMediation >= 2) {
    return { routeKind: "mediation", reason: "mediation" };
  }
  return { routeKind: "build_on", reason: "build_on" };
}

const CONVERGENCE_RE = /\b(?:let'?s (?:just )?(?:pick|choose|settle)|either [ABCD] or [ABCD]|we(?:'re| are) done|good enough)\b/i;

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
  const normalized = recent.map((message) => message.toLowerCase().replace(/[^a-z0-9가-힣 ]/g, "").trim());
  if (new Set(normalized.filter(Boolean)).size < normalized.filter(Boolean).length) {
    evidence.add("repetition");
  }
  return [...evidence];
}
