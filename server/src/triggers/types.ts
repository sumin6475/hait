//트리거 평가에 필요한 세션 상태
export interface SessionContext {
  sessionId: string;
  sessionCode: string;
  totalMessageCount: number;
  lastMessageSeq: number; //마지막 메시지의 seq
  messagesSinceLastAI: number; //AI가 발화한 후 온 메시지 수
  secondsSinceLastAI: number | null; //null: AI가 한번도 발화하지 않은 상태
  secondsSinceLastMessage: number | null; //null: 메시지가 0개
}

//모든 트리거 형태
export interface Trigger {
  name: string;
  shouldFire(ctx: SessionContext): boolean | Promise<boolean>;
}
