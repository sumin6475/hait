//Socket.IO 이벤트 타입 정의 = discriminated union
// server/src/sockets/events.ts 파일과 동기화 필요
import type { ParticipantRole, SenderRole } from "../types/index.js";

export type ClientToServerEvents = {
  "join-session": (payload: { sessionCode: string; participantCode: string }) => void;
  "send-message": (payload: { content: string }) => void;
  "join-waiting": (payload: { sessionCode: string; participantCode: string }) => void;
  "typing": (payload: { isTyping: boolean }) => void; // 입력 중 표시 (작성중)
};

export type ServerToClientEvents = {
  "session-ready": (payload: {
    sessionCode: string;
    participantCount: number;
    startedAt: string;
  }) => void;
  "join-error": (payload: { reason: string }) => void;
  "new-message": (payload: {
    seq: number;
    sender: string;
    senderRole: SenderRole;
    content: string;
    createdAt: string;
  }) => void;
  "message-failed": (payload: { reason: string }) => void;
  "peer-disconnected": (payload: { role: ParticipantRole }) => void;
  "peer-reconnected": (payload: { role: ParticipantRole }) => void;
  "peer-typing": (payload: { role: ParticipantRole; isTyping: boolean }) => void; // 상대 입력 중 (작성중)
  "ai-typing": (payload: { isTyping: boolean }) => void; // [Tier 1] AI 작성 중 표시
  "session-history": (payload: {
    messages: Array<{
      seq: number;
      sender: string;
      senderRole: SenderRole;
      content: string;
      createdAt: string;
    }>;
    startedAt?: string | null; // [Step 26-A] 서버 기준 타이머 동기화
    aiName?: string; // [Step 30] 조건별 AI 표시명 (CTRL은 undefined)
  }) => void;
  "waiting-update": (payload: { participantsReady: number; expected: number }) => void;
  "both-ready": (payload: { sessionCode: string }) => void;
};

export type SocketData = {
  sessionCode: string;
  sessionId: string;
  participantCode: string;
  role: ParticipantRole;
};
