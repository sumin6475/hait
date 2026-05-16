//Socket.IO 이벤트 타입 정의 = discriminated union
// server/src/sockets/events.ts 파일과 동기화 필요

export type ClientToServerEvents = {
  "join-session": (payload: { sessionCode: string; participantCode: string }) => void;
};

export type ServerToClientEvents = {
  "session-ready": (payload: { sessionCode: string; participantCount: number }) => void;
  "join-error": (payload: { reason: string }) => void;
};
