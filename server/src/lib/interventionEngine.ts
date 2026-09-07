import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import type {
  ConditionCode,
  CommunicativeAct,
  InterventionDecisionStage,
  MainJudgeDecision,
  ParticipantRole,
  PriorityRoute,
  RouteKind,
} from "../types.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { ConversationObservation } from "../models/ConversationObservation.js";
import { Message } from "../models/Message.js";
import { Session } from "../models/Session.js";
import { config } from "../config.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";
import { buildFollowupCandidateTranscript, isFollowupToAlex } from "./followupJudge.js";
import {
  CONVERSATION_OBSERVER_VERSION,
  describeConversationSituation,
  reobserveConversationTurn,
  waitForConversationObservation,
  type ConversationObserverSnapshot,
  type PendingAlexObligationSnapshot,
} from "./conversationObserver.js";
import {
  CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION,
  CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION,
  CONVERSATION_LEDGER_JUDGE_VERSION,
  judgeCapitulatedToSilence,
  judgeCapitulationRuleCodes,
  judgeConversationLedgerTurn,
  judgeConversationTurn,
  judgeIntervention,
  JUDGE_WINDOW_SIZE,
  legacyDecisionForAct,
  type ConversationLedgerJudgeCallAttempt,
  type ConversationLedgerJudgeDecision,
} from "./interventionJudge.js";
import {
  CONVERSATION_LEDGER_VERSION,
  describeConversationLedger,
  humanFloorHeld,
  opportunityMayBypassCooldown,
  withOpportunityTransition,
  type ConversationLedgerState,
  type ResponseOpportunity,
} from "./conversationLedger.js";
import {
  detectDirectAddress,
  detectExplicitAlexDefer,
  detectMediationEvidence,
  evaluateLongSilenceGate,
  humanArrivalAction,
  mediationBuildOnCountAfterSuccessfulRoute,
  postGenerationEvaluationReady,
  resolveRoute,
} from "./interventionRoutingV2.js";
import {
  classifyRequestIntent,
  decidePreferenceFromKnownCoverage,
  deriveFocusDepthState,
  deriveMainJudgeSignal,
  formatVisibleBoardCoverage,
  isLeaderCondition,
  taskGroundingSignal,
  type RequestIntent,
  type SelectedOpportunityGenerationContext,
  type TranscriptMessage,
} from "./routeContext.js";
import { executeRouteTurn } from "./routeTurn.js";
import { transcriptLabel } from "./labels.js";
import { log } from "./log.js";
import { finishTurnTrace, traceTurnEvent } from "./turnTrace.js";
import { allocSeq } from "./seq.js";
import { getRoutePrompt } from "./routePromptRegistry.js";
import { PEER_CLOSING } from "./prompts.js";
import { KO_PEER_CLOSING } from "./koPilot.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";
import { allSurfacedIds, humanConfirmedIds } from "./informationPools.js";
import { currentTopicCandidate } from "./poolingTally.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
type SummaryStatus = "not_eligible" | "pending" | "generating" | "done";

interface Reservation {
  id: string;
  anchorSeq: number;
  // The obligation may be rooted in an earlier message. Keep the trace tied
  // to the human message that actually triggered this routing pass.
  traceSeq: number;
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
  conversationEpoch: number;
  postGenerationReevaluation?: boolean;
  interactionObligationEpoch?: number;
  requestIntentOverride?: RequestIntent;
  communicativeAct?: CommunicativeAct;
  conversationSituation?: string;
  judgeEvidenceSeqs?: number[];
  controllerMode?: "legacy" | "ledger_shadow" | "ledger_active";
  ledgerState?: ConversationLedgerState;
  ledgerJudgeAttempts?: ConversationLedgerJudgeCallAttempt[];
  selectedOpportunity?: SelectedOpportunityGenerationContext;
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
  conversationEpoch: number;
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
  pendingPostGenerationSeq?: number;
  pendingPostGenerationEpoch?: number;
  postGenerationReadySeq?: number;
  postGenerationClaimedSeq?: number;
  interactionServedThroughEpoch: number;
  ledgerBroadcasts: Map<string, number>;
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

function requestIntentForObserverObligation(
  obligation: PendingAlexObligationSnapshot,
  rootContent: string,
): RequestIntent | undefined {
  const classified = classifyRequestIntent(rootContent);
  if (obligation.kind === "answer_request") {
    return classified.kind === "none" ? undefined : classified;
  }

  const candidates = obligation.candidates.length
    ? obligation.candidates
    : classified.candidates;
  if (obligation.kind === "compare_request") {
    return {
      kind: "compare_request",
      candidate: candidates?.length === 1 ? candidates[0]! : null,
      candidates,
      // The visible board is the conservative fallback. Only explicit source
      // wording in the root request can open Alex's complete known profile.
      source: classified.kind === "compare_request" ? classified.source : "visible_board",
    };
  }
  return {
    kind: "narrow_decision_request",
    candidate: null,
    candidates,
    source: "known_profile",
  };
}

export function ledgerRouteKindForAct(
  act: CommunicativeAct,
  conditionCode?: ConditionCode,
): "address" | "followup" | "build_on" | "backchannel" | "mediation" {
  if (act === "follow") return "followup";
  if (act === "answer" || act === "participate") return "address";
  if (act === "acknowledge") return "backchannel";
  // The Judge is intentionally condition-neutral. Re-establish the
  // manipulation boundary at the final routing seam so a Peer can never
  // emit leader-only mediation, regardless of which Judge path selected it.
  if (act === "mediate") {
    return conditionCode === undefined || isLeaderCondition(conditionCode)
      ? "mediation"
      : "build_on";
  }
  return "build_on";
}

export function ledgerSpeechBlockedByHumanFloor(state: ConversationLedgerState): boolean {
  return humanFloorHeld(state);
}

function reconcileRuntimeBroadcasts(
  state: ConversationLedgerState,
  broadcasts: ReadonlyMap<string, number>,
): ConversationLedgerState {
  let next = state;
  for (const [opportunityId, alexBroadcastSeq] of broadcasts) {
    const opportunity = next.opportunities.find((candidate) => candidate.id === opportunityId);
    if (!opportunity || opportunity.status === "consumed_by_alex") continue;
    const reduced = withOpportunityTransition(next, {
      opportunityId,
      toStatus: "consumed_by_alex",
      reason: "runtime_broadcast_reconciliation",
      handledThroughSeq: next.contextThroughSeq,
      alexBroadcastSeq,
      broadcastSucceeded: true,
    });
    if (reduced.transition.accepted.length) next = reduced.state;
  }
  return next;
}

interface LiveLedgerJudgeResult {
  decision: ConversationLedgerJudgeDecision | null;
  attempts: ConversationLedgerJudgeCallAttempt[];
  state: ConversationLedgerState;
  snapshot: ConversationObserverSnapshot | null;
  reobserved: boolean;
}

function selectedOpportunityGenerationContext(input: {
  opportunity: ResponseOpportunity;
  state: ConversationLedgerState;
  docs: any[];
  currentTriggerSeq: number;
}): SelectedOpportunityGenerationContext {
  const thread = input.state.threads.find(
    (candidate) => candidate.id === input.opportunity.threadId,
  );
  const source = input.docs.find(
    (message: any) => message.seq === input.opportunity.opportunitySourceSeq,
  );
  return {
    id: input.opportunity.id,
    kind: input.opportunity.kind,
    expectation: input.opportunity.expectation,
    sourceSeq: input.opportunity.opportunitySourceSeq,
    currentTriggerSeq: input.currentTriggerSeq,
    threadId: input.opportunity.threadId,
    targets: [...input.opportunity.targets],
    requestedAction: thread?.requestedAction ?? "",
    sourceContent: source?.content ?? "",
    evidenceSeqs: [...input.opportunity.evidenceSeqs],
    focusCandidate: thread?.focusCandidate ?? null,
    requestIntent: input.opportunity.requestIntent ?? { kind: "none", candidate: null, source: "alex_notes" },
  };
}

async function judgeLiveLedgerTurn(input: {
  runtime: RuntimeState;
  messageSeq: number;
  conversationEpoch: number;
  content: string;
  docs: any[];
  snapshot: ConversationObserverSnapshot | null;
  eligibleTraitIdsForState: (state: ConversationLedgerState) => string[];
  messagesSinceAlex: number;
  cooldownAvailable: boolean;
  backchannelAvailable: boolean;
}): Promise<LiveLedgerJudgeResult | null> {
  let snapshot = input.snapshot;
  let reobserved = false;
  // Retry an unavailable observation once; never manufacture an obligation from a name.
  if (!snapshot?.ledgerStateAfter) {
    snapshot = await reobserveConversationTurn({
      sessionId: input.runtime.sessionId,
      anchorSeq: input.messageSeq,
      conversationEpoch: input.conversationEpoch,
      explicitAlexDefer: false,
    });
    reobserved = true;
  }
  let state = snapshot?.ledgerStateAfter;
  if (!state) return null;
  state = reconcileRuntimeBroadcasts(state, input.runtime.ledgerBroadcasts);

  const allTranscript = transcript(input.docs);
  let judged = await judgeConversationLedgerTurn({
    messages: allTranscript,
    state,
    messagesSinceAlex: input.messagesSinceAlex,
    cooldownAvailable: input.cooldownAvailable,
    backchannelAvailable: input.backchannelAvailable,
    eligibleTraitIds: input.eligibleTraitIdsForState(state),
  });
  const attempts = [...judged.attempts];
  if (judged.decision?.decision === "reobserve" && !reobserved) {
    const reviewed = await reobserveConversationTurn({
      sessionId: input.runtime.sessionId,
      anchorSeq: input.messageSeq,
      conversationEpoch: input.conversationEpoch,
      explicitAlexDefer: false,
    });
    reobserved = true;
    if (reviewed?.ledgerStateAfter) {
      snapshot = reviewed;
      state = reviewed.ledgerStateAfter;
      state = reconcileRuntimeBroadcasts(state, input.runtime.ledgerBroadcasts);
      judged = await judgeConversationLedgerTurn({
        messages: allTranscript,
        state,
        messagesSinceAlex: input.messagesSinceAlex,
        cooldownAvailable: input.cooldownAvailable,
        backchannelAvailable: input.backchannelAvailable,
        eligibleTraitIds: input.eligibleTraitIdsForState(state),
      });
      attempts.push(...judged.attempts);
    }
  }

  await ConversationObservation.updateOne(
    { sessionId: input.runtime.sessionId, anchorSeq: input.messageSeq },
    {
      $set: {
        ledgerVersion: state.ledgerVersion,
        ledgerStateAfter: state,
        ledgerJudgeVersion: CONVERSATION_LEDGER_JUDGE_VERSION,
        ledgerJudgePromptVersion: CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION,
        ledgerJudgeSchemaVersion: CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION,
        ledgerJudgeDecision: judged.decision,
        ledgerJudgeAttempts: attempts,
        ledgerJudgeReobserved: reobserved,
      },
    },
    { upsert: true },
  );
  return { decision: judged.decision, attempts, state, snapshot, reobserved };
}

/**
 * Degraded-mode rollback path. It is used only when Observer is disabled or
 * unavailable, so a transient state-model failure cannot turn the established
 * pushed build into an all-silent system.
 */
async function runLegacyObserverFallback(input: {
  runtime: RuntimeState;
  messageSeq: number;
  postGenerationReevaluation?: boolean;
  session: any;
  docs: any[];
}) {
  const { runtime } = input;
  const anchorDocs = input.postGenerationReevaluation
    ? input.docs.filter((message: any) => message.seq <= input.messageSeq)
    : input.docs;
  const sinceAI = messagesSinceLastAI(anchorDocs);
  const followupWindow = buildFollowupCandidateTranscript(transcript(anchorDocs));
  if (followupWindow && (await isFollowupToAlex(followupWindow))) {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "followup",
      priorityRoute: "followup",
      priorityEvidence: "legacy_fallback_followup",
      mainJudgeDecision: null,
      decisionStage: "priority",
      routeReason: "observer_fallback",
      floorMs: TRIGGER_CONFIG.FOLLOWUP_FLOOR_MS,
      source: "push",
      postGenerationReevaluation: input.postGenerationReevaluation,
      communicativeAct: "follow",
    });
    return;
  }
  if (input.postGenerationReevaluation) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: "post_generation_observer_fallback_no_followup",
      postGenerationReevaluation: true,
    });
    return;
  }
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
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "mediation",
      priorityRoute: null,
      mainJudgeDecision: null,
      mediationTrigger: pendingMediation.mediationTrigger,
      decisionStage: "route_gate",
      routeReason: "observer_fallback_mediation",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "push",
      communicativeAct: "mediate",
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
      routeReason: "observer_fallback_summary",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "summary",
    });
    return;
  }
  if (sinceAI < TRIGGER_CONFIG.COOLDOWN_MIN_MSGS) {
    await recordSilence({ runtime, anchorSeq: input.messageSeq, reason: "cooldown" });
    return;
  }
  const allTranscript = transcript(anchorDocs);
  const signal = await deriveMainJudgeSignal({
    messages: allTranscript,
    revealStats: input.session.revealStats,
    anchorSeq: input.messageSeq,
  });
  if (runtime.latestPushSeq !== input.messageSeq) {
    finishSupersededTurnTrace(runtime, input.messageSeq);
    return;
  }
  const decision = await judgeIntervention(
    allTranscript.slice(-JUDGE_WINDOW_SIZE).map(({ speaker, content }) => ({ speaker, content })),
    sinceAI,
    signal,
  );
  if (!decision) {
    await recordSilence({ runtime, anchorSeq: input.messageSeq, reason: "judge_failure" });
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
    focusCandidate: signal.focusCandidate,
    mediationTrigger: resolved.mediationTrigger,
    decisionStage: "main_judge",
    routeReason: `observer_fallback_${resolved.reason}`,
    floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
    source: "push",
    communicativeAct: decision.decision === "acknowledge" ? "acknowledge" : "contribute",
  });
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
  postGenerationReevaluation?: boolean;
  controllerMode?: "legacy" | "ledger_shadow" | "ledger_active";
  ledgerState?: ConversationLedgerState;
  ledgerJudgeAttempts?: ConversationLedgerJudgeCallAttempt[];
  selectedOpportunity?: SelectedOpportunityGenerationContext;
  judgeEvidenceSeqs?: number[];
}) {
  await AIIntervention.create({
    sessionId: input.runtime.sessionId,
    turnIndex: input.anchorSeq,
    triggerReason: "push",
    decision: "stay_silent",
    source: "push",
    anchorSeq: input.anchorSeq,
    postGenerationReevaluation: input.postGenerationReevaluation,
    mainJudgeDecision: input.decision ?? undefined,
    judgeEvidence: input.evidence ?? undefined,
    judgeEvidenceSeqs: input.judgeEvidenceSeqs,
    controllerMode: input.controllerMode,
    ledgerVersion: input.ledgerState?.ledgerVersion,
    ledgerJudgeVersion: input.ledgerState ? CONVERSATION_LEDGER_JUDGE_VERSION : undefined,
    ledgerJudgePromptVersion: input.ledgerState
      ? CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION
      : undefined,
    ledgerJudgeSchemaVersion: input.ledgerState
      ? CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION
      : undefined,
    ledgerJudgeAttempts: input.ledgerJudgeAttempts,
    selectedOpportunityId: input.selectedOpportunity?.id,
    selectedOpportunitySourceSeq: input.selectedOpportunity?.sourceSeq,
    selectedOpportunityThreadId: input.selectedOpportunity?.threadId,
    selectedOpportunityKind: input.selectedOpportunity?.kind,
    selectedOpportunityExpectation: input.selectedOpportunity?.expectation,
    selectedOpportunityTargets: input.selectedOpportunity?.targets,
    selectedOpportunityRequestedAction: input.selectedOpportunity?.requestedAction,
    decisionStage: silenceDecisionStage(input.reason),
    outcome: "stay_silent",
    silenceReason: input.reason,
    generationSucceeded: false,
    broadcastSucceeded: false,
  });
  traceTurnEvent({
    sessionId: input.runtime.sessionId,
    seq: input.anchorSeq,
    detail:
      `decision: silent (${input.reason}; judge ${input.decision ?? "none"}; ` +
      `evidence ${input.evidence ?? "none"})`,
  });
  finishTurnTrace({
    sessionId: input.runtime.sessionId,
    seq: input.anchorSeq,
    outcome: `silent — ${input.reason}`,
  });
}

function finishSupersededTurnTrace(runtime: RuntimeState, messageSeq: number) {
  traceTurnEvent({
    sessionId: runtime.sessionId,
    seq: messageSeq,
    detail: "routing: superseded by a newer human message before a decision",
  });
  finishTurnTrace({
    sessionId: runtime.sessionId,
    seq: messageSeq,
    outcome: "not spoken — superseded by newer human message",
  });
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
    conversationEpoch: reservation.conversationEpoch,
    interactionObligationEpoch: reservation.interactionObligationEpoch,
    postGenerationReevaluation: reservation.postGenerationReevaluation,
    priorityRoute: reservation.priorityRoute ?? undefined,
    mainJudgeDecision: reservation.mainJudgeDecision ?? undefined,
    judgeEvidence: reservation.judgeEvidence ?? undefined,
    judgeEvidenceSeqs: reservation.judgeEvidenceSeqs,
    selectedTraitId: reservation.selectedTraitId ?? undefined,
    controllerMode: reservation.controllerMode,
    ledgerVersion: reservation.ledgerState?.ledgerVersion,
    ledgerJudgeVersion: reservation.ledgerState
      ? CONVERSATION_LEDGER_JUDGE_VERSION
      : undefined,
    ledgerJudgePromptVersion: reservation.ledgerState
      ? CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION
      : undefined,
    ledgerJudgeSchemaVersion: reservation.ledgerState
      ? CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION
      : undefined,
    ledgerJudgeAttempts: reservation.ledgerJudgeAttempts,
    selectedOpportunityId: reservation.selectedOpportunity?.id,
    selectedOpportunitySourceSeq: reservation.selectedOpportunity?.sourceSeq,
    selectedOpportunityThreadId: reservation.selectedOpportunity?.threadId,
    selectedOpportunityKind: reservation.selectedOpportunity?.kind,
    selectedOpportunityExpectation: reservation.selectedOpportunity?.expectation,
    selectedOpportunityTargets: reservation.selectedOpportunity?.targets,
    selectedOpportunityRequestedAction: reservation.selectedOpportunity?.requestedAction,
    mediationTrigger: reservation.mediationTrigger,
    decisionStage: reservation.decisionStage,
    routeReason: reservation.routeReason,
    outcome: "cancelled",
    silenceReason: reason,
    floorMs: reservation.floorMs,
    generationSucceeded: false,
    broadcastSucceeded: false,
  });
  traceTurnEvent({
    sessionId: runtime.sessionId,
    seq: reservation.traceSeq,
    detail: `reservation: cancelled (${reason})`,
  });
  finishTurnTrace({
    sessionId: runtime.sessionId,
    seq: reservation.traceSeq,
    outcome: `not spoken — ${reason}`,
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

async function reserveTurn(
  runtime: RuntimeState,
  input: Omit<Reservation, "id" | "timer" | "conversationEpoch" | "traceSeq"> & {
    traceSeq?: number;
  },
) {
  if (runtime.lifecycle !== "active" || runtime.reservation || runtime.busy) return;
  const id = randomUUID();
  const timer = setTimeout(() => {
    void runReservation(runtime, id).catch((error) =>
      log.error(`[intervention-v2] reservation error (${runtime.sessionCode}):`, error),
    );
  }, input.floorMs);
  const traceSeq = input.traceSeq ?? input.anchorSeq;
  runtime.reservation = {
    ...input,
    traceSeq,
    conversationEpoch: runtime.conversationEpoch,
    id,
    timer,
  };
  // The Judge has already committed to speaking. Surface that intent during
  // the conversational floor pause; cancellation clears it immediately if a
  // newer human message supersedes this reservation.
  emitTyping(runtime, id, true);
  traceTurnEvent({
    sessionId: runtime.sessionId,
    seq: traceSeq,
    detail:
      `plan: ${input.routeKind} (${input.communicativeAct ?? "speak"}; ${input.routeReason ?? "route"}) ` +
      `after ${input.floorMs}ms`,
  });
}

async function runReservation(runtime: RuntimeState, reservationId: string) {
  const reservation = runtime.reservation;
  if (!reservation || reservation.id !== reservationId) return;
  runtime.reservation = undefined;
  runtime.busy = true;
  runtime.activeGenerationId = reservation.id;
  // Typing already began with the committed floor reservation.
  emitTyping(runtime, reservation.id, true);
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
      expectedConversationEpoch: reservation.conversationEpoch,
      interactionObligationEpoch: reservation.interactionObligationEpoch,
      postGenerationReevaluation: reservation.postGenerationReevaluation === true,
      requestIntentOverride: reservation.requestIntentOverride,
      communicativeAct: reservation.communicativeAct,
      conversationSituation: reservation.conversationSituation,
      judgeEvidenceSeqs: reservation.judgeEvidenceSeqs,
      controllerMode: reservation.controllerMode,
      ledgerVersion: reservation.ledgerState?.ledgerVersion,
      ledgerJudgeVersion: reservation.ledgerState
        ? CONVERSATION_LEDGER_JUDGE_VERSION
        : undefined,
      ledgerJudgePromptVersion: reservation.ledgerState
        ? CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION
        : undefined,
      ledgerJudgeSchemaVersion: reservation.ledgerState
        ? CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION
        : undefined,
      ledgerJudgeAttempts: reservation.ledgerJudgeAttempts,
      selectedOpportunity: reservation.selectedOpportunity,
      onBroadcastSuccess:
        reservation.selectedOpportunity && reservation.ledgerState
          ? async ({ messageSeq }) => {
              runtime.ledgerBroadcasts.set(reservation.selectedOpportunity!.id, messageSeq);
              const reduced = withOpportunityTransition(reservation.ledgerState!, {
                opportunityId: reservation.selectedOpportunity!.id,
                toStatus: "consumed_by_alex",
                reason: "successful_alex_broadcast",
                evidenceSeqs: [reservation.selectedOpportunity!.sourceSeq],
                handledThroughSeq: reservation.ledgerState!.contextThroughSeq,
                alexBroadcastSeq: messageSeq,
                broadcastSucceeded: true,
              });
              if (
                !reduced.transition.accepted.includes(
                  `transition:${reservation.selectedOpportunity!.id}:consumed_by_alex`,
                )
              ) {
                throw new Error(
                  `Selected opportunity consumption rejected: ${reduced.transition.rejected.join(", ")}`,
                );
              }
              await ConversationObservation.updateOne(
                {
                  sessionId: runtime.sessionId,
                  anchorSeq: reservation.selectedOpportunity!.currentTriggerSeq,
                },
                {
                  $set: {
                    ledgerStateAfter: reduced.state,
                    ledgerBroadcastTransition: reduced.transition,
                  },
                },
              );
              return { stateAfter: reduced.state, transition: reduced.transition };
            }
          : undefined,
      // Once generation begins, a human arrival no longer retracts this turn.
      // It is coalesced and evaluated after the current response is broadcast.
      // Lifecycle changes can still cancel the in-flight generation.
      commitGuard: () => runtime.activeGenerationId === reservation.id,
    });

    if (!result.ok) {
      traceTurnEvent({
        sessionId: runtime.sessionId,
        seq: reservation.traceSeq,
        detail: `generation: not broadcast (${result.error ?? "route declined"})`,
      });
      finishTurnTrace({
        sessionId: runtime.sessionId,
        seq: reservation.traceSeq,
        outcome: `not spoken — ${result.error ?? "route declined"}`,
      });
      if (reservation.routeKind === "summary") {
        runtime.summaryStatus = "pending";
        await Session.updateOne(
          { _id: runtime.sessionId, "aiState.summaryStatus": "generating" },
          { $set: { "aiState.summaryStatus": "pending" } },
        );
      }
      return;
    }

    traceTurnEvent({
      sessionId: runtime.sessionId,
      seq: reservation.traceSeq,
      detail: `outcome: Alex broadcast #${result.messageSeq ?? "?"} via ${reservation.routeKind}`,
    });
    finishTurnTrace({
      sessionId: runtime.sessionId,
      seq: reservation.traceSeq,
      outcome: `spoken — ${reservation.routeKind}`,
    });

    if (reservation.interactionObligationEpoch !== undefined) {
      runtime.interactionServedThroughEpoch = Math.max(
        runtime.interactionServedThroughEpoch,
        reservation.interactionObligationEpoch,
      );
      await Session.updateOne(
        { _id: runtime.sessionId },
        {
          $max: {
            "aiState.interactionServedThroughEpoch": runtime.interactionServedThroughEpoch,
          },
        },
      );
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
  } catch (error) {
    traceTurnEvent({
      sessionId: runtime.sessionId,
      seq: reservation.traceSeq,
      detail: "generation: failed (see error log)",
    });
    finishTurnTrace({
      sessionId: runtime.sessionId,
      seq: reservation.traceSeq,
      outcome: "not spoken — generation error",
    });
    throw error;
  } finally {
    runtime.busy = false;
    runtime.activeGenerationId = undefined;
    emitTyping(runtime, reservation.id, false);
    const pendingSeq = runtime.pendingPostGenerationSeq;
    const pendingEpoch = runtime.pendingPostGenerationEpoch;
    const readySeq = runtime.postGenerationReadySeq;
    if (
      pendingSeq !== undefined &&
      postGenerationEvaluationReady({
        pendingSeq,
        pooledThroughSeq: readySeq,
        generating: runtime.busy,
      }) &&
      pendingEpoch !== undefined &&
      runtime.lifecycle === "active"
    ) {
      runtime.pendingPostGenerationSeq = undefined;
      runtime.pendingPostGenerationEpoch = undefined;
      runtime.postGenerationReadySeq = undefined;
      await reevaluatePostGenerationHuman(runtime, pendingSeq, pendingEpoch);
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
    log.debug(
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
  const preference = decidePreferenceFromKnownCoverage((session as any).revealStats);
  const leaderNamesEn = preference.leaders.map((candidate) => `Candidate ${candidate}`);
  const leaderListEn =
    leaderNamesEn.length <= 1
      ? (leaderNamesEn[0] ?? "")
      : `${leaderNamesEn.slice(0, -1).join(", ")} and ${leaderNamesEn.at(-1)}`;
  const leaderListKo = preference.leaders.map((candidate) => `Candidate ${candidate}`).join("·");
  const preferenceEn = preference.candidate
    ? preference.scope === "partial"
      ? `Among the sufficiently covered candidates so far, my current preference is Candidate ${preference.candidate}; combining my own notes with what the team shared gives it the strongest match-and-miss profile.`
      : `My current preference is Candidate ${preference.candidate}; combining my own notes with what the team shared gives it the strongest overall match-and-miss profile.`
    : preference.leaders.length > 1
      ? `${leaderListEn} currently look even at the top ${preference.scope === "partial" ? "among the sufficiently covered candidates so far" : "when I combine my own notes with what the team shared"}, and I would like us to discuss them a little more before separating them.`
      : "I do not have a current preference yet because my own notes plus the shared information are not sufficient for a grounded comparison.";
  const preferenceKo = preference.candidate
    ? preference.scope === "partial"
      ? `현재 충분히 다뤄진 후보들 중 제 선호는 Candidate ${preference.candidate}입니다. 제 노트와 팀이 공유한 정보를 합치면 전체 MATCH/MISS 구도가 가장 좋습니다.`
      : `현재 제 선호는 Candidate ${preference.candidate}입니다. 제 노트와 팀이 공유한 정보를 합치면 전체 MATCH/MISS 구도가 가장 좋습니다.`
    : preference.leaders.length > 1
      ? `${leaderListKo}가 ${preference.scope === "partial" ? "현재 충분히 다뤄진 후보들 중" : "제 노트와 팀이 공유한 정보를 합친 MATCH/MISS 구도에서"} 공동으로 가장 좋아 보입니다. 우열을 가리기 전에 이 후보들을 좀 더 이야기해 보고 싶습니다.`
      : "제 노트와 팀이 공유한 정보를 합쳐도 근거 있게 비교하기에 충분하지 않아 현재 선호 후보는 없습니다.";
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
  runtime.pendingPostGenerationSeq = undefined;
  runtime.pendingPostGenerationEpoch = undefined;
  runtime.postGenerationReadySeq = undefined;
  runtime.postGenerationClaimedSeq = undefined;

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
  const [session, latestHuman, consumedOpportunities] = await Promise.all([
    Session.findById(runtime.sessionId).select("aiState").lean(),
    Message.findOne({ sessionId: runtime.sessionId, senderRole: { $ne: "ai" } })
      .sort({ seq: -1 })
      .select("seq")
      .lean(),
    AIIntervention.find({
      sessionId: runtime.sessionId,
      broadcastSucceeded: true,
      selectedOpportunityId: { $exists: true },
    })
      .select("selectedOpportunityId selectedOpportunityAlexBroadcastSeq")
      .lean(),
  ]);
  const state = (session as any)?.aiState ?? {};
  runtime.conversationEpoch = state.conversationEpoch ?? 0;
  runtime.interactionServedThroughEpoch = state.interactionServedThroughEpoch ?? 0;
  runtime.latestPushSeq = Math.max(runtime.latestPushSeq, (latestHuman as any)?.seq ?? 0);
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
  for (const intervention of consumedOpportunities as any[]) {
    if (intervention.selectedOpportunityId && intervention.selectedOpportunityAlexBroadcastSeq) {
      runtime.ledgerBroadcasts.set(
        intervention.selectedOpportunityId,
        intervention.selectedOpportunityAlexBroadcastSeq,
      );
    }
  }

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
        "aiState.conversationEpoch": runtime.conversationEpoch,
        "aiState.interactionServedThroughEpoch": runtime.interactionServedThroughEpoch,
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
      conversationEpoch: 0,
      interactionServedThroughEpoch: 0,
      ledgerBroadcasts: new Map(),
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

/**
 * Called immediately after a human message is persisted, before slower pooling
 * extraction. A floor-wait reservation is cancelled immediately; an active
 * generation is allowed to finish and the newest arriving human turn is
 * retained for one post-generation evaluation.
 */
export async function noteHumanMessageArrival(input: {
  sessionCode: string;
  messageSeq: number;
  conversationEpoch: number;
  content: string;
}) {
  const runtime = runtimes.get(input.sessionCode);
  if (!runtime) return;
  await runtime.initialized;
  runtime.latestPushSeq = Math.max(runtime.latestPushSeq, input.messageSeq);
  runtime.conversationEpoch = Math.max(runtime.conversationEpoch, input.conversationEpoch);
  const action = humanArrivalAction({
    floorWaiting: Boolean(runtime.reservation),
    generating: runtime.busy,
  });
  if (action === "finish_generation_then_reevaluate") {
    runtime.pendingPostGenerationSeq = Math.max(
      runtime.pendingPostGenerationSeq ?? 0,
      input.messageSeq,
    );
    runtime.pendingPostGenerationEpoch = Math.max(
      runtime.pendingPostGenerationEpoch ?? 0,
      input.conversationEpoch,
    );
    return;
  }
  if (action === "cancel_floor_then_evaluate") {
    await cancelReservation(runtime, "superseded_by_new_human_message");
  }
}

export async function onHumanMessage(input: {
  sessionCode: string;
  messageSeq: number;
  conversationEpoch: number;
  content: string;
  postGenerationReevaluation?: boolean;
}) {
  const runtime = runtimes.get(input.sessionCode);
  if (!runtime) return;
  await runtime.initialized;
  if (!input.postGenerationReevaluation && runtime.postGenerationClaimedSeq === input.messageSeq) {
    return;
  }
  if (
    !input.postGenerationReevaluation &&
    !runtime.busy &&
    runtime.pendingPostGenerationSeq === input.messageSeq
  ) {
    runtime.pendingPostGenerationSeq = undefined;
    runtime.pendingPostGenerationEpoch = undefined;
    runtime.postGenerationReadySeq = undefined;
    runtime.postGenerationClaimedSeq = input.messageSeq;
    await onHumanMessage({ ...input, postGenerationReevaluation: true });
    return;
  }
  runtime.latestPushSeq = Math.max(runtime.latestPushSeq, input.messageSeq);
  if (runtime.lifecycle !== "active") return;
  scheduleLongSilence(runtime);

  if (runtime.busy) {
    runtime.pendingPostGenerationSeq = Math.max(
      runtime.pendingPostGenerationSeq ?? 0,
      input.messageSeq,
    );
    runtime.pendingPostGenerationEpoch = Math.max(
      runtime.pendingPostGenerationEpoch ?? 0,
      input.conversationEpoch,
    );
    // onHumanMessage is invoked only after this message's pooling work has
    // settled, so this seq is safe to evaluate once generation also settles.
    runtime.postGenerationReadySeq = Math.max(
      runtime.postGenerationReadySeq ?? 0,
      input.messageSeq,
    );
    return;
  }

  const controllerMode = config.conversationControllerMode;
  const explicitDefer = detectExplicitAlexDefer(input.content);
  if (controllerMode === "legacy" && explicitDefer.deferred) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: `explicit_alex_defer:${explicitDefer.evidence}`,
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }

  // Direct address is deterministic and should not wait behind tally or judge I/O.
  const immediateAddress = detectDirectAddress(input.content);
  if (immediateAddress.addressed && controllerMode === "legacy") {
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
      postGenerationReevaluation: input.postGenerationReevaluation,
      interactionObligationEpoch: input.conversationEpoch,
      communicativeAct: "answer",
    });
    return;
  }
  if (runtime.reservation) return;

  const [session, docs] = await Promise.all([
    Session.findById(runtime.sessionId).select("aiState.lifecycle revealStats").lean(),
    Message.find({ sessionId: runtime.sessionId }).sort({ seq: 1 }).lean(),
  ]);
  if ((session as any)?.aiState?.lifecycle !== "active") return;

  const snapshot =
    controllerMode !== "legacy" || config.conversationObserverMode === "active"
      ? await waitForConversationObservation({
          sessionId: runtime.sessionId,
          anchorSeq: input.messageSeq,
        })
      : null;
  if (runtime.latestPushSeq !== input.messageSeq) {
    finishSupersededTurnTrace(runtime, input.messageSeq);
    return;
  }

  await updateMediationState(runtime, docs);
  await armSummaryIfEligible(runtime, session, docs);
  if (runtime.latestPushSeq !== input.messageSeq) {
    finishSupersededTurnTrace(runtime, input.messageSeq);
    return;
  }

  const anchorDocs = input.postGenerationReevaluation
    ? docs.filter((message: any) => message.seq <= input.messageSeq)
    : docs;
  const allTranscript = transcript(anchorDocs);
  const sinceAI = messagesSinceLastAI(anchorDocs);
  const cooldownAvailable = sinceAI >= TRIGGER_CONFIG.COOLDOWN_MIN_MSGS;
  const backchannelAvailable =
    runtime.lastBackchannelAt === undefined ||
    Date.now() - runtime.lastBackchannelAt >= TRIGGER_CONFIG.BACKCHANNEL_GAP_MS;

  const groundingSignal = taskGroundingSignal(input.content);
  if (
    groundingSignal === "task_standard_drift" &&
    isLeaderCondition(runtime.conditionCode) &&
    snapshot?.observation.floor.transition !== "held"
  ) {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "mediation",
      priorityRoute: null,
      priorityEvidence: "task_standard_drift",
      mainJudgeDecision: "contribute",
      judgeEvidence: "conversation_grounded_synthesis",
      decisionStage: "priority",
      routeReason: "task_standard_correction",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "push",
      postGenerationReevaluation: input.postGenerationReevaluation,
      communicativeAct: "mediate",
      conversationSituation: snapshot ? describeConversationSituation(snapshot) : undefined,
      judgeEvidenceSeqs: [input.messageSeq],
      controllerMode,
    });
    return;
  }

  if (controllerMode !== "legacy") {
    const surfaced = allSurfacedIds((session as any).revealStats);
    const eligibleTraitIdsForState = (state: ConversationLedgerState): string[] => {
      const thread = state.threads.find((item) => item.id === state.foregroundThreadId);
      const focus = thread && (thread.status === "open" || thread.status === "waiting")
        ? thread.focusCandidate : null;
      return focus ? ALEX_Z_IDS.filter(
        (id) => TRAIT_BY_ID.get(id)?.candidate === focus && !surfaced.has(id),
      ) : [];
    };
    const ledgerResult = await judgeLiveLedgerTurn({
      runtime,
      messageSeq: input.messageSeq,
      conversationEpoch: input.conversationEpoch,
      content: input.content,
      docs: anchorDocs,
      snapshot,
      eligibleTraitIdsForState,
      messagesSinceAlex: sinceAI,
      cooldownAvailable,
      backchannelAvailable,
    });
    if (runtime.latestPushSeq !== input.messageSeq) {
      finishSupersededTurnTrace(runtime, input.messageSeq);
      return;
    }

    if (controllerMode === "ledger_active") {
      if (!ledgerResult) {
        await recordSilence({
          runtime,
          anchorSeq: input.messageSeq,
          reason: "ledger_observer_unavailable",
          postGenerationReevaluation: input.postGenerationReevaluation,
        });
        return;
      }

      const decision = ledgerResult.decision;
      const selectedOpportunity = decision?.selectedOpportunityId
        ? ledgerResult.state.opportunities.find(
            (opportunity) => opportunity.id === decision.selectedOpportunityId,
          )
        : undefined;
      const selectedContext = selectedOpportunity
        ? selectedOpportunityGenerationContext({
            opportunity: selectedOpportunity,
            state: ledgerResult.state,
            docs: anchorDocs,
            currentTriggerSeq: input.messageSeq,
          })
        : undefined;
      const recordLedgerSilence = async (reason: string) =>
        recordSilence({
          runtime,
          anchorSeq: input.messageSeq,
          decision: legacyDecisionForAct(decision?.act ?? null),
          evidence: decision?.evidence,
          reason,
          postGenerationReevaluation: input.postGenerationReevaluation,
          controllerMode,
          ledgerState: ledgerResult.state,
          ledgerJudgeAttempts: ledgerResult.attempts,
          selectedOpportunity: selectedContext,
          judgeEvidenceSeqs: decision?.evidenceSeqs,
        });

      if (!decision) {
        await recordLedgerSilence(
          ledgerResult.state.degradedMode
            ? `ledger_degraded:${ledgerResult.state.conflictCodes.join("+") || "unknown_conflict"}`
            : "ledger_judge_failure",
        );
        return;
      }
      if (decision.decision === "reobserve") {
        await recordLedgerSilence("ledger_reobserve_exhausted");
        return;
      }
      if (decision.decision === "silent" || !decision.act) {
        // A silence that follows a rejected request to speak is not the same
        // event as a Judge that never wanted the floor, even though both report
        // evidence "no_useful_move". Label it separately, and carry the rule
        // codes it backed away from, so contract failures stop being counted as
        // the Judge having nothing to say.
        const capitulated = judgeCapitulatedToSilence(decision, ledgerResult.attempts);
        await recordLedgerSilence(
          ledgerResult.state.degradedMode
            ? `ledger_degraded:${ledgerResult.state.conflictCodes.join("+") || "unknown_conflict"}`
            : decision.evidence === "human_floor_held"
            ? "ledger_human_floor_held"
            : decision.evidence === "cooldown"
              ? "cooldown"
              : capitulated
                ? `ledger_judge_capitulated_after_rejection:${
                    judgeCapitulationRuleCodes(ledgerResult.attempts).join("+") ||
                    "unknown_rule"
                  }`
                : "ledger_judge_silent",
        );
        return;
      }
      if (ledgerSpeechBlockedByHumanFloor(ledgerResult.state)) {
        await recordLedgerSilence("ledger_router_human_floor_held");
        return;
      }
      if (
        !cooldownAvailable &&
        (!selectedOpportunity ||
          !opportunityMayBypassCooldown(ledgerResult.state, selectedOpportunity))
      ) {
        await recordLedgerSilence("cooldown");
        return;
      }
      if (decision.act === "acknowledge" && !backchannelAvailable) {
        await recordLedgerSilence("backchannel_gap");
        return;
      }

      const routeKind = ledgerRouteKindForAct(decision.act, runtime.conditionCode);
      const communicativeAct: CommunicativeAct =
        decision.act === "mediate" && !isLeaderCondition(runtime.conditionCode)
          ? "contribute"
          : decision.act;
      const selectedThread = selectedOpportunity
        ? ledgerResult.state.threads.find(
            (thread) => thread.id === selectedOpportunity.threadId,
          )
        : undefined;
      const selectedFocusCandidate =
        selectedThread?.focusCandidate ?? null;
      await reserveTurn(runtime, {
        anchorSeq: input.messageSeq,
        routeKind,
        priorityRoute:
          selectedOpportunity && (routeKind === "address" || routeKind === "followup")
            ? routeKind
            : null,
        priorityEvidence: selectedOpportunity ? decision.evidence : undefined,
        mainJudgeDecision: legacyDecisionForAct(decision.act),
        judgeEvidence: decision.evidence,
        selectedTraitId: decision.selectedTraitId,
        focusCandidate: selectedFocusCandidate,
        decisionStage: "main_judge",
        routeReason: selectedOpportunity
          ? "ledger_selected_opportunity"
          : "ledger_voluntary_act",
        floorMs:
          routeKind === "address"
            ? TRIGGER_CONFIG.ADDRESS_FLOOR_MS
            : routeKind === "followup"
              ? TRIGGER_CONFIG.FOLLOWUP_FLOOR_MS
              : TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
        source: "push",
        postGenerationReevaluation: input.postGenerationReevaluation,
        requestIntentOverride: selectedContext
          ? selectedContext.requestIntent
          : undefined,
        communicativeAct,
        conversationSituation: describeConversationLedger(ledgerResult.state),
        judgeEvidenceSeqs: decision.evidenceSeqs,
        controllerMode,
        ledgerState: ledgerResult.state,
        ledgerJudgeAttempts: ledgerResult.attempts,
        selectedOpportunity: selectedContext,
      });
      return;
    }

    // Shadow mode records the condition-blind controller result above, then
    // deliberately retains the established live speech behavior.
    if (immediateAddress.addressed) {
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
        postGenerationReevaluation: input.postGenerationReevaluation,
        interactionObligationEpoch: input.conversationEpoch,
        communicativeAct: "answer",
        controllerMode,
      });
      return;
    }
  }

  if (!snapshot) {
    log.warn(
      `[intervention-v2] observer unavailable; using frozen fallback pipeline ` +
        `anchor=${input.messageSeq} session=${runtime.sessionCode}`,
    );
    await runLegacyObserverFallback({
      runtime,
      messageSeq: input.messageSeq,
      postGenerationReevaluation: input.postGenerationReevaluation,
      session,
      docs,
    });
    return;
  }

  const observedCandidates = snapshot.stateAfter.activeThread?.candidates.length
    ? snapshot.stateAfter.activeThread.candidates
    : snapshot.observation.activeCandidates;
  const focusedCandidate = observedCandidates.length === 1 ? observedCandidates[0]! : null;
  const surfaced = allSurfacedIds((session as any).revealStats);
  const eligibleTraitIds = focusedCandidate
    ? ALEX_Z_IDS.filter(
        (id) => TRAIT_BY_ID.get(id)?.candidate === focusedCandidate && !surfaced.has(id),
      )
    : [];
  const pendingObligation = snapshot.stateAfter.pendingAlexObligation;
  const interactionAlreadyServed = Boolean(
    pendingObligation && pendingObligation.rootEpoch <= runtime.interactionServedThroughEpoch,
  );
  const decision = await judgeConversationTurn({
    messages: allTranscript,
    snapshot,
    messagesSinceAlex: sinceAI,
    cooldownAvailable,
    backchannelAvailable,
    postGenerationReevaluation: Boolean(input.postGenerationReevaluation),
    interactionAlreadyServed,
    eligibleTraitIds,
  });
  if (runtime.latestPushSeq !== input.messageSeq) {
    finishSupersededTurnTrace(runtime, input.messageSeq);
    return;
  }
  if (runtime.reservation) return;
  if (!decision) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: "judge_failure",
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }
  traceTurnEvent({
    sessionId: runtime.sessionId,
    seq: input.messageSeq,
    detail:
      `judge: ${decision.decision}/${decision.act ?? "none"}; evidence ${decision.evidence}; ` +
      `thread root ${decision.targetThreadRootSeq ?? "none"}`,
  });
  if (decision.decision === "reobserve") {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      reason: "judge_requested_reobserve",
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }

  const interactionAct =
    decision.decision === "speak" &&
    (decision.act === "answer" || decision.act === "participate" || decision.act === "follow");
  const currentInteractionAlreadyServed =
    interactionAlreadyServed && decision.act !== "follow";
  if (interactionAct && !currentInteractionAlreadyServed) {
    const routeKind: "address" | "followup" = decision.act === "follow" ? "followup" : "address";
    const root = pendingObligation
      ? anchorDocs.find((message: any) => message.seq === pendingObligation.rootSeq)
      : undefined;
    await reserveTurn(runtime, {
      anchorSeq: pendingObligation?.rootSeq ?? input.messageSeq,
      traceSeq: input.messageSeq,
      routeKind,
      priorityRoute: routeKind,
      priorityEvidence: decision.evidence,
      mainJudgeDecision: legacyDecisionForAct(decision.act),
      judgeEvidence: decision.evidence,
      decisionStage: "priority",
      routeReason: "observer_judge_interaction",
      floorMs: TRIGGER_CONFIG.FOLLOWUP_FLOOR_MS,
      source: "push",
      postGenerationReevaluation: input.postGenerationReevaluation,
      interactionObligationEpoch:
        decision.act === "follow" ? snapshot.conversationEpoch : pendingObligation?.rootEpoch,
      requestIntentOverride:
        pendingObligation && root
          ? requestIntentForObserverObligation(pendingObligation, root.content)
          : undefined,
      communicativeAct: decision.act!,
      conversationSituation: describeConversationSituation(snapshot),
      judgeEvidenceSeqs: decision.evidenceSeqs,
    });
    return;
  }

  // An epoch change can open a new interaction turn, but never a second
  // voluntary intervention immediately after the just-finished Alex turn.
  if (input.postGenerationReevaluation) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: legacyDecisionForAct(decision.act),
      evidence: decision.evidence,
      reason: "post_generation_no_interaction_obligation",
      postGenerationReevaluation: true,
    });
    return;
  }

  if (interactionAct && currentInteractionAlreadyServed) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: legacyDecisionForAct(decision.act),
      evidence: decision.evidence,
      reason: "interaction_already_served",
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
      postGenerationReevaluation: input.postGenerationReevaluation,
      communicativeAct: "mediate",
      conversationSituation: describeConversationSituation(snapshot),
      judgeEvidenceSeqs: decision.evidenceSeqs,
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
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }

  if (decision.decision === "silent" || !decision.act) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: "silent",
      evidence: decision.evidence,
      reason:
        decision.evidence === "human_floor_held"
          ? "observer_human_floor_held"
          : decision.evidence === "cooldown"
            ? "cooldown"
            : "judge_silent",
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }

  if (!cooldownAvailable) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: legacyDecisionForAct(decision.act),
      evidence: decision.evidence,
      reason: "cooldown",
    });
    return;
  }

  const cadenceFocusState = deriveFocusDepthState({
    routeKind: "build_on",
    messages: allTranscript,
    revealStats: (session as any).revealStats,
  });
  const cadenceFocusCandidate =
    cadenceFocusState.basis === "comparison" ? null : focusedCandidate;

  if (decision.act === "mediate" && isLeaderCondition(runtime.conditionCode)) {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "mediation",
      priorityRoute: null,
      mainJudgeDecision: "contribute",
      judgeEvidence: decision.evidence,
      focusCandidate: cadenceFocusCandidate,
      decisionStage: "main_judge",
      routeReason: "judge_mediation",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "push",
      communicativeAct: "mediate",
      conversationSituation: describeConversationSituation(snapshot),
      judgeEvidenceSeqs: decision.evidenceSeqs,
    });
    return;
  }

  // A condition-neutral Judge may still return `mediate` for a Peer. Preserve
  // the useful participation while preventing leader-style correction.
  if (decision.act === "mediate") {
    await reserveTurn(runtime, {
      anchorSeq: input.messageSeq,
      routeKind: "build_on",
      priorityRoute: null,
      mainJudgeDecision: "contribute",
      judgeEvidence: decision.evidence,
      selectedTraitId: decision.selectedTraitId,
      focusCandidate: cadenceFocusCandidate,
      decisionStage: "main_judge",
      routeReason: "judge_peer_participation",
      floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
      source: "push",
      postGenerationReevaluation: input.postGenerationReevaluation,
      communicativeAct: "contribute",
      conversationSituation: describeConversationSituation(snapshot),
      judgeEvidenceSeqs: decision.evidenceSeqs,
    });
    return;
  }

  const legacyDecision = legacyDecisionForAct(decision.act);

  const resolved = resolveRoute({
    conditionCode: runtime.conditionCode,
    priorityRoute: null,
    decision: legacyDecision,
    mediation: {
      latched: runtime.mediationLatched,
      buildOnsSinceMediation: runtime.buildOnsSinceMediation,
    },
    backchannelGapPassed: backchannelAvailable,
    sessionId: runtime.sessionId,
    turnSeq: input.messageSeq,
    backchannelRate: TRIGGER_CONFIG.BACKCHANNEL_RATE,
  });
  if (!resolved.routeKind) {
    await recordSilence({
      runtime,
      anchorSeq: input.messageSeq,
      decision: legacyDecision,
      evidence: decision.evidence,
      reason: resolved.reason,
      postGenerationReevaluation: input.postGenerationReevaluation,
    });
    return;
  }

  await reserveTurn(runtime, {
    anchorSeq: input.messageSeq,
    routeKind: resolved.routeKind as Exclude<RouteKind, "greeting" | "closing">,
    priorityRoute: null,
    mainJudgeDecision: legacyDecision,
    judgeEvidence: decision.evidence,
    selectedTraitId: decision.selectedTraitId,
    focusCandidate: cadenceFocusCandidate,
    mediationTrigger: resolved.mediationTrigger,
    decisionStage: "main_judge",
    routeReason: resolved.reason,
    floorMs: TRIGGER_CONFIG.MAIN_ROUTE_DELAY_MS,
    source: "push",
    postGenerationReevaluation: input.postGenerationReevaluation,
    communicativeAct: decision.act,
    conversationSituation: describeConversationSituation(snapshot),
    judgeEvidenceSeqs: decision.evidenceSeqs,
  });
}

async function reevaluatePostGenerationHuman(
  runtime: RuntimeState,
  messageSeq: number,
  conversationEpoch: number,
) {
  // Several human messages may arrive during one generation. Only the newest
  // surviving anchor is evaluated, and a newer arrival wins while this lookup
  // is in flight.
  if (runtime.latestPushSeq !== messageSeq) return;
  runtime.postGenerationClaimedSeq = messageSeq;
  const message = await Message.findOne({
    sessionId: runtime.sessionId,
    seq: messageSeq,
    senderRole: { $ne: "ai" },
  })
    .select("seq content")
    .lean();
  if (!message || runtime.latestPushSeq !== messageSeq || runtime.lifecycle !== "active") return;
  traceTurnEvent({
    sessionId: runtime.sessionId,
    seq: messageSeq,
    detail: "reevaluation: new human epoch arrived while Alex was generating",
  });
  await onHumanMessage({
    sessionCode: runtime.sessionCode,
    messageSeq,
    conversationEpoch,
    content: (message as any).content,
    postGenerationReevaluation: true,
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
    runtime.pendingPostGenerationSeq = undefined;
    runtime.pendingPostGenerationEpoch = undefined;
    runtime.postGenerationReadySeq = undefined;
    runtime.postGenerationClaimedSeq = undefined;
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
