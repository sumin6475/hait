//handle AI turn logic
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { callAIStructured } from "./openai.js";
import type { Trigger, SessionContext } from "../triggers/types.js";
import { buildSystemPromptForTask, buildUserPromptFromMessages, buildClosingPrompt, buildReactPrompt, buildSummaryPrompt, SOCIAL_PROMPT } from "./prompts.js";
import { computeCue, type SpeakingReason } from "./computeCue.js";
import { Session } from "../models/Session.js";
import { computeTally, formatTally } from "./poolingTally.js";
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
  opts?: { closing?: boolean; reason?: SpeakingReason; social?: boolean; react?: boolean; summary?: boolean },
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
    // 더블포스트 가드 (Step 13/결함 2): 사람 메시지 2개가 거의 동시에 push 2개를 통과시켜도
    // 직전 push가 방금 발화했으면 중단. closing은 예외(타이머 클로징은 마지막이 AI여도 발동).
    const last = allMessages[allMessages.length - 1];
    if (!opts?.closing && last && last.senderRole === "ai") {
      console.log(`[ai-turn] skipped: last message already AI (anti-double-post) ${sessionCode}`);
      return;
    }
    const msgs = allMessages.map((m) => ({ sender: m.sender, content: m.content }));

    // cue/프롬프트 분기 — closing(전용·기록"closing") / social·react(전용·기록"social"/"react") / main(transcript로 계산)
    const isSocial = opts?.social === true;
    const isReact = opts?.react === true;
    const isSummary = opts?.summary === true;
    const cue: SpeakingReason = opts?.closing
      ? "closing"
      : (opts?.reason ?? computeCue({ messages: msgs, phase: "main" }));

    // tally 주입 (Step 14a) — task/summary 턴만 (social/react/closing은 의견 턴이 아님). Alex-시점 on-table 집계.
    let tallyText: string | undefined;
    if (!opts?.closing && !isSocial && !isReact) {
      const session = await Session.findById(sessionId).select("revealStats").lean();
      tallyText = formatTally(computeTally((session as any)?.revealStats));
    }

    const systemPrompt = opts?.closing
      ? buildClosingPrompt(conditionCode) // closing: 전용 프롬프트 (Step 4/B)
      : isSocial
        ? SOCIAL_PROMPT // social: 전용 프롬프트 (Step 9/P2) — task 페르소나(조작) 우회, 조건 무관
        : isReact
          ? buildReactPrompt(conditionCode) // react: 전용 프롬프트 (Step 13) — 가벼운 ack, task 페르소나 우회
          : isSummary
            ? buildSummaryPrompt(tallyText) // summary: leader 중간정리 (Step 15/Phase 2) — tally 기반 선언형
            : buildSystemPromptForTask(conditionCode, cue, tallyText); // Step 12 조립 + Step 14a tally
    const userPrompt = buildUserPromptFromMessages(msgs); // social/react도 transcript 받음 → 직전 맥락 반영
    const loggedCue = isSocial ? "social" : isReact ? "react" : isSummary ? "summary" : cue; // 기록용 cue

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
