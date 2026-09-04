import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import type {
  ConditionCode,
  InterventionDecisionStage,
  MainJudgeDecision,
  PriorityRoute,
  RouteKind,
} from "../types.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { Message } from "../models/Message.js";
import { Session } from "../models/Session.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { buildFollowupCandidateTranscript, judgeFollowupToAlex } from "./followupJudge.js";
import { judgeIntervention, JUDGE_WINDOW_SIZE } from "./interventionJudge.js";
import {
  detectDirectAddress,
  detectMediationEvidence,
  evaluateLongSilenceGate,
  mediationBuildOnCountAfterSuccessfulRoute,
  resolveRoute,
} from "./interventionRoutingV2.js";
import {
  decidePreferenceFromVisibleCoverage,
  deriveFocusDepthState,
  deriveMainJudgeSignal,
  formatVisibleBoardCoverage,
  formatMainJudgeSignal,
  isLeaderCondition,
  type TranscriptMessage,
} from "./routeContext.js";
import { executeRouteTurn } from "./routeTurn.js";
import { transcriptLabel } from "./labels.js";
import { log } from "./log.js";
import { allocSeq } from "./seq.js";
import { getRoutePrompt } from "./routePromptRegistry.js";
import { PEER_CLOSING } from "./prompts.js";
import { KO_PEER_CLOSING } from "./koPilot.js";
import { TRAIT_BY_ID, type Cand } from "./traitData.js";
import { humanConfirmedIds } from "./informationPools.js";
import { currentTopicCandidate } from "./poolingTally.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type SummaryStatus = "not_eligible" | "pending" | "generating" | "done";

interface Reservation {
  id: string;
  anchorSeq: number;
  routeKind: Exclude<RouteKind, "greeting" | "closing">;
  priorityRoute: PriorityRoute;
  priorityEvidence?: string;
  mainJudgeDecision: MainJudgeDecision | null;
  judgeEvidence?: string | null;
  selectedTraitId?: string | null;
  focusCandidate?: Cand | null;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons";
  decisionStage: InterventionDecisionStage;
  routeReason?: string;
  floorMs: number;
  source: "push" | "long_silence" | "summary";
  timer: NodeJS.Timeout;
}

interface RuntimeState {
  io: IO;
  sessionCode: string;
  sessionId: string;
  conditionCode: ConditionCode;
  startedAt: number;
  lifecycle: "active" | "closing" | "muted";
  latestPushSeq: number;
  initialized?: Promise<void>;
  reservation?: Reservation;
  longSilenceTimer?: NodeJS.Timeout;
  closingTimer?: NodeJS.Timeout;
  busy: boolean;
  typingOwners: Set<string>;
  typingVisible: boolean;
  summaryStatus: SummaryStatus;
  mediationLatched: boolean;
  mediationEvidence: string[];
  mediationLatchedAt?: number;
  mediationLatchedHumanCount?: number;
  buildOnsSinceMediation: number;
  buildOnFocusCandidate?: Cand;
  lastBackchannelAt?: number;
  longSilenceBroadcastCount: number;
  lastLongSilenceAt?: number;
  activeGenerationId?: string;
  queuedAddress?: { seq: number; evidence: string };
}

const runtimes = new Map<string, RuntimeState>();

function isLeader(conditionCode: ConditionCode): boolean {
  return isLeaderCondition(conditionCode);
}

function emitTyping(runtime: RuntimeState, owner: string, active: boolean) {
  if (active) runtime.typingOwners.add(owner);
  else runtime.typingOwners.delete(owner);
  const visible = runtime.typingOwners.size > 0;
  if (visible === runtime.typingVisible) return;
  runtime.typingVisible = visible;
  runtime.io.to(runtime.sessionCode).emit("ai-typing", { isTyping: visible });
}

function replaceTypingOwners(runtime: RuntimeState, owner?: string) {
  runtime.typingOwners.clear();
  if (owner) runtime.typingOwners.add(owner);
  const visible = runtime.typingOwners.size > 0;
  if (visible === runtime.typingVisible) return;
  runtime.typingVisible = visible;
  runtime.io.to(runtime.sessionCode).emit("ai-typing", { isTyping: visible });
}

function clearTimer(timer?: NodeJS.Timeout) {
  if (timer) clearTimeout(timer);
}

function transcript(docs: any[]): TranscriptMessage[] {
  return docs.map((message) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: transcriptLabel(message.senderRole),
    content: message.content,
  }));
}

function humanCount(docs: any[]): number {
  return docs.filter((message) => message.senderRole !== "ai").length;
}

function messagesSinceLastAI(docs: any[]): number {
  let count = 0;
  for (let index = docs.length - 1; index >= 0; index -= 1) {
    if (docs[index].senderRole === "ai") break;
    count += 1;
  }
  return count;
}

function surfacedCoverage(revealStats: any): { total: number; candidates: number } {
  // Summary eligibility is human-grounded; Alex cannot arm a summary by disclosing notes itself.
  const ids = humanConfirmedIds(revealStats);
  const candidates = new Set([...ids].map((id) => TRAIT_BY_ID.get(id)?.candidate).filter(Boolean))
    .size;
  return { total: ids.size, candidates };
}

function silenceDecisionStage(reason: string): InterventionDecisionStage {
  if (reason === "cooldown") return "cooldown";
  if (reason === "judge_silent" || reason === "judge_failure") return "main_judge";
  if (reason === "backchannel_gap" || reason === "backchannel_rate") return "route_gate";
  if (reason.startsWith("closing_") || reason.includes("lifecycle")) return "lifecycle";
  return "system";
}

async function recordSilence(input: {
  runtime: RuntimeState;
  anchorSeq: number;
  decision?: MainJudgeDecision | null;
  evidence?: string | null;
  reason: string;
}) {
  await AIIntervention.create({
    sessionId: input.runtime.sessionId,
    turnIndex: input.anchorSeq,
    triggerReason: "push",
    decision: "stay_silent",
    source: "push",
    anchorSeq: input.anchorSeq,
    mainJudgeDecision: input.decision ?? undefined,
    judgeEvidence: input.evidence ?? undefined,
    decisionStage: silenceDecisionStage(input.reason),
    outcome: "stay_silent",
    silenceReason: input.reason,
    generationSucceeded: false,
    broadcastSucceeded: false,
  });
  log.info(
    `[intervention-v2] stay_silent stage=${silenceDecisionStage(input.reason)} ` +
      `anchor=${input.anchorSeq} decision=${input.decision ?? "none"} reason=${input.reason} ` +
      `evidence=${input.evidence ?? "none"} session=${input.runtime.sessionCode}`,
  );
}

async function cancelReservation(runtime: RuntimeState, reason: string) {
  const reservation = runtime.reservation;
  if (!reservation) return;
  clearTimer(reservation.timer);
  runtime.reservation = undefined;
  emitTyping(runtime, reservation.id, false);
  if (reservation.routeKind === "summary") {
    runtime.summaryStatus = "pending";
    await Session.updateOne(
      { _id: runtime.sessionId, "aiState.summaryStatus": { $ne: "done" } },
      { $set: { "aiState.summaryStatus": "pending" } },
    );
  }
  await AIIntervention.create({
    sessionId: runtime.sessionId,
    turnIndex: reservation.anchorSeq,
    triggerReason: reservation.source,
    decision: "stay_silent",
    routeKind: reservation.routeKind,
    source: reservation.source,
    reservationId: reservation.id,
    anchorSeq: reservation.anchorSeq,
    priorityRoute: reservation.priorityRoute ?? undefined,
    mainJudgeDecision: reservation.mainJudgeDecision ?? undefined,
    selectedTraitId: reservation.selectedTraitId ?? undefined,
    mediationTrigger: reservation.mediationTrigger,
    decisionStage: reservation.decisionStage,
    routeReason: reservation.routeReason,
    outcome: "cancelled",
    silenceReason: reason,
    floorMs: reservation.floorMs,
    generationSucceeded: false,
    broadcastSucceeded: false,
  });
}

async function updateMediationState(runtime: RuntimeState, docs: any[]) {
  if (!isLeader(runtime.conditionCode)) return;
  const count = humanCount(docs);
  const now = Date.now();
  const expired =
    runtime.mediationLatched &&
    ((runtime.mediationLatchedAt !== undefined &&
      now - runtime.mediationLatchedAt >= TRIGGER_CONFIG.MEDIATION_TTL_MS) ||
      (runtime.mediationLatchedHumanCount !== undefined &&
        count - runtime.mediationLatchedHumanCount >= TRIGGER_CONFIG.MEDIATION_TTL_HUMAN_MESSAGES));

  if (expired) {
    runtime.mediationLatched = false;
    runtime.mediationEvidence = [];
    runtime.mediationLatchedAt = undefined;
    runtime.mediationLatchedHumanCount = undefined;
    // Leader mediation cadence is independent of this short-lived evidence
    // latch. Keep the evidence for analysis without resetting the cadence.
  }

  if (!runtime.mediationLatched) {
    const recentHuman = docs
      .filter((message) => message.senderRole !== "ai")
      .slice(-6)
      .map((message) => message.content);
    const evidence = detectMediationEvidence(recentHuman);
    if (evidence.length) {
      runtime.mediationLatched = true;
      runtime.mediationEvidence = evidence;
      runtime.mediationLatchedAt = now;
      runtime.mediationLatchedHumanCount = count;
    }
  }

  await Session.updateOne(
    { _id: runtime.sessionId },
    {
      $set: {
        "aiState.mediationLatched": runtime.mediationLatched,
        "aiState.mediationEvidence": runtime.mediationEvidence,
        "aiState.mediationLatchedAt": runtime.mediationLatchedAt
          ? new Date(runtime.mediationLatchedAt)
          : null,
        "aiState.mediationLatchedHumanCount": runtime.mediationLatchedHumanCount ?? null,
        "aiState.buildOnsSinceMediation": runtime.buildOnsSinceMediation,
        "aiState.buildOnFocusCandidate": runtime.buildOnFocusCandidate ?? null,
      },
    },
  );
}

async function armSummaryIfEligible(runtime: RuntimeState, session: any, docs: any[]) {
  if (!isLeader(runtime.conditionCode) || runtime.summaryStatus !== "not_eligible") return;
  const elapsed = Date.now() - runtime.startedAt;
  const timeLeft = runtime.startedAt + TRIGGER_CONFIG.DISCUSSION_DURATION_MS - Date.now();
  const coverage = surfacedCoverage(session.revealStats);
  const eligible =
    elapsed >= TRIGGER_CONFIG.SUMMARY_MIN_ELAPSED_MS &&
    humanCount(docs) >= TRIGGER_CONFIG.SUMMARY_MIN_HUMAN_MESSAGES &&
    coverage.total >= TRIGGER_CONFIG.SUMMARY_MIN_SURFACED &&
    coverage.candidates >= TRIGGER_CONFIG.SUMMARY_MIN_CANDIDATES &&
    timeLeft > TRIGGER_CONFIG.SUMMARY_LATEST_BEFORE_END_MS;
  if (!eligible) return;

  runtime.summaryStatus = "pending";
  await Session.updateOne(
    {
      _id: runtime.sessionId,
      "aiState.summaryStatus": { $nin: ["pending", "generating", "done"] },
    },
    {
      $set: {
        "aiState.summaryStatus": "pending",
        "aiState.summaryEligibleAt": new Date(),
      },
    },
  );
  log.info(`[intervention-v2] summary armed (session=${runtime.sessionCode})`);
}

function scheduleLongSilence(runtime: RuntimeState) {
  clearTimer(runtime.longSilenceTimer);
  if (runtime.longSilenceBroadcastCount >= TRIGGER_CONFIG.LONG_SILENCE_MAX_BROADCASTS) {
    runtime.longSilenceTimer = undefined;
    return;
  }
  runtime.longSilenceTimer = setTimeout(() => {
    void handleLongSilence(runtime).catch((error) =>
      log.error(`[intervention-v2] long-silence error (${runtime.sessionCode}):`, error),
    );
  }, TRIGGER_CONFIG.LONG_SILENCE_SECONDS * 1_000);
}

async function reserveTurn(runtime: RuntimeState, input: Omit<Reservation, "id" | "timer">) {
  if (runtime.lifecycle !== "active" || runtime.reservation || runtime.busy) return;
  const id = randomUUID();
  emitTyping(runtime, id, true);
  const timer = setTimeout(() => {
    void runReservation(runtime, id).catch((error) =>
      log.error(`[intervention-v2] reservation error (${runtime.sessionCode}):`, error),
    );
  }, input.floorMs);
  runtime.reservation = { ...input, id, timer };
  log.info(
    `[intervention-v2] reserved stage=${input.decisionStage} route=${input.routeKind} ` +
      `source=${input.source} priority=${input.priorityRoute ?? "none"} ` +
      `judge=${input.mainJudgeDecision ?? "none"} reason=${input.routeReason ?? "none"} ` +
      `floor=${input.floorMs} anchor=${input.anchorSeq} session=${runtime.sessionCode}`,
  );
}

async function runReservation(runtime: RuntimeState, reservationId: string) {
  const reservation = runtime.reservation;
  if (!reservation || reservation.id !== reservationId) return;
  runtime.reservation = undefined;
  runtime.busy = true;
  runtime.activeGenerationId = reservation.id;
  if (reservation.routeKind === "summary") {
    runtime.summaryStatus = "generating";
    await Session.updateOne(
      { _id: runtime.sessionId, "aiState.summaryStatus": "pending" },
      { $set: { "aiState.summaryStatus": "generating" } },
    );
  }

  try {
    const result = await executeRouteTurn({
      io: runtime.io,
      sessionCode: runtime.sessionCode,
      sessionId: runtime.sessionId,
      conditionCode: runtime.conditionCode,
      routeKind: reservation.routeKind,
      source: reservation.source,
      reservationId: reservation.id,
      anchorSeq: reservation.anchorSeq,
      floorMs: reservation.floorMs,
      priorityRoute: reservation.priorityRoute,
      priorityEvidence: reservation.priorityEvidence,
      mainJudgeDecision: reservation.mainJudgeDecision,
      judgeEvidence: reservation.judgeEvidence,
      selectedTraitId: reservation.selectedTraitId,
      decisionStage: reservation.decisionStage,
      routeReason: reservation.routeReason,
      mediationTrigger: reservation.mediationTrigger,
      mediationFocusCandidate: reservation.focusCandidate,
      mediationLatched: runtime.mediationLatched,
      mediationEvidence: runtime.mediationEvidence,
      buildOnsSinceMediation: runtime.buildOnsSinceMediation,
      commitGuard: () =>
        runtime.activeGenerationId === reservation.id &&
        runtime.queuedAddress === undefined &&
        (reservation.routeKind !== "long_silence" ||
          runtime.latestPushSeq === reservation.anchorSeq),
    });

    if (!result.ok) {
      if (reservation.routeKind === "summary") {
        runtime.summaryStatus = "pending";
        await Session.updateOne(
          { _id: runtime.sessionId, "aiState.summaryStatus": "generating" },
          { $set: { "aiState.summaryStatus": "pending" } },
        );
      }
      return;
    }

    clearTimer(runtime.longSilenceTimer);
    runtime.longSilenceTimer = undefined;
    if (reservation.routeKind === "backchannel") {
      runtime.lastBackchannelAt = Date.now();
      await Session.updateOne(
        { _id: runtime.sessionId },
        { $set: { "aiState.lastBackchannelAt": new Date(runtime.lastBackchannelAt) } },
      );
    }
    if (reservation.routeKind === "long_silence") {
      runtime.longSilenceBroadcastCount += 1;
      runtime.lastLongSilenceAt = Date.now();
      await Session.updateOne(
        { _id: runtime.sessionId },
        {
          $set: {
            "aiState.longSilenceBroadcastCount": runtime.longSilenceBroadcastCount,
            "aiState.lastLongSilenceAt": new Date(runtime.lastLongSilenceAt),
          },
        },
      );
    }
    if (reservation.routeKind === "build_on") {
      if (isLeader(runtime.conditionCode)) {
        runtime.buildOnsSinceMediation = mediationBuildOnCountAfterSuccessfulRoute(
          runtime.buildOnsSinceMediation,
          reservation.routeKind,
        );
        if (reservation.focusCandidate) {
          // Retained only as audit metadata. Candidate changes no longer reset
          // or gate the global two-build-on mediation cadence.
          runtime.buildOnFocusCandidate = reservation.focusCandidate;
        }
        await Session.updateOne(
          { _id: runtime.sessionId },
          {
            $set: {
              "aiState.buildOnsSinceMediation": runtime.buildOnsSinceMediation,
              "aiState.buildOnFocusCandidate": runtime.buildOnFocusCandidate,
            },
          },
        );
      }
    }
    if (reservation.routeKind === "mediation") {
      runtime.mediationLatched = false;
      runtime.mediationEvidence = [];
      runtime.mediationLatchedAt = undefined;
      runtime.mediationLatchedHumanCount = undefined;
      runtime.buildOnsSinceMediation = mediationBuildOnCountAfterSuccessfulRoute(
        runtime.buildOnsSinceMediation,
        reservation.routeKind,
      );
      runtime.buildOnFocusCandidate = undefined;
      await Session.updateOne(
        { _id: runtime.sessionId },
        {
          $set: {
            "aiState.mediationLatched": false,
            "aiState.mediationEvidence": [],
            "aiState.buildOnsSinceMediation": 0,
          },
          $unset: {
            "aiState.mediationLatchedAt": 1,
            "aiState.mediationLatchedHumanCount": 1,
            "aiState.buildOnFocusCandidate": 1,
          },
        },
      );
    }
    if (reservation.routeKind === "summary") {
      runtime.summaryStatus = "done";
      await Session.updateOne(
        { _id: runtime.sessionId },
        {
          $set: {
            "aiState.summaryStatus": "done",
            "aiState.summaryMessageId": result.messageId,
          },
        },
      );
    }
  } finally {
    runtime.busy = false;
    runtime.activeGenerationId = undefined;
    emitTyping(runtime, reservation.id, false);
    const queued = runtime.queuedAddress;
    runtime.queuedAddress = undefined;
    if (queued && runtime.lifecycle === "active") {
      await reserveTurn(runtime, {
        anchorSeq: queued.seq,
        routeKind: "address",
        priorityRoute: "address",
        priorityEvidence: queued.evidence,
        mainJudgeDecision: null,
        decisionStage: "priority",
        routeReason: "priority",
        floorMs: TRIGGER_CONFIG.ADDRESS_FLOOR_MS,
        source: "push",
      });
    }
  }
}

async function handleLongSilence(runtime: RuntimeState) {
  runtime.longSilenceTimer = undefined;
  const session = await Session.findById(runtime.sessionId).select("aiState.lifecycle").lean();
  if ((session as any)?.aiState?.lifecycle !== "active") return;
  if (runtime.reservation || runtime.busy) {
    runtime.longSilenceTimer = setTimeout(
      () =>
        void handleLongSilence(runtime).catch((error) =>
          log.error(`[intervention-v2] long-silence error (${runtime.sessionCode}):`, error),
        ),
      1_000,
    );
    return;
  }
  const docs = await Message.find({ sessionId: runtime.sessionId }).sort({ seq: 1 }).lean();
  const last = docs.at(-1);
  if (!last || last.senderRole === "ai") return;
  const quietForMs = Date.now() - new Date((last as any).createdAt).getTime();
  const requiredQuietMs = TRIGGER_CONFIG.LONG_SILENCE_SECONDS * 1_000;
  if (quietForMs < requiredQuietMs) {
    runtime.longSilenceTimer = setTimeout(
      () =>
        void handleLongSilence(runtime).catch((error) =>
          log.error(`[intervention-v2] long-silence error (${runtime.sessionCode}):`, error),
        ),
      requiredQuietMs - quietForMs,
    );
    return;
  }
  if (runtime.reservation || runtime.busy) return;
  const gate = evaluateLongSilenceGate({
    broadcastCount: runtime.longSilenceBroadcastCount,
    maxBroadcasts: TRIGGER_CONFIG.LONG_SILENCE_MAX_BROADCASTS,
    messagesSinceAI: messagesSinceLastAI(docs),
    minimumHumanMessagesSinceAI: TRIGGER_CONFIG.LONG_SILENCE_MIN_HUMAN_MSGS_SINCE_AI,
    lastBroadcastAt: runtime.lastLongSilenceAt,
    minimumIntervalMs: TRIGGER_CONFIG.LONG_SILENCE_MIN_INTERVAL_MS,
    now: Date.now(),
    latestPushSeq: runtime.latestPushSeq,
    anchorSeq: last.seq,
  });
  if (!gate.eligible) {
    log.info(
      `[intervention-v2] long_silence_skip reason=${gate.reason} anchor=${last.seq} ` +
        `count=${runtime.longSilenceBroadcastCount} session=${runtime.sessionCode}`,
    );
    if (gate.reason === "minimum_interval" && gate.retryAfterMs !== undefined) {
      runtime.longSilenceTimer = setTimeout(
        () =>
          void handleLongSilence(runtime).catch((error) =>
            log.error(`[intervention-v2] long-silence error (${runtime.sessionCode}):`, error),
          ),
        gate.retryAfterMs,
      );
    }
    return;
  }
  await reserveTurn(runtime, {
    anchorSeq: last.seq,
    routeKind: "long_silence",
    priorityRoute: "long_silence",
    priorityEvidence: `${TRIGGER_CONFIG.LONG_SILENCE_SECONDS}_second_quiet_period`,
    mainJudgeDecision: null,
    decisionStage: "long_silence_timer",
    routeReason: "long_silence",
    floorMs: 0,
    source: "long_silence",
  });
}

async function broadcastClosingFallback(runtime: RuntimeState, reason: "deadline" | "manual") {
  const [session, docs] = await Promise.all([
    Session.findById(runtime.sessionId).select("language revealStats").lean(),
    Message.find({ sessionId: runtime.sessionId }).sort({ seq: 1 }).lean(),
  ]);
  if (!session) return;
  const coverage = formatVisibleBoardCoverage((session as any).revealStats);
  const preference = decidePreferenceFromVisibleCoverage((session as any).revealStats);
  const leaderNamesEn = preference.leaders.map((candidate) => `Candidate ${candidate}`);
  const leaderListEn =
    leaderNamesEn.length <= 1
      ? (leaderNamesEn[0] ?? "")
      : `${leaderNamesEn.slice(0, -1).join(", ")} and ${leaderNamesEn.at(-1)}`;
  const leaderListKo = preference.leaders.map((candidate) => `Candidate ${candidate}`).join("·");
  const preferenceEn = preference.candidate
    ? preference.scope === "partial"
      ? `Among the sufficiently covered candidates so far, my current preference is Candidate ${preference.candidate}; its visible profile currently looks strongest on matches relative to misses.`
      : `My current preference is Candidate ${preference.candidate}; its overall shared profile currently looks strongest on matches relative to misses.`
    : preference.leaders.length > 1
      ? `${leaderListEn} currently look even at the top ${preference.scope === "partial" ? "among the sufficiently covered candidates so far" : "in the overall shared match-and-miss picture"}, and I would like us to discuss them a little more before separating them.`
      : "I do not have a current preference yet because not enough has been shared for a grounded comparison.";
  const preferenceKo = preference.candidate
    ? preference.scope === "partial"
      ? `현재 충분히 다뤄진 후보들 중 제 선호는 Candidate ${preference.candidate}입니다. 공개된 프로필에서 MISS 대비 MATCH가 가장 좋아 보입니다.`
      : `현재 제 선호는 Candidate ${preference.candidate}입니다. 공유된 전체 프로필에서 MISS 대비 MATCH가 가장 좋아 보입니다.`
    : preference.leaders.length > 1
      ? `${leaderListKo}가 ${preference.scope === "partial" ? "현재 충분히 다뤄진 후보들 중" : "공유된 전체 MATCH/MISS 구도에서"} 공동으로 가장 좋아 보입니다. 우열을 가리기 전에 이 후보들을 좀 더 이야기해 보고 싶습니다.`
      : "근거 있게 비교하기에는 아직 공유된 정보가 충분하지 않아 현재 선호 후보는 없습니다.";
  const handoffEn =
    runtime.conditionCode === "C4"
      ? "Which candidate best fits the full picture for your final decision?"
      : "The final decision is yours.";
  const handoffKo =
    runtime.conditionCode === "C4"
      ? "전체 그림을 놓고 볼 때 최종 결정에 가장 적합한 후보는 누구인가요?"
      : "최종 결정은 여러분이 내려주세요.";
  const content =
    (session as any).language === "ko"
      ? `토론 시간이 끝났습니다. 지금까지 확인된 내용입니다.\n\n${coverage}\n\n${preferenceKo} ${handoffKo}`
      : `Discussion time is up. Here is the confirmed board so far.\n\n${coverage}\n\n${preferenceEn} ${handoffEn}`;
  const prompt = getRoutePrompt(runtime.conditionCode, "closing");
  const seq = await allocSeq(runtime.sessionId);
  const message = await Message.create({
    sessionId: runtime.sessionId,
    sender: "ai",
    senderRole: "ai",
    content,
    seq,
    sharedInfoIds: [],
  });
  await AIIntervention.create({
    sessionId: runtime.sessionId,
    turnIndex: docs.at(-1)?.seq ?? 0,
    triggerReason: `closing_${reason}_fallback`,
    cue: "closing",
    decision: "speak",
    generateMessageId: message._id,
    response: content,
    routeKind: "closing",
    source: `closing_${reason}_fallback`,
    anchorSeq: docs.at(-1)?.seq ?? 0,
    decisionStage: "lifecycle",
    routeReason: "closing",
    outcome: "broadcast",
    promptKey: prompt.promptKey,
    promptVersion: prompt.promptVersion,
    promptHash: prompt.promptHash,
    generationSucceeded: false,
    interventionSaved: true,
    broadcastSucceeded: true,
    error: "model_closing_failed_static_fallback_used",
  });
  runtime.io.to(runtime.sessionCode).emit("new-message", {
    seq: message.seq,
    sender: message.sender,
    senderRole: message.senderRole,
    content: message.content,
    createdAt: (message as any).createdAt.toISOString(),
  });
  // [LOW-5] fallback closing도 Message 저장을 기록 — 재시작 시 이중 closing 방지.
  await Session.updateOne(
    { _id: runtime.sessionId },
    { $set: { "aiState.closingMessageId": message._id } },
  );
}

// [Step 49] Peer 조건은 closing 프롬프트 레지스트리가 없으므로 하드코딩 상수를 그대로 브로드캐스트.
// 리더의 broadcastClosingFallback과 동일한 저장·로깅·이중 방지 경로를 쓴다 (LLM 호출 없음).
// 발화 전 짧은 타이핑 인디케이터로 자연스러운 발화감을 준다.
const PEER_CLOSING_TYPING_MS = 1200;
async function broadcastPeerClosing(runtime: RuntimeState, reason: "deadline" | "manual") {
  const owner = `closing:${reason}`;
  replaceTypingOwners(runtime, owner);
  try {
    const [session, docs] = await Promise.all([
      Session.findById(runtime.sessionId).select("language").lean(),
      Message.find({ sessionId: runtime.sessionId }).sort({ seq: 1 }).lean(),
    ]);
    if (!session) return;
    const content = (session as any).language === "ko" ? KO_PEER_CLOSING : PEER_CLOSING;
    await new Promise((resolve) => setTimeout(resolve, PEER_CLOSING_TYPING_MS));
    const seq = await allocSeq(runtime.sessionId);
    const message = await Message.create({
      sessionId: runtime.sessionId,
      sender: "ai",
      senderRole: "ai",
      content,
      seq,
      sharedInfoIds: [],
    });
    await AIIntervention.create({
      sessionId: runtime.sessionId,
      turnIndex: docs.at(-1)?.seq ?? 0,
      triggerReason: `closing_${reason}_peer_static`,
      cue: "closing",
      decision: "speak",
      generateMessageId: message._id,
      response: content,
      routeKind: "closing",
      source: `closing_${reason}_peer_static`,
      anchorSeq: docs.at(-1)?.seq ?? 0,
      decisionStage: "lifecycle",
      routeReason: "closing",
      outcome: "broadcast",
      generationSucceeded: false,
      interventionSaved: true,
      broadcastSucceeded: true,
    });
    runtime.io.to(runtime.sessionCode).emit("new-message", {
      seq: message.seq,
      sender: message.sender,
      senderRole: message.senderRole,
      content: message.content,
      createdAt: (message as any).createdAt.toISOString(),
    });
    // [LOW-5] 재시작 시 이중 closing 방지 — closing Message 저장 기록.
    await Session.updateOne(
      { _id: runtime.sessionId },
      { $set: { "aiState.closingMessageId": message._id } },
    );
  } finally {
    emitTyping(runtime, owner, false);
  }
}

async function triggerClosing(runtime: RuntimeState, reason: "deadline" | "manual") {
  const claimed = await Session.findOneAndUpdate(
    { _id: runtime.sessionId, "aiState.lifecycle": "active" },
    {
      $set: {
        "aiState.lifecycle": "closing",
        "aiState.closingReason": reason,
        "aiState.closingAt": new Date(),
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) return;
  runtime.lifecycle = "closing";
  runtime.activeGenerationId = undefined;
  runtime.queuedAddress = undefined;

  clearTimer(runtime.longSilenceTimer);
  clearTimer(runtime.closingTimer);

  // Peer conditions intentionally have no closing route in the 30-prompt registry.
  if (isLeader(runtime.conditionCode)) {
    const owner = `closing:${reason}`;
    // Closing owns the indicator even if an older model call is still unwinding.
    replaceTypingOwners(runtime, owner);
    await cancelReservation(runtime, `closing_${reason}`);
    try {
      const last = await Message.findOne({ sessionId: runtime.sessionId }).sort({ seq: -1 }).lean();
      const result = await executeRouteTurn({
        io: runtime.io,
        sessionCode: runtime.sessionCode,
        sessionId: runtime.sessionId,
        conditionCode: runtime.conditionCode,
        routeKind: "closing",
        source: `closing_${reason}`,
        anchorSeq: last?.seq ?? 0,
        floorMs: 0,
        decisionStage: "lifecycle",
        routeReason: "closing",
      });
      if (result.ok && result.messageId) {
        // [LOW-5] closing Message가 저장되면 즉시 기록 — AIIntervention 로그가 실패해도
        // 재시작 시 이중 closing으로 이어지지 않도록 하는 독립 경로.
        await Session.updateOne(
          { _id: runtime.sessionId },
          { $set: { "aiState.closingMessageId": result.messageId } },
        );
      } else if (!result.ok) {
        await broadcastClosingFallback(runtime, reason);
      }
    } finally {
      emitTyping(runtime, owner, false);
    }
  } else {
    await cancelReservation(runtime, `closing_${reason}`);
    replaceTypingOwners(runtime);
    // [Step 49] Peer 조건은 하드코딩 멘트만 브로드캐스트 — 시간 초과·어드민 수동 동일 경로.
    await broadcastPeerClosing(runtime, reason);
  }

  await Session.updateOne({ _id: runtime.sessionId }, { $set: { "aiState.lifecycle": "muted" } });
  runtime.lifecycle = "muted";
  log.info(`[intervention-v2] AI closed and muted reason=${reason} session=${runtime.sessionCode}`);
}

function scheduleClosing(runtime: RuntimeState) {
  clearTimer(runtime.closingTimer);
  const delay = Math.max(0, runtime.startedAt + TRIGGER_CONFIG.DISCUSSION_DURATION_MS - Date.now());
  runtime.closingTimer = setTimeout(() => {
    void triggerClosing(runtime, "deadline").catch((error) =>
      log.error(`[intervention-v2] closing error (${runtime.sessionCode}):`, error),
    );
  }, delay);
}

async function initializeRuntime(runtime: RuntimeState) {
  const session = await Session.findById(runtime.sessionId).select("aiState").lean();
  const state = (session as any)?.aiState ?? {};
  runtime.summaryStatus = state.summaryStatus ?? "not_eligible";
  runtime.mediationLatched = state.mediationLatched ?? false;
  runtime.mediationEvidence = state.mediationEvidence ?? [];
  runtime.mediationLatchedAt = state.mediationLatchedAt?.getTime?.();
  runtime.mediationLatchedHumanCount = state.mediationLatchedHumanCount ?? undefined;
  runtime.buildOnsSinceMediation = state.buildOnsSinceMediation ?? 0;
  runtime.buildOnFocusCandidate = state.buildOnFocusCandidate ?? undefined;
  runtime.lastBackchannelAt = state.lastBackchannelAt?.getTime?.();
  runtime.longSilenceBroadcastCount = state.longSilenceBroadcastCount ?? 0;
  runtime.lastLongSilenceAt = state.lastLongSilenceAt?.getTime?.();

  if (state.lifecycle === "muted") return;
  if (state.lifecycle === "closing") {
    const alreadyClosed = await AIIntervention.exists({
      sessionId: runtime.sessionId,
      routeKind: "closing",
      decision: "speak",
    });
    // [LOW-5] closing Message가 실제 저장됐으면 AIIntervention 로그 실패와 무관하게 완료로 간주.
    // 이중 closing 발화 방지.
    const closingMessageRecorded = Boolean(state.closingMessageId);
    if (alreadyClosed || closingMessageRecorded) {
      await Session.updateOne(
        { _id: runtime.sessionId },
        { $set: { "aiState.lifecycle": "muted" } },
      );
      runtime.lifecycle = "muted";
      return;
    }
  }
  await Session.updateOne(
    { _id: runtime.sessionId, "aiState.lifecycle": { $ne: "muted" } },
    {
      $set: {
        "aiState.lifecycle": "active",
        "aiState.summaryStatus": runtime.summaryStatus,
        "aiState.mediationLatched": runtime.mediationLatched,
        "aiState.mediationEvidence": runtime.mediationEvidence,
        "aiState.buildOnsSinceMediation": runtime.buildOnsSinceMediation,
        "aiState.buildOnFocusCandidate": runtime.buildOnFocusCandidate ?? null,
      },
    },
  );
  runtime.lifecycle = "active";
  scheduleClosing(runtime);

  const exists = await Message.exists({ sessionId: runtime.sessionId });
  if (!exists) {
    const owner = "greeting";
    emitTyping(runtime, owner, true);
    try {
      await executeRouteTurn({
        io: runtime.io,
        sessionCode: runtime.sessionCode,
        sessionId: runtime.sessionId,
        conditionCode: runtime.conditionCode,
        routeKind: "greeting",
        source: "session_start",
        anchorSeq: 0,
        floorMs: 0,
        decisionStage: "lifecycle",
        routeReason: "greeting",
      });
    } finally {
      emitTyping(runtime, owner, false);
    }
  }
}

export async function startInterventionSession(input: {
  io: IO;
  sessionCode: string;
  sessionId: string;
  conditionCode: ConditionCode;
  startedAt: Date;
}) {
  if (input.conditionCode === "CTRL") return;
  let runtime = runtimes.get(input.sessionCode);
  if (!runtime) {
    runtime = {
      io: input.io,
      sessionCode: input.sessionCode,
      sessionId: input.sessionId,
      conditionCode: input.conditionCode,
      startedAt: input.startedAt.getTime(),
      lifecycle: "active",
      latestPushSeq: 0,
      busy: false,
      typingOwners: new Set(),
      typingVisible: false,
      summaryStatus: "not_eligible",
      mediationLatched: false,
      mediationEvidence: [],
      buildOnsSinceMediation: 0,
      buildOnFocusCandidate: undefined,
      longSilenceBroadcastCount: 0,
    };
    runtimes.set(input.sessionCode, runtime);
    runtime.initialized = initializeRuntime(runtime);
  } else {
    runtime.io = input.io;
    runtime.startedAt = input.startedAt.getTime();
  }
  await runtime.initialized;
}

export async function onHumanMessage(input: {
  sessionCode: string;
  messageSeq: number;
  content: string;
}) {
  const runtime = runtimes.get(input.sessionCode);
  if (!runtime) return;
  await runtime.initialized;
  runtime.latestPushSeq = Math.max(runtime.latestPushSeq, input.messageSeq);
  if (runtime.lifecycle !== "active") return;
  scheduleLongSilence(runtime);

  // Direct address is deterministic and should not wait behind tally or judge I/O.
  const immediateAddress = detectDirectAddress(input.content);
  if (immediateAddress.addressed) {
    if (runtime.busy) {
      runtime.queuedAddress = { seq: input.messageSeq, evidence: immediateAddress.evidence };
      return;
    }
    if (runtime.reservation) {
      void cancelReservation(runtime, "superseded_by_new_priority").catch((error) =>
        log.error(`[intervention-v2] cancellation log failed (${runtime.sessionCode}):`, error),
      );
    }
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "address",
      priorityRoute: "address",
      priorityEvidence: immediateAddress.evidence,
      mainJudgeDecision: null,
      decisionStage: "priority",
      routeReason: "priority",
      floorMs: TRIGGER_CONFIG.ADDRESS_FLOOR_MS,
      source: "push",
    });
    return;
  }
  if (runtime.reservation || runtime.busy) return;

  const [session, docs] = await Promise.all([
    Session.findById(runtime.sessionId).select("aiState.lifecycle revealStats").lean(),
    Message.find({ sessionId: runtime.sessionId }).sort({ seq: 1 }).lean(),
  ]);
  if ((session as any)?.aiState?.lifecycle !== "active") return;
  if (runtime.latestPushSeq !== input.messageSeq) return;

  await updateMediationState(runtime, docs);
  await armSummaryIfEligible(runtime, session, docs);
  if (runtime.latestPushSeq !== input.messageSeq) return;

  let priorityRoute: PriorityRoute = null;
  let priorityEvidence: string | undefined;
  const sinceAI = messagesSinceLastAI(docs);
  const followupWindow = buildFollowupCandidateTranscript(transcript(docs));
  if (!priorityRoute && followupWindow) {
    const followupJudge = await judgeFollowupToAlex(followupWindow);
    log.info(
      `[intervention-v2] followup_judge anchor=${input.messageSeq} ` +
        `outcome=${followupJudge.outcome} model=${followupJudge.model} ` +
        `session=${runtime.sessionCode}` +
        (followupJudge.error ? ` error=${followupJudge.error}` : ""),
    );
    if (followupJudge.answer) {
      priorityRoute = "followup";
      priorityEvidence = "single_human_speaker_since_alex";
    }
  }

  if (runtime.latestPushSeq !== input.messageSeq) return;

  if (runtime.reservation) {
    if (!priorityRoute) return;
    void cancelReservation(runtime, "superseded_by_new_priority").catch((error) =>
      log.error(`[intervention-v2] cancellation log failed (${runtime.sessionCode}):`, error),
    );
  } else if (runtime.busy) {
    return;
  }

  if (priorityRoute) {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: priorityRoute,
      priorityRoute,
      priorityEvidence,
      mainJudgeDecision: null,
      decisionStage: "priority",
      routeReason: "priority",
      floorMs: TRIGGER_CONFIG.FOLLOWUP_FLOOR_MS,
      source: "push",
    });
    return;
  }

  // A successful pair of leader build-ons creates a global mediation debt.
  // Serve it on the next ordinary human turn, regardless of candidate changes
  // or the Main Judge's willingness to contribute. Direct responses remain the
  // only higher-priority conversational obligation, and they defer rather than
  // clear this debt.
  const pendingMediation = resolveRoute({
    conditionCode: runtime.conditionCode,
    priorityRoute: null,
    decision: null,
    mediation: {
      latched: runtime.mediationLatched,
      buildOnsSinceMediation: runtime.buildOnsSinceMediation,
    },
    backchannelGapPassed: true,
    sessionId: runtime.sessionId,
    turnSeq: input.messageSeq,
    backchannelRate: TRIGGER_CONFIG.BACKCHANNEL_RATE,
  });
  if (pendingMediation.routeKind === "mediation") {
    const currentFocus = currentTopicCandidate(
      transcript(docs).map((message) => ({ sender: message.speaker, content: message.content })),
    );
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "mediation",
      priorityRoute: null,
      mainJudgeDecision: null,
      focusCandidate: currentFocus,
      mediationTrigger: pendingMediation.mediationTrigger,
      decisionStage: "route_gate",
      routeReason: "mediation",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "push",
    });
    return;
  }

  if (runtime.summaryStatus === "pending") {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "summary",
      priorityRoute: null,
      mainJudgeDecision: null,
      decisionStage: "summary",
      routeReason: "summary",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "summary",
    });
    return;
  }

  if (sinceAI < TRIGGER_CONFIG.COOLDOWN_MIN_MSGS) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: "cooldown",
    });
    return;
  }

  const allTranscript = transcript(docs);
  const judgeSignal = await deriveMainJudgeSignal({
    messages: allTranscript,
    revealStats: (session as any).revealStats,
    anchorSeq: input.messageSeq,
  });
  // [Step 55] signal LLM 대기 중 새 메시지가 오면 본 judge 호출을 스킵 (기존 stale 가드 패턴)
  if (runtime.latestPushSeq !== input.messageSeq) return;
  // Keep comparison focus out of one-point build-on guards while retaining the
  // current topic for ordinary same-candidate discussion. Mediation cadence is
  // global and is intentionally independent of this focus.
  const cadenceFocusState = deriveFocusDepthState({
    routeKind: "build_on",
    messages: allTranscript,
    revealStats: (session as any).revealStats,
  });
  const cadenceFocusCandidate =
    cadenceFocusState.basis === "comparison" ? null : judgeSignal.focusCandidate;
  const decision = await judgeIntervention(
    allTranscript.slice(-JUDGE_WINDOW_SIZE).map(({ speaker, content }) => ({ speaker, content })),
    sinceAI,
    judgeSignal,
  );
  if (decision) {
    log.info(
      `[intervention-v2] main_judge anchor=${input.messageSeq} decision=${decision.decision} ` +
        `evidence=${decision.evidence} selectedTrait=${decision.selectedTraitId ?? "none"} ` +
        `msgsSinceAI=${sinceAI} signal="${formatMainJudgeSignal(judgeSignal)}" ` +
        `session=${runtime.sessionCode}`,
    );
  }
  if (runtime.latestPushSeq !== input.messageSeq || runtime.reservation) return;
  if (!decision) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: "judge_failure",
    });
    return;
  }

  const resolved = resolveRoute({
    conditionCode: runtime.conditionCode,
    priorityRoute: null,
    decision: decision.decision,
    mediation: {
      latched: runtime.mediationLatched,
      buildOnsSinceMediation: runtime.buildOnsSinceMediation,
    },
    backchannelGapPassed:
      runtime.lastBackchannelAt === undefined ||
      Date.now() - runtime.lastBackchannelAt >= TRIGGER_CONFIG.BACKCHANNEL_GAP_MS,
    sessionId: runtime.sessionId,
    turnSeq: input.messageSeq,
    backchannelRate: TRIGGER_CONFIG.BACKCHANNEL_RATE,
  });
  if (!resolved.routeKind) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: decision.decision,
      evidence: decision.evidence,
      reason: resolved.reason,
    });
    return;
  }

  await reserveTurn(runtime, {
    anchorSeq: input.messageSeq,
    routeKind: resolved.routeKind as Exclude<RouteKind, "greeting" | "closing">,
    priorityRoute: null,
    mainJudgeDecision: decision.decision,
    judgeEvidence: decision.evidence,
    selectedTraitId: decision.selectedTraitId,
    focusCandidate: cadenceFocusCandidate,
    mediationTrigger: resolved.mediationTrigger,
    decisionStage: "main_judge",
    routeReason: resolved.reason,
    floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
    source: "push",
  });
}

export function pauseInterventionSession(sessionCode: string) {
  const runtime = runtimes.get(sessionCode);
  if (!runtime) return;
  clearTimer(runtime.longSilenceTimer);
  runtime.longSilenceTimer = undefined;
  log.info(`[intervention-v2] long-silence timer paused (empty room, session=${sessionCode})`);
}

export async function stopInterventionSession(sessionCode: string) {
  const runtime = runtimes.get(sessionCode);
  if (runtime) {
    runtime.lifecycle = "muted";
    runtime.activeGenerationId = undefined;
    runtime.queuedAddress = undefined;
    clearTimer(runtime.longSilenceTimer);
    clearTimer(runtime.closingTimer);
    await cancelReservation(runtime, "session_completed");
    runtime.typingOwners.clear();
    if (runtime.typingVisible) {
      runtime.typingVisible = false;
      runtime.io.to(sessionCode).emit("ai-typing", { isTyping: false });
    }
    runtimes.delete(sessionCode);
  }
  await Session.updateOne({ sessionCode }, { $set: { "aiState.lifecycle": "muted" } });
}

export async function closeInterventionSession(sessionCode: string) {
  const runtime = runtimes.get(sessionCode);
  if (runtime) {
    await runtime.initialized;
    await triggerClosing(runtime, "manual");
    return;
  }
  // No connected runtime means there is nowhere to broadcast; persist the mute safely.
  await Session.updateOne(
    { sessionCode, "aiState.lifecycle": { $ne: "muted" } },
    {
      $set: {
        "aiState.lifecycle": "muted",
        "aiState.closingReason": "manual_no_runtime",
        "aiState.closingAt": new Date(),
      },
    },
  );
}
