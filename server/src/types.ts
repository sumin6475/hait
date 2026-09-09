//client/src/types/index.ts와 동기화 유지

//실험 조건
export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type AIStatus = "peer" | "leader";
export type CommStrategy = "xai" | "aci";

//참가자 / 세션
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";

// 후보 (Candidate A/B/C/D)
export type Candidate = "A" | "B" | "C" | "D";

// 프로필 슬롯
export type ProfileSlot = "X" | "Y" | "Z";

// 메시지 발신자 역할
export type SenderRole = ParticipantRole | "ai";

// AI 평가 결과
export type AIDecision = "speak" | "stay_silent";

// 정보 긍정/부정
export type Valence = "positive" | "negative";

//연구자 승인 게이트 — id는 잠금 해제하는 단계명 (Step 32)
export type GateId = "consent" | "demographics" | "infoCards" | "waiting" | "teamDecision" | "debrief";
export const GATE_ORDER: GateId[] = ["consent", "demographics", "infoCards", "waiting", "teamDecision", "debrief"];

//참가자 진행 단계 (재접속 분기용)
export type ProgressStep =
  | "consent"
  | "demographics"
  | "infoCards"
  | "preDiscussion"
  | "waiting"
  | "teamDecision"
  | "postSurvey"
  | "debrief"
  | "complete";

// [Tier 0] AI 발화 경로 종류 — 분석/관측용
export type PriorityRoute = "address" | "followup" | "long_silence" | null;
export type MainJudgeDecision = "contribute" | "acknowledge" | "silent";
export type CommunicativeAct =
  | "answer"
  | "participate"
  | "follow"
  | "contribute"
  | "acknowledge"
  | "mediate";
// Where a turn was decided. Keep this separate from the Main Judge result so
// cooldown, timer, priority, and route-gate suppressions remain distinguishable.
export type InterventionDecisionStage =
  | "priority"
  | "cooldown"
  | "main_judge"
  | "route_gate"
  | "long_silence_timer"
  | "summary"
  | "lifecycle"
  | "system";
export type RouteKind =
  | "address"
  | "followup"
  | "long_silence"
  | "build_on"
  | "mediation"
  | "backchannel"
  | "greeting"
  | "summary"
  | "closing";

/**
 * The routes that do not move the board.
 *
 * A greeting and a backchannel carry no trait; a summary and a closing recite
 * what is already up rather than contribute to it. Three consequences follow
 * from the one fact and they must not drift apart: these turns are not pooled,
 * they are not handed the list of Alex's unsaid notes, and they are not counted
 * as missing a disclosure record.
 *
 * The list had three copies before it had a name, which is the same shape as
 * the trait wording that cost T-C2-047 turn 9.
 */
export const NON_CONTRIBUTING_ROUTES: readonly RouteKind[] = [
  "greeting",
  "backchannel",
  "summary",
  "closing",
];

export function contributesToBoard(routeKind: string): boolean {
  return !NON_CONTRIBUTING_ROUTES.includes(routeKind as RouteKind);
}

export type TurnOutcome =
  | "reserved"
  | "cancelled"
  | "stay_silent"
  | "generation_failed"
  | "saved"
  | "broadcast";

// [Tier 0] 리라우트 사유 (judge 침묵 때 natural reroute 등)
// Legacy analysis fields remain readable while V2 writes explicit route outcomes.
export type RerouteReason = "judge_silent" | "peer_mediation" | "opening" | "none";

// [Tier 0] 쿨다운 면제 사유
export type ExemptReason = "address" | "followup" | "long_silence" | "none";

// [Tier 0] AI 턴 메타 — AIIntervention에 영속
export interface TurnMeta {
  routeKind: RouteKind;
  judgeSpeak: boolean | null;    // null if judge not called
  judgeReason: string | null;    // null if judge not called
  rerouted: boolean;
  rerouteReason: RerouteReason;
  exemptReason: ExemptReason;
}

export interface TurnReservation {
  id: string;
  anchorSeq: number;
  routeKind: Exclude<RouteKind, "greeting" | "closing">;
  priorityRoute: PriorityRoute;
  judgeDecision: MainJudgeDecision | null;
  dueAt: number;
  source: "push" | "long_silence" | "summary";
}
