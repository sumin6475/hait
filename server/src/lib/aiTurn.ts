//handle AI turn logic
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { callAI } from "./openai.js";
import type { Trigger, SessionContext } from "../triggers/types.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

//동시 호출 방지 - 세션별 락
const aiTurnLock = new Set<string>();

//트리거 발동 -> AI 호출 -> DB 저장 -> broadcast
export async function handleAITurn(
  io: IO,
  sessionCode: string,
  sessionId: string,
  trigger: Trigger,
  ctx: SessionContext,
) {
  //락 체크
  if (aiTurnLock.has(sessionCode)) {
    console.log(`[ai-turn] skipped: ${sessionCode} already in progress`);
    return;
  }
  aiTurnLock.add(sessionCode);

  try {
    //최근 메시지 10개 fetch - prompt에 넣을거
    const recentMessages = await Message.find({ sessionId }).sort({ seq: -1 }).limit(10);
    const orderedMessages = recentMessages.reverse(); //오래된 -> 최신순

    //임시 prompt
    const systemPrompt =
      "You are Alex, a thoughtful AI participant in a 3-person team discussion about choosing a candidate. " +
      "Reply briefly (1-2 sentences). Be natural, conversational, and contribute meaningfully.";
    const userPrompt = orderedMessages.map((m) => `${m.sender} : ${m.content}`).join("\n");

    console.log(`[ai-turn] calling AI for session ${sessionCode} (trigger= ${trigger.name})`);

    //AI 호출
    const result = await callAI({ systemPrompt, userPrompt });
    if (!result.ok) {
      console.error(`[ai-turn] failed: (${result.reason}): ${result.error}`);
      //실패도 AIIntervention 기록
      await AIIntervention.create({
        sessionId,
        turnIndex: ctx.lastMessageSeq,
        triggerReason: trigger.name,
        decision: "stay_silent",
        model: "gpt-5-mini",
        error: `${result.reason}: ${result.error}`,
      });
      return;
    }

    //메시지 seq
    const lastMsg = await Message.findOne({ sessionId }).sort({ seq: -1 });
    const nextSeq = (lastMsg?.seq ?? 0) + 1;

    //MessageDB 저장
    const savedMessage = await Message.create({
      sessionId,
      sender: "ai",
      senderRole: "ai",
      content: result.content,
      seq: nextSeq,
      sharedInfoIds: [],
    });

    //AIIntervention DB 저장
    await AIIntervention.create({
      sessionId,
      turnIndex: ctx.lastMessageSeq,
      triggerReason: trigger.name,
      decision: "speak",
      generateMessageId: savedMessage._id,
      responseId: result.requestId,
      model: "gpt-5-mini",
      prompt: userPrompt,
      response: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
    });
    //broadcast
    io.to(sessionCode).emit("new-message", {
      seq: savedMessage.seq,
      sender: savedMessage.sender,
      senderRole: savedMessage.senderRole,
      content: savedMessage.content,
      createdAt: (savedMessage as any).createdAt.toISOString(),
    });
    console.log(
      `[ai-turn] AI spoke in ${sessionCode} seq=${savedMessage.seq} latency=${result.latencyMs}ms`,
    );
  } catch (error) {
    console.error(`[ai-turn] error: ${error}`);
  } finally {
    aiTurnLock.delete(sessionCode);
  }
}
