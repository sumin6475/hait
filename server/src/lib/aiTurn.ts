//handle AI turn logic
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { callAIStructured } from "./openai.js";
import type { Trigger, SessionContext } from "../triggers/types.js";
import { buildSystemPromptWithDiscipline, buildUserPromptFromMessages, buildClosingPrompt, SOCIAL_PROMPT } from "./prompts.js";
import { computeCue, type SpeakingReason } from "./computeCue.js";
import type { ConditionCode } from "../types.js";

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
  conditionCode: ConditionCode,
  opts?: { closing?: boolean; reason?: SpeakingReason; social?: boolean },
) {
  //락 체크
  if (aiTurnLock.has(sessionCode)) {
    console.log(`[ai-turn] skipped: ${sessionCode} already in progress`);
    return;
  }
  aiTurnLock.add(sessionCode);

  try {
    //prompt 생성 = prompts.ts

    // 라이브 transcript 로드 (프롬프트 + cue 계산 공용)
    const allMessages = await Message.find({ sessionId }).sort({ seq: 1 });
    const msgs = allMessages.map((m) => ({ sender: m.sender, content: m.content }));

    // cue/프롬프트 분기 — closing(전용·주입X·기록"closing") / social(전용·주입X·기록"social") / main(transcript로 계산·주입)
    const isSocial = opts?.social === true;
    const cue: SpeakingReason = opts?.closing
      ? "closing"
      : (opts?.reason ?? computeCue({ messages: msgs, phase: "main" }));
    const injectedReason = opts?.closing || isSocial ? undefined : cue; // closing/social은 task cue 주입 안 함

    const systemPrompt = opts?.closing
      ? buildClosingPrompt(conditionCode) // closing: 전용 프롬프트 (Step 4/B)
      : isSocial
        ? SOCIAL_PROMPT // social: 전용 프롬프트 (Step 9/P2) — task 페르소나(조작) 우회, 조건 무관
        : buildSystemPromptWithDiscipline(conditionCode);
    const userPrompt = buildUserPromptFromMessages(msgs, injectedReason); // social도 transcript 받음 → 직전 맥락 반영
    const loggedCue = isSocial ? "social" : cue; // 기록용 cue (social은 SpeakingReason이 아니므로 분리)

    console.log(`[ai-turn] calling AI for session ${sessionCode} (trigger=${trigger.name})`);

    //AI 호출 - structured output (stateless: previous_response_id 체이닝 제거 — Step 2/E)
    const result = await callAIStructured({ systemPrompt, userPrompt });

    //공통 메타 - 성공/실패 둘 다 기록
    const commonMeta = {
      sessionId,
      turnIndex: ctx.lastMessageSeq,
      triggerReason: opts?.closing ? "closing" : trigger.name, // provenance
      cue: loggedCue, // Step 6/G·R5 + Step 9/P2: provenance (social이면 "social", 그 외 task cue/closing)
      model: result.model,
      prompt: userPrompt,
    };

    // 분기1 - 호출 실패
    if (!result.ok) {
      console.error(`[ai-turn] failed: (${result.reason}): ${result.error}`);
      await AIIntervention.create({
        ...commonMeta,
        decision: "stay_silent",
        error: `${result.reason}: ${result.error}`,
      });
      return;
    }

    // 분기2 - 호출 성공 -> DB 저장 + broadcast
    const lastMsg = await Message.findOne({ sessionId }).sort({ seq: -1 });
    const nextSeq = (lastMsg?.seq ?? 0) + 1;

    //MessageDB 저장
    const savedMessage = await Message.create({
      sessionId,
      sender: "ai",
      senderRole: "ai",
      content: result.parsed.content,
      seq: nextSeq,
      sharedInfoIds: [],
    });

    //AIIntervention DB 저장
    await AIIntervention.create({
      ...commonMeta,
      decision: "speak",
      generateMessageId: savedMessage._id,
      responseId: result.requestId,
      response: result.parsed.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      systemFingerprint: result.systemFingerprint,
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
