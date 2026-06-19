//handle AI turn logic
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { callAIStructured } from "./openai.js";
import type { Trigger, SessionContext } from "../triggers/types.js";
import { buildSystemPromptForTask, buildUserPromptFromMessages, buildClosingPrompt, buildSummaryPrompt, buildLeaderDepth, buildPeerDepth, buildNaturalPrompt } from "./prompts.js"; // [Step 39] depth 빌더 / [EXP] buildNaturalPrompt
import { computeCue, type SpeakingReason } from "./computeCue.js";
import { Session } from "../models/Session.js";
import { computeTally, formatTally, surfacedByCandidate, currentTopicCandidate } from "./poolingTally.js"; // [Step 39]
import { extractSurfacedTraits } from "./poolingExtractor.js";
import { updateAiSurfaced } from "./poolingDV.js";
import { allocSeq } from "./seq.js";
import type { ConditionCode, ParticipantRole } from "../types.js";
import { log } from "./log.js";
import { transcriptLabel } from "./labels.js";
import { buildCalloutTail } from "./prompts.js";
import { maybeKoLang } from "./koPilot.js"; // [KO-PILOT]
import { type Cand } from "./traitData.js";
import { TRIGGER_CONFIG } from "../config/triggers.js"; // [Step 37] DEPTH_MIN_PER_CAND

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
  opts?: {
    closing?: boolean;
    reason?: SpeakingReason;
    summary?: boolean; // Step 22: leader 중간정리 (전용 프롬프트, tally/cue 미주입)
    summaryLeader?: Cand | null; // [Step 37] summary가 선언할 현재 1등 (null=동률→박빙 분기)
    summaryTransition?: string; // 전이 기록 (AIIntervention.why로 영속)
    recentSummaryLeader?: string; // Step 22/C-2: 직전 summary가 선언한 1등 (task 턴 wobble 가드)
    callout?: { target: string; targetRole: ParticipantRole; cand?: Cand }; // [Step 30] 지목 호명 overlay
    bypassDoublePost?: boolean; // [Step 43] anti-double-post 면제 — 답→summary 쌍의 summary 한정
  },
) {
  //락 체크
  if (aiTurnLock.has(sessionCode)) {
    log.debug(`[ai-turn] skipped: ${sessionCode} already in progress`);
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
    if (!opts?.closing && !opts?.bypassDoublePost && last && last.senderRole === "ai") {
      log.debug(`[ai-turn] skipped: last message already AI (anti-double-post) ${sessionCode}`);
      return;
    }
    // [Step 30] transcript 라벨 = 화면 라벨 ("Alex" / "Participant X") — 지목 시 부르는 이름 일치.
    // DB Message.sender(participantCode)는 불변 — 프롬프트 층만 변경. computeCue는 content만 사용.
    const msgs = allMessages.map((m) => ({
      sender: transcriptLabel(m.senderRole),
      content: m.content,
    }));

    // cue/프롬프트 분기 — closing/summary(전용) / main(transcript로 계산)
    const isSummary = opts?.summary === true;
    const cue: SpeakingReason = opts?.closing
      ? "closing"
      : (opts?.reason ?? computeCue({ messages: msgs, phase: "main" }));
    // [EXP] directed_followup이면 status-only 자연발화 경로 — tally/depth 미주입.
    const isNatural = TRIGGER_CONFIG.EXP_NATURAL_DIRECTED && cue === "directed_followup";

    // tally + depth 주입 (Step 14a/37) — task 턴만 (closing/summary는 의견·질문 턴이 아님). Alex-시점 on-table 집계.
    let tallyText: string | undefined;
    let depthNote: string | undefined;
    if (!opts?.closing && !isSummary) {
      const session = await Session.findById(sessionId).select("revealStats").lean();
      const rs = (session as any)?.revealStats;
      tallyText = formatTally(computeTally(rs));
      // [Step 39] depth v2 — 고정 리스트 대신 '지금 사람들이 다루는 후보 C*'를 추적.
      // C*가 얕으면(<임계) 조건별 노트 주입. C* null(언급 없음/비교 중) 또는 충분히 표면화 → 미주입(자동 릴리스).
      const cstar = currentTopicCandidate(msgs);
      const thin =
        cstar != null && (surfacedByCandidate(rs)[cstar] ?? 0) < TRIGGER_CONFIG.DEPTH_MIN_PER_CAND;
      const isLeader = conditionCode === "C2" || conditionCode === "C4";
      depthNote = thin ? (isLeader ? buildLeaderDepth(cstar!) : buildPeerDepth(cstar!)) : undefined;
      // [depth obs · 임시] 주입 여부만 — 실제 발화에 먹혔는지는 메시지로 확인. natural 턴은 depth 미사용이라 제외.
      if (!isNatural)
        log.info(`[depth] ${depthNote ? `active (${cstar})` : "none"} (session=${sessionCode})`);
    }

    let systemPrompt = opts?.closing
      ? buildClosingPrompt(conditionCode) // closing: 전용 프롬프트 (Step 4/B)
      : isSummary
        ? buildSummaryPrompt(conditionCode, opts?.summaryLeader ?? null) // summary: leader 중간정리 (Step 22/37) — 선언형 or 박빙
        : isNatural
          ? buildNaturalPrompt(conditionCode) // [EXP] status-only 자연발화 (행동스펙·tally·depth 미주입)
          : buildSystemPromptForTask(conditionCode, cue, tallyText, depthNote); // Step 12 조립 + tally + depth
    // Step 22/C-2: 직전 summary로 선언한 1등과의 일관성 한 줄 (task 턴만, wobble 보강 — 주 가드는 tally)
    if (!opts?.closing && !isSummary && opts?.recentSummaryLeader) {
      systemPrompt += `\n\n[Moments ago you told the team ${opts.recentSummaryLeader} is looking strongest right now — stay consistent with that unless the table has genuinely shifted.]`;
    }
    // [Step 30] 지목 호명 tail — task 턴에만 (closing/summary엔 구조적으로 옵션이 안 옴)
    if (!opts?.closing && !isSummary && opts?.callout) {
      systemPrompt += buildCalloutTail(conditionCode, opts.callout.target, opts.callout.cand);
    }
    systemPrompt = await maybeKoLang(systemPrompt, sessionId); // [KO-PILOT] ko 세션이면 한국어 출력 지시 append (전 분기 단일 수렴점)
    const userPrompt = buildUserPromptFromMessages(msgs);
    const loggedCue = isSummary ? "summary" : cue; // 기록용 cue

    log.debug(`[ai-turn] calling AI for session ${sessionCode} (trigger=${trigger.name})`);

    //AI 호출 - structured output (stateless: previous_response_id 체이닝 제거 — Step 2/E)
    const result = await callAIStructured({ systemPrompt, userPrompt });

    //공통 메타 - 성공/실패 둘 다 기록
    const commonMeta = {
      sessionId,
      turnIndex: ctx.lastMessageSeq,
      triggerReason: opts?.closing ? "closing" : trigger.name, // provenance (summary는 trigger.name="summary")
      cue: loggedCue, // Step 6/G·R5 + Step 9/P2: provenance (social이면 "social", 그 외 task cue/closing/summary)
      why: opts?.summaryTransition, // Step 22/D: summary 전이 기록 (예: "T2(A→C)") — S20 why 필드 재사용
      model: result.model,
      prompt: userPrompt,
      calloutTarget: opts?.callout?.target, // [Step 30] "Participant Y" — 지목 DV (조건 간 비교: leader>0 · peer=0)
      calloutCand: opts?.callout?.cand, // [Step 30] C4만
    };

    // 분기1 - 호출 실패
    if (!result.ok) {
      log.error(`[ai-turn] failed: (${result.reason}): ${result.error}`);
      await AIIntervention.create({
        ...commonMeta,
        decision: "stay_silent",
        error: `${result.reason}: ${result.error}`,
      });
      return;
    }

    // 분기2 - 호출 성공 -> DB 저장 + broadcast
    const nextSeq = await allocSeq(sessionId); // 원자 발급 (Step 18) — AI 생성 중 도착한 사람 메시지와 충돌 없음

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

    // pooling DV (Step 19) — Alex가 표면화한 trait를 AI 집합에 적재 (사람 집합과 분리). 응답경로 안 막음.
    // social/react/closing 턴도 추출되지만 trait 없으면 [] → 무해. $addToSet dedup이라 재진술 중복 안 셈.
    if (result.parsed.content.length >= 15) {
      void extractSurfacedTraits(result.parsed.content)
        .then((ids) => {
          if (ids.length) log.info(`[pooling] AI surfaced ${JSON.stringify(ids)} (session=${sessionCode})`);
          return updateAiSurfaced(sessionId, ids);
        })
        .catch((e) => log.error("[pooling] AI extract error:", e));
    }
    log.info(
      `[ai-turn] AI spoke in ${sessionCode} seq=${savedMessage.seq} latency=${result.latencyMs}ms`,
    );
  } catch (error) {
    log.error(`[ai-turn] error: ${error}`);
  } finally {
    aiTurnLock.delete(sessionCode);
  }
}
