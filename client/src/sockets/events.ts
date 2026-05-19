//Socket.IO 이벤트 타입 정의 = discriminated union
// server/src/sockets/events.ts 파일과 동기화 필요
import type { ParticipantRole, SenderRole } from "../types/index.js";

export type ClientToServerEvents = {
  "join-session": (payload: { sessionCode: string; participantCode: string }) => void;
  "send-message": (payload: { content: string }) => void;
};

export type ServerToClientEvents = {
  "session-ready": (payload: { sessionCode: string; participantCount: number }) => void;
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
  "session-history": (payload: {
    messages: Array<{
      seq: number;
      sender: string;
      senderRole: SenderRole;
      content: string;
      createdAt: string;
    }>;
  }) => void;
};

export type SocketData = {
  sessionCode: string;
  sessionId: string;
  participantCode: string;
  role: ParticipantRole;
};
