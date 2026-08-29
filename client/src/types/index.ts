// Experiment condition types
export type ConditionCode = "C1" | "C2" | "C3" | "C4" | "CTRL";
export type AIStatus = "peer" | "leader";
export type CommStrategy = "xai" | "aci";
export type ParticipantRole = "humanX" | "humanY" | "humanZ";
export type SessionStatus = "waiting" | "in_progress" | "completed" | "data_ready";
export type Candidate = "A" | "B" | "C" | "D";
export type SenderRole = ParticipantRole | "ai";
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

export interface Condition {
  id: string;
  code: ConditionCode;
  status: AIStatus;
  strategy: CommStrategy;
  systemPrompt: string;
  leaderScripts?: {
    opening: string;
    transition: string;
    midCheck: string;
    turnAssignment: string;
    finalPrompt: string;
  };
  version: number;
  updatedAt: string;
}

export interface Participant {
  id: string;
  participantCode: string;
  conditionCode: ConditionCode;
  sessionId: string;
  role: ParticipantRole;
  preDiscussionChoice?: Candidate;
  recallTest?: { A: string; B: string; C: string; D: string }; //[Step 34]
  demographics?: { age: number; gender: string; major: string };
  connectedAt?: string;
  lastSeenAt?: string;
  completedAt?: string;
}

export interface Session {
  id: string;
  sessionCode: string;
  conditionCode: ConditionCode;
  participants: Participant[];
  status: SessionStatus;
  startedAt?: string;
  endedAt?: string;
  teamDecision?: Candidate[];
  metadata?: {
    totalTurns: number;
    humanTurns: number;
    aiTurns: number;
    durationSeconds: number;
  };
}

//DB에 저장되는 메시지 타입
export interface Message {
  id: string;
  sessionId: string;
  sender: string;
  senderRole: SenderRole;
  content: string;
  timestamp: string;
}

export interface SurveyResponse {
  id: string;
  participantId: string;
  participantCode: string;
  sessionId: string;
  conditionCode: ConditionCode;
  type: "trust" | "manipulation_check" | "demographics";
  responses: Record<string, number | string>;
  completedAt: string;
}

//UI에 표시되는 메시지 타입
export interface ChatMessage {
  id: string;
  sender: string;
  senderRole: "you" | "other" | "ai";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  senderName: string; // [Step 30] 사람: "Participant X/Y/Z" · AI: ""(렌더 시 aiName state 사용)
}

export interface InfoCard {
  id: string;
  candidate: Candidate;
  attribute: string;
  valence: "positive" | "negative";
}
