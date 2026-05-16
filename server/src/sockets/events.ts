//Socket.IO 이벤트 타입 정의 = discriminated union
//server/client 통신 이벤트 정의

export type ClientToServerEvents = {
  "join-session": (payload: { sessionCode: string; participantCode: string }) => void;
};

export type ServerToClientEvents = {
  "session-ready": (payload: { sessionCode: string; participantCount: number }) => void;
  "join-error": (payload: { reason: string }) => void;
};
