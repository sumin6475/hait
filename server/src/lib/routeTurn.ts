import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import type {
  ConditionCode,
  CommunicativeAct,
  Candidate,
  InterventionDecisionStage,
  MainJudgeDecision,
  PriorityRoute,
  RouteKind,
} from "../types.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { Message } from "../models/Message.js";
import { Session } from "../models/Session.js";
import { allocSeq } from "./seq.js";
import { getRoutePrompt } from "./routePromptRegistry.js";
import {
  buildRouteUserContext,
  formatDeterministicSummary,
  type RequestIntent,
  type RouteOutputScopeGuard,
  type SelectedOpportunityGenerationContext,
  type TranscriptMessage,
} from "./routeContext.js";
import type { ConversationLedgerState, ReducerTransitionAudit } from "./conversationLedger.js";
import { transcriptLabel } from "./labels.js";
import { extractHumanTraitsFast, verifyHumanTraitCandidates } from "./poolingExtractor.js";
import { updateAiSurfaced } from "./poolingDV.js";
import { log } from "./log.js";
import { allSurfacedIds } from "./informationPools.js";
import { generateScopedRouteMessage, type OutputRepairAudit } from "./routeScopedGeneration.js";
import { LEADER_OPENING, PEER_OPENING } from "./prompts.js";
import { KO_LEADER_OPENING, KO_PEER_OPENING } from "./koPilot.js";
import {
  describeConversationSituation,
  waitForConversationObservation,
} from "./conversationObserver.js";

type IO = Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;

export interface RouteTurnInput {
  io: IO;
  sessionCode: string;
  sessionId: string;
  conditionCode: ConditionCode;
  routeKind: RouteKind;
  source: string;
  reservationId?: string;
  anchorSeq: number;
  floorMs: number;
  priorityRoute?: PriorityRoute;
  priorityEvidence?: string;
  mainJudgeDecision?: MainJudgeDecision | null;
  judgeEvidence?: string | null;
  selectedTraitId?: string | null;
  decisionStage?: InterventionDecisionStage;
  routeReason?: string;
  mediationLatched?: boolean;
  mediationEvidence?: string[];
  buildOnsSinceMediation?: number;
  mediationTrigger?: "evidence_latch" | "cadence_after_two_build_ons";
  mediationFocusCandidate?: Candidate | null;
  expectedConversationEpoch?: number;
  interactionObligationEpoch?: number;
  postGenerationReevaluation?: boolean;
  requestIntentOverride?: RequestIntent;
  communicativeAct?: CommunicativeAct;
  conversationSituation?: string;
  judgeEvidenceSeqs?: number[];
  controllerMode?: "legacy" | "ledger_shadow" | "ledger_active";
  ledgerVersion?: string;
  ledgerJudgeVersion?: string;
  ledgerJudgePromptVersion?: string;
  ledgerJudgeSchemaVersion?: string;
  ledgerJudgeAttempts?: unknown[];
  selectedOpportunity?: SelectedOpportunityGenerationContext;
  onBroadcastSuccess?: (input: { messageSeq: number }) => Promise<{
    stateAfter: ConversationLedgerState;
    transition: ReducerTransitionAudit;
  }>;
  commitGuard?: () => boolean;
  /**
   * Resolves when the conversational floor pause has elapsed. Generation runs
   * during the pause; nothing is persisted or broadcast until this settles, so
   * the participant-visible timing is unchanged.
   */
  floorGate?: Promise<void>;
  /** True when a cancelled turn's audit record has already been written elsewhere. */
  supersededRecordOwnedElsewhere?: () => boolean;
}

export function blocksConsecutiveAITurn(input: {
  lastSenderRole?: string;
  routeKind: RouteKind;
  postGenerationReevaluation?: boolean;
}): boolean {
  return (
    input.lastSenderRole === "ai" &&
    input.routeKind !== "closing" &&
    input.routeKind !== "greeting" &&
    !input.postGenerationReevaluation
  );
}

export interface RouteTurnResult {
  ok: boolean;
  messageId?: string;
  messageSeq?: number;
  response?: string;
  ledgerStateAfter?: ConversationLedgerState;
  ledgerTransition?: ReducerTransitionAudit;
  error?: string;
}

export function routeGenerationLimits(routeKind: RouteKind, requestIntent?: RequestIntent) {
  if (routeKind === "summary") {
    return { maxOutputTokens: null, maxContentChars: null, timeoutMs: 60_000 };
  }
  if (routeKind === "closing") {
    return { maxOutputTokens: null, maxContentChars: null, timeoutMs: 60_000 };
  }
  // Complete-list turns enumerate every match and miss; the content schema cap
  // rejects oversized output outright, so give these turns room up front
  // instead of losing the turn to a parse failure or a repair loop.
  if (
    requestIntent?.kind === "complete_single_candidate" ||
    requestIntent?.kind === "complete_all_candidates"
  ) {
    return { maxOutputTokens: 600, maxContentChars: 2_400, timeoutMs: 45_000 };
  }
  // [T-CAP-001] Fallback widened to the complete-list tier (600/2_400).
  // S-C4-001: two turns (#46 full-board recap, #70 comparison blocks) were cut
  // mid-sentence at exactly 800 chars by the schema maxLength while intent
  // classification returned "none", so they fell through to this fallback.
  // Prompts already force 1–2 sentence replies, so normal turns stay short and
  // the wider cap only protects the rare legitimately long output.
  // timeoutMs 45s: any turn may now produce ~2_400 chars, which the old 30s
  // budget risked timing out (= lost turn, same contamination as truncation).
  return { maxOutputTokens: 600, maxContentChars: 2_400, timeoutMs: 45_000 };
}

/**
 * Direct answers keep their prompt-level factual scope, but are not rewritten
 * by candidate/trait extraction. Contribution routes retain their hard guard.
 */
export function routeGenerationGuard(
  routeKind: RouteKind,
  guard: RouteOutputScopeGuard | undefined,
): RouteOutputScopeGuard | undefined {
  if (routeKind !== "address" && routeKind !== "followup") return guard;
  return guard?.reason === "requested_narrowing" ? guard : undefined;
}

export function deterministicGreetingContent(
  conditionCode: ConditionCode,
  language: "en" | "ko",
): string {
  const leader = conditionCode === "C2" || conditionCode === "C4";
  if (language === "ko") return leader ? KO_LEADER_OPENING : KO_PEER_OPENING;
  return leader ? LEADER_OPENING : PEER_OPENING;
}

function defaultCommunicativeAct(routeKind: RouteKind): CommunicativeAct | undefined {
  switch (routeKind) {
    case "address":
      return "answer";
    case "followup":
      return "follow";
    case "build_on":
    case "long_silence":
      return "contribute";
    case "mediation":
      return "mediate";
    case "backchannel":
      return "acknowledge";
    default:
      return undefined;
  }
}

export async function executeRouteTurn(input: RouteTurnInput): Promise<RouteTurnResult> {
  const [session, docs] = await Promise.all([
    Session.findById(input.sessionId).select("language revealStats aiState").lean(),
    Message.find({ sessionId: input.sessionId }).sort({ seq: 1 }).lean(),
  ]);
  if (!session) return { ok: false, error: "session_not_found" };
  const lifecycle = (session as any).aiState?.lifecycle ?? "active";
  if (lifecycle !== "active" && input.routeKind !== "closing") {
    return { ok: false, error: "ai_not_active" };
  }

  const last = docs.at(-1);
  if (
    blocksConsecutiveAITurn({
      lastSenderRole: last?.senderRole,
      routeKind: input.routeKind,
      postGenerationReevaluation: input.postGenerationReevaluation,
    })
  ) {
    return { ok: false, error: "anti_double_post" };
  }

  const messages: TranscriptMessage[] = docs.map((message: any) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: transcriptLabel(message.senderRole),
    content: message.content,
  }));
  const observerSnapshot =
    !input.conversationSituation && !["greeting", "summary", "closing"].includes(input.routeKind)
      ? await waitForConversationObservation({
          sessionId: input.sessionId,
          anchorSeq: input.anchorSeq,
        })
      : null;
  const conversationSituation =
    input.conversationSituation ??
    (observerSnapshot ? describeConversationSituation(observerSnapshot) : undefined);
  const prompt = getRoutePrompt(input.conditionCode, input.routeKind);
  const context = buildRouteUserContext({
    routeKind: input.routeKind,
    conditionCode: input.conditionCode,
    messages,
    revealStats: (session as any).revealStats,
    language: ((session as any).language ?? "en") as "en" | "ko",
    anchorSeq: input.anchorSeq,
    judgeEvidence: input.judgeEvidence,
    selectedTraitId: input.routeKind === "build_on" ? input.selectedTraitId : undefined,
    mediationTrigger: input.mediationTrigger,
    mediationFocusCandidate: input.mediationFocusCandidate,
    mediationEvidence: input.mediationEvidence,
    buildOnsSinceMediation: input.buildOnsSinceMediation,
    requestIntentOverride: input.requestIntentOverride,
    communicativeAct: input.communicativeAct ?? defaultCommunicativeAct(input.routeKind),
    conversationSituation,
    judgeEvidenceSeqs: input.judgeEvidenceSeqs,
    selectedOpportunity: input.selectedOpportunity,
  });
  const previouslySurfacedTraitIds = [
    ...new Set([
      ...allSurfacedIds((session as any).revealStats),
      ...docs.flatMap((message: any) => message.sharedInfoIds ?? []),
    ]),
  ];
  const generationGuard = routeGenerationGuard(input.routeKind, context.outputScopeGuard);
  const focusDepthAudit = {
    focusCandidate: context.focusDepthState.candidate ?? undefined,
    focusBasis: context.focusDepthState.basis,
    focusHumanConfirmedCount: context.focusDepthState.humanConfirmedCount,
    focusDepthThreshold: context.focusDepthState.threshold,
    focusDirective: context.focusDepthState.directive,
    focusGuarded: generationGuard?.reason === "focus_depth",
  };
  const ledgerControllerAudit = {
    controllerMode: input.controllerMode,
    ledgerVersion: input.ledgerVersion,
    ledgerJudgeVersion: input.ledgerJudgeVersion,
    ledgerJudgePromptVersion: input.ledgerJudgePromptVersion,
    ledgerJudgeSchemaVersion: input.ledgerJudgeSchemaVersion,
    ledgerJudgeAttempts: input.ledgerJudgeAttempts,
    selectedOpportunityId: input.selectedOpportunity?.id,
    selectedOpportunitySourceSeq: input.selectedOpportunity?.sourceSeq,
    selectedOpportunityThreadId: input.selectedOpportunity?.threadId,
    selectedOpportunityKind: input.selectedOpportunity?.kind,
    selectedOpportunityExpectation: input.selectedOpportunity?.expectation,
    selectedOpportunityTargets: input.selectedOpportunity?.targets,
    selectedOpportunityRequestedAction: input.selectedOpportunity?.requestedAction,
  };

  const recordGenerationFailure = async (
    error: string,
    model?: string,
    repairAudit?: OutputRepairAudit,
  ) => {
    await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      decision: "stay_silent",
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      conversationEpoch: input.expectedConversationEpoch,
      interactionObligationEpoch: input.interactionObligationEpoch,
      postGenerationReevaluation: input.postGenerationReevaluation,
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
      communicativeAct: input.communicativeAct,
      judgeEvidenceSeqs: input.judgeEvidenceSeqs,
      selectedTraitId: input.selectedTraitId ?? undefined,
      mediationTrigger: input.mediationTrigger,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "generation_failed",
      promptKey: prompt.promptKey,
      promptVersion: prompt.promptVersion,
      promptHash: prompt.promptHash,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      ...focusDepthAudit,
      requestIntentKind: context.requestIntent.kind,
      requestIntentSource: context.requestIntent.source,
      generationSucceeded: false,
      broadcastSucceeded: false,
      ...ledgerControllerAudit,
      repairAudit,
      model,
      error,
    });
  };

  if (input.routeKind === "build_on" && input.judgeEvidence === "relevant_unsurfaced_information") {
    if (
      !input.selectedTraitId ||
      context.outputScopeGuard?.reason !== "selected_note_contribution"
    ) {
      await recordGenerationFailure("selected_trait_missing_or_invalid");
      return { ok: false, error: "selected_trait_missing_or_invalid" };
    }
    if (previouslySurfacedTraitIds.includes(input.selectedTraitId)) {
      await recordGenerationFailure("selected_trait_no_longer_unsurfaced");
      return { ok: false, error: "selected_trait_no_longer_unsurfaced" };
    }
  }

  // Greeting and summary are fixed-format turns, not free-form generation tasks.
  // Use the strategy-neutral, role-specific opening constants and the exact summary
  // layout so neither can drift or be truncated. Every other route keeps the
  // existing model generation and repair path unchanged.
  const greetingContent =
    input.routeKind === "greeting"
      ? deterministicGreetingContent(
          input.conditionCode,
          ((session as any).language ?? "en") as "en" | "ko",
        )
      : null;
  const summaryContent =
    input.routeKind === "summary"
      ? formatDeterministicSummary((session as any).revealStats, input.conditionCode)
      : null;
  const deterministicContent =
    greetingContent ?? summaryContent ?? context.deterministicResponse ?? null;
  const deterministicModel = greetingContent
    ? "server-deterministic-greeting"
    : summaryContent
      ? "server-deterministic-summary"
      : context.taskGroundingSignal !== "none"
        ? "server-deterministic-task-grounding"
      : context.requestIntent.kind === "known_count_request"
        ? "server-deterministic-known-count"
        : "server-deterministic-peer-complete";
  const generated = deterministicContent
    ? {
        result: {
          ok: true as const,
          parsed: { content: deterministicContent },
          requestId: deterministicModel,
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          systemFingerprint: null,
          model: deterministicModel,
        },
      }
    : await generateScopedRouteMessage({
        systemPrompt: prompt.systemPrompt,
        developerPrompt: context.developerPrompt,
        userPrompt: context.transcriptPrompt,
        limits: routeGenerationLimits(input.routeKind, context.requestIntent),
        guard: generationGuard,
        previouslySurfacedTraitIds,
        logContext:
          `stage=${input.decisionStage ?? "system"} route=${input.routeKind} ` +
          `reason=${input.routeReason ?? "none"} anchor=${input.anchorSeq} session=${input.sessionCode}`,
      });
  const result = generated.result;
  if (!result.ok) {
    await recordGenerationFailure(result.error, result.model, generated.repairAudit);
    return { ok: false, error: result.error };
  }
  const extractedAiIds = generated.extractedIds;

  const recordSupersededDuringGeneration = async () => {
    await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      decision: "stay_silent",
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      conversationEpoch: input.expectedConversationEpoch,
      interactionObligationEpoch: input.interactionObligationEpoch,
      postGenerationReevaluation: input.postGenerationReevaluation,
      selectedTraitId: input.selectedTraitId ?? undefined,
      communicativeAct: input.communicativeAct,
      judgeEvidenceSeqs: input.judgeEvidenceSeqs,
      mediationTrigger: input.mediationTrigger,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "cancelled",
      silenceReason: "superseded_during_generation",
      promptKey: prompt.promptKey,
      promptVersion: prompt.promptVersion,
      promptHash: prompt.promptHash,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      ...focusDepthAudit,
      generationSucceeded: true,
      broadcastSucceeded: false,
      ...ledgerControllerAudit,
      repairAudit: generated.repairAudit,
      model: result.model,
    });
  };

  // Hold the finished message until the floor pause is over. Everything after
  // this point — the lifecycle re-read, the second commit check, the seq
  // allocation — runs on the far side of the pause exactly as before.
  if (input.floorGate) await input.floorGate;

  if (input.commitGuard && !input.commitGuard()) {
    if (!input.supersededRecordOwnedElsewhere?.()) await recordSupersededDuringGeneration();
    return { ok: false, error: "superseded_during_generation" };
  }

  // A deadline/manual close may happen while the model call is in flight.
  // Re-check immediately before saving so a stale ordinary turn cannot appear after closing.
  if (input.routeKind !== "closing") {
    const fresh = await Session.findById(input.sessionId).select("aiState.lifecycle").lean();
    if ((fresh as any)?.aiState?.lifecycle !== "active") {
      await AIIntervention.create({
        sessionId: input.sessionId,
        turnIndex: input.anchorSeq,
        triggerReason: input.source,
        decision: "stay_silent",
        routeKind: input.routeKind,
        source: input.source,
        reservationId: input.reservationId,
        anchorSeq: input.anchorSeq,
        conversationEpoch: input.expectedConversationEpoch,
        interactionObligationEpoch: input.interactionObligationEpoch,
        postGenerationReevaluation: input.postGenerationReevaluation,
        selectedTraitId: input.selectedTraitId ?? undefined,
        communicativeAct: input.communicativeAct,
        judgeEvidenceSeqs: input.judgeEvidenceSeqs,
        mediationTrigger: input.mediationTrigger,
        decisionStage: input.decisionStage ?? "system",
        routeReason: input.routeReason,
        outcome: "cancelled",
        silenceReason: "lifecycle_changed_during_generation",
        promptKey: prompt.promptKey,
        promptVersion: prompt.promptVersion,
        promptHash: prompt.promptHash,
        contextFromSeq: context.contextFromSeq ?? undefined,
        contextToSeq: context.contextToSeq ?? undefined,
        floorMs: input.floorMs,
        ...focusDepthAudit,
        generationSucceeded: true,
        broadcastSucceeded: false,
        ...ledgerControllerAudit,
        repairAudit: generated.repairAudit,
        model: result.model,
      });
      return { ok: false, error: "lifecycle_changed_during_generation" };
    }
  }

  // A lifecycle change can race with the read above; check the runtime guard
  // once more immediately before committing the message.
  if (input.commitGuard && !input.commitGuard()) {
    if (!input.supersededRecordOwnedElsewhere?.()) await recordSupersededDuringGeneration();
    return { ok: false, error: "superseded_during_generation" };
  }

  const nextSeq = await allocSeq(input.sessionId);
  const savedMessage = await Message.create({
    sessionId: input.sessionId,
    sender: "ai",
    senderRole: "ai",
    content: result.parsed.content,
    seq: nextSeq,
    sharedInfoIds: [],
  });

  let interventionSaved = false;
  let interventionId: string | undefined;
  try {
    const intervention = await AIIntervention.create({
      sessionId: input.sessionId,
      turnIndex: input.anchorSeq,
      triggerReason: input.source,
      cue: input.routeKind,
      decision: "speak",
      generateMessageId: savedMessage._id,
      responseId: result.requestId,
      response: result.parsed.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs: result.latencyMs,
      systemFingerprint: result.systemFingerprint,
      model: result.model,
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      conversationEpoch: input.expectedConversationEpoch,
      interactionObligationEpoch: input.interactionObligationEpoch,
      postGenerationReevaluation: input.postGenerationReevaluation,
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
      selectedTraitId: input.selectedTraitId ?? undefined,
      communicativeAct: input.communicativeAct,
      judgeEvidenceSeqs: input.judgeEvidenceSeqs,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "saved",
      promptKey: prompt.promptKey,
      promptVersion: prompt.promptVersion,
      promptHash: prompt.promptHash,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      generationSucceeded: true,
      interventionSaved: true,
      broadcastSucceeded: false,
      mediationLatched: input.mediationLatched,
      mediationEvidence: input.mediationEvidence,
      buildOnsSinceMediation: input.buildOnsSinceMediation,
      mediationTrigger: input.mediationTrigger,
      outputScopeCandidate: generationGuard?.candidate,
      requestIntentKind: context.requestIntent.kind,
      requestIntentSource: context.requestIntent.source,
      outputScopeRepaired: Boolean(generated.scopeRepair),
      outputScopeViolation: generated.scopeRepair?.violation,
      internalMetadataRepaired: Boolean(generated.internalMetadataRepair),
      internalMetadataViolation: generated.internalMetadataRepair?.violation,
      repairAudit: generated.repairAudit,
      ...focusDepthAudit,
      ...ledgerControllerAudit,
    });
    interventionId = intervention._id.toString();
    interventionSaved = true;
  } catch (error) {
    log.error("[route-turn] intervention log failed after message save:", error);
  }

  if (!["summary", "closing", "greeting", "backchannel"].includes(input.routeKind)) {
    // The ledger still settles before the broadcast — but with the deterministic
    // closed-pool matcher, not a model call.
    //
    // This block used to `await extractSurfacedTraits(...)`, an LLM round trip
    // sitting between `Message.create` and the socket emit. T-C1-023 measured it
    // at 2.5-3.5 s on every spoken turn; at anchor 14 the message itself was
    // deterministic (0 ms generation) and 3.5 s of that turn was this call
    // alone. Alex's own text quotes trait wording closely — the output contract
    // requires it ("preserve the key wording of a trait") — so the matcher that
    // already serves the human path is a better fit here than it is there, and
    // it cannot time out or fail open.
    //
    // Bounded model verification still runs, in the background, as the same
    // late correction the human path uses. What it adds lands a beat after the
    // broadcast instead of delaying it.
    try {
      const deterministic =
        input.routeKind === "build_on" &&
        input.judgeEvidence === "relevant_unsurfaced_information" &&
        input.selectedTraitId
          ? { acceptedIds: [input.selectedTraitId], verificationCandidates: [] }
          : extractedAiIds
            ? { acceptedIds: extractedAiIds, verificationCandidates: [] }
            : extractHumanTraitsFast({ messageText: result.parsed.content });
      const ids = deterministic.acceptedIds;
      await Promise.all([
        updateAiSurfaced(input.sessionId, ids, savedMessage.seq),
        ids.length
          ? Message.updateOne(
              { _id: savedMessage._id },
              { $addToSet: { sharedInfoIds: { $each: ids } } },
            )
          : Promise.resolve(),
      ]);
      if (deterministic.verificationCandidates.length) {
        void (async () => {
          try {
            const verified = await verifyHumanTraitCandidates({
              messageText: result.parsed.content,
              candidates: deterministic.verificationCandidates,
            });
            const extra = verified.ids.filter((id) => !ids.includes(id));
            if (!extra.length) return;
            await Promise.all([
              updateAiSurfaced(input.sessionId, extra, savedMessage.seq),
              Message.updateOne(
                { _id: savedMessage._id },
                { $addToSet: { sharedInfoIds: { $each: extra } } },
              ),
            ]);
          } catch (error) {
            log.error("[pooling] AI late verification error:", error);
          }
        })();
      }
    } catch (error) {
      log.error("[pooling] AI update error:", error);
    }
  }

  try {
    input.io.to(input.sessionCode).emit("new-message", {
      seq: savedMessage.seq,
      sender: savedMessage.sender,
      senderRole: savedMessage.senderRole,
      content: savedMessage.content,
      createdAt: (savedMessage as any).createdAt.toISOString(),
    });
  } catch (error: any) {
    if (interventionId) {
      await AIIntervention.updateOne(
        { _id: interventionId },
        {
          $set: {
            outcome: "broadcast_failed",
            broadcastSucceeded: false,
            error: error?.message ?? String(error),
          },
        },
      );
    }
    return { ok: false, error: "broadcast_failed" };
  }

  let ledgerCommit:
    | { stateAfter: ConversationLedgerState; transition: ReducerTransitionAudit }
    | undefined;
  if (input.onBroadcastSuccess) {
    try {
      ledgerCommit = await input.onBroadcastSuccess({ messageSeq: savedMessage.seq });
    } catch (error) {
      // The visible broadcast cannot be rolled back. Keep the failure loud so
      // recovery can reconcile the selected opportunity from this audit row.
      log.error("[route-turn] ledger consumption persistence failed after broadcast:", error);
    }
  }
  if (interventionId) {
    try {
      await AIIntervention.updateOne(
        { _id: interventionId },
        {
          $set: {
            outcome: "broadcast",
            broadcastSucceeded: true,
            ...(input.selectedOpportunity
              ? { selectedOpportunityAlexBroadcastSeq: savedMessage.seq }
              : {}),
            ...(ledgerCommit
              ? { selectedOpportunityTransition: ledgerCommit.transition }
              : {}),
          },
        },
      );
    } catch (error) {
      log.error("[route-turn] post-broadcast intervention update failed:", error);
    }
  }

  if (!interventionSaved) {
    log.warn(`[route-turn] message broadcast without intervention row (${input.sessionCode})`);
  }
  return {
    ok: true,
    messageId: savedMessage._id.toString(),
    messageSeq: savedMessage.seq,
    response: result.parsed.content,
    ledgerStateAfter: ledgerCommit?.stateAfter,
    ledgerTransition: ledgerCommit?.transition,
  };
}
