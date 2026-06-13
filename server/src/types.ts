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
