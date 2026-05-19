import { Message } from "../models/Message.js";
import type { SessionContext, Trigger } from "./types.js";
import { messageCountTrigger } from "./MessageCountTrigger.js";
import { timeIntervalTrigger } from "./TimeIntervalTrigger.js";
import { longSilenceTrigger } from "./LongSilenceTrigger.js";
import { sharedInfoTrigger } from "./SharedInfoTrigger.js";

//모든 트리거 등록
const allTriggers: Trigger[] = [
  messageCountTrigger,
  timeIntervalTrigger,
  longSilenceTrigger,
  sharedInfoTrigger,
];

//SessionContext 채움 - ctx 생성함
export async function buildSessionContext(
  sessionId: string,
  sessionCode: string,
): Promise<SessionContext> {
  const now = Date.now();

  //모든 메시지 카운트
  const totalMessageCount = await Message.countDocuments({ sessionId });

  //마지막 AI 메시지
  const lastAIMessage = await Message.findOne({ sessionId, senderRole: "ai" }).sort({ seq: -1 });

  //AI 이후 사람 메시지 수
  let messagesSinceLastAI: number;
  let secondsSinceLastAI: number | null;
  if (lastAIMessage) {
    messagesSinceLastAI = await Message.countDocuments({
      sessionId,
      seq: { $gt: lastAIMessage.seq },
      senderRole: { $ne: "ai" },
    });
    secondsSinceLastAI = Math.floor((now - (lastAIMessage as any).createdAt.getTime()) / 1000);
  } else {
    //AI 한 번도 발화 안 함 : 전체 사람 메시지 = messagesSinceLastAI
    messagesSinceLastAI = totalMessageCount;
    secondsSinceLastAI = null;
  }

  //마지막 메시지 (누구든)
  const lastMessage = await Message.findOne({ sessionId }).sort({ seq: -1 });
  const lastMessageSeq = lastMessage?.seq ?? 0;
  const secondsSinceLastMessage = lastMessage
    ? Math.floor((now - (lastMessage as any).createdAt.getTime()) / 1000)
    : null;
  return {
    sessionId,
    sessionCode,
    totalMessageCount,
    lastMessageSeq,
    messagesSinceLastAI,
    secondsSinceLastAI,
    secondsSinceLastMessage,
  };
}

//트리거 평가 - ctx 값을 가지고 트리거 평가
export async function evaluateTriggers(ctx: SessionContext): Promise<Trigger | null> {
  for (const trigger of allTriggers) {
    const fired = await trigger.shouldFire(ctx);
    if (fired) {
      console.log(
        `[trigger] fired: ${trigger.name} (session=${ctx.sessionCode}, msgsSinceAI=${ctx.messagesSinceLastAI}, secsSinceAI=${ctx.secondsSinceLastAI}, secsSinceLastMsg=${ctx.secondsSinceLastMessage})`,
      );
      return trigger;
    }
  }
  return null;
}
