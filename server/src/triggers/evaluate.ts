import { Message } from "../models/Message.js";
import type { SessionContext, Trigger } from "./types.js";
import { messageCountTrigger } from "./MessageCountTrigger.js";
import { timeIntervalTrigger } from "./TimeIntervalTrigger.js";
import { longSilenceTrigger } from "./LongSilenceTrigger.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { ADDRESS_RE } from "../lib/computeCue.js";

// Legacy trigger evaluator: no live socket path imports this after Intervention V2.

// 명시 호명("Alex") 합성 트리거 — evaluateTriggers에서 직접 판정 (Step 5/F)
const addressTrigger: Trigger = { name: "address", shouldFire: () => true };

//일반 트리거 목록 — sharedInfoTrigger는 비활성 유지(2×2 보존) → 제외
const normalTriggers: Trigger[] = [messageCountTrigger, timeIntervalTrigger, longSilenceTrigger];

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
  const lastMessageText = lastMessage?.content ?? "";
  const lastMessageIsAI = lastMessage?.senderRole === "ai";
  return {
    sessionId,
    sessionCode,
    totalMessageCount,
    lastMessageSeq,
    messagesSinceLastAI,
    secondsSinceLastAI,
    secondsSinceLastMessage,
    lastMessageText,
    lastMessageIsAI,
  };
}

//트리거 평가 — 우선순위 게이트 (Step 5/F): 명시 호명 > cooldown > 일반 트리거 OR
export async function evaluateTriggers(ctx: SessionContext): Promise<Trigger | null> {
  // 1) 명시 호명 — 최우선. cooldown/임계값 무시하고 즉답. (AI 자기 메시지는 제외)
  if (!ctx.lastMessageIsAI && ADDRESS_RE.test(ctx.lastMessageText)) {
    console.log(`[trigger] fired: address (session=${ctx.sessionCode})`);
    return addressTrigger;
  }
  // 2) cooldown — 방금 말했으면 사람 메시지 N개 전까진 silent (독점 방지)
  if (ctx.messagesSinceLastAI < TRIGGER_CONFIG.COOLDOWN_MIN_MSGS) {
    return null;
  }
  // 3) 일반 트리거 — OR 첫매치
  for (const trigger of normalTriggers) {
    if (await trigger.shouldFire(ctx)) {
      console.log(
        `[trigger] fired: ${trigger.name} (session=${ctx.sessionCode}, msgsSinceAI=${ctx.messagesSinceLastAI}, secsSinceAI=${ctx.secondsSinceLastAI}, secsSinceLastMsg=${ctx.secondsSinceLastMessage})`,
      );
      return trigger;
    }
  }
  return null;
}
