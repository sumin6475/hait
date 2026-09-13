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
  forbidsQuestionOutput,
  formatDeterministicSummary,
  type RequestIntent,
  type RouteOutputScopeGuard,
  type SelectedOpportunityGenerationContext,
  type TranscriptMessage,
} from "./routeContext.js";
import type { ConversationLedgerState, ReducerTransitionAudit } from "./conversationLedger.js";
import { transcriptLabel } from "./labels.js";
import {
  extractHumanTraitsFast,
  verifyHumanTraitCandidates,
} from "./poolingExtractor.js";
import { updateAiSurfaced } from "./poolingDV.js";
import { contributesToBoard } from "../types.js";
import { log } from "./log.js";
import { allSurfacedIds } from "./informationPools.js";
import { computeCandidateList } from "./candidateList.js";
import { humanNarrowedCandidates } from "./interventionJudge.js";
import {
  generateScopedRouteMessage,
  outputScopeViolation,
  type OutputRepairAudit,
} from "./routeScopedGeneration.js";
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
  /** Exactly what this turn may disclose, named by the Judge. */
  discloseTraitIds?: string[];
  /** The Judge's one-sentence instruction to the writer. */
  judgeBrief?: string;
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
  /** The observation's literal candidate mentions, when the caller already holds them. */
  observedMentionedCandidates?: Candidate[];
  judgeEvidenceSeqs?: number[];
  controllerMode?: "legacy" | "ledger_shadow" | "ledger_active";
  ledgerVersion?: string;
  ledgerJudgeVersion?: string;
  ledgerJudgePromptVersion?: string;
  ledgerJudgeSchemaVersion?: string;
  ledgerJudgeAttempts?: unknown[];
  /**
   * [Issue 17] The open requests Alex owed when this turn ran, for the record a
   * generation failure leaves behind. Supplied by the caller, which is the
   * layer that holds the ledger.
   */
  owedRequestIds?: string[];
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

export function routeGenerationLimits(
  routeKind: RouteKind,
  requestIntent?: RequestIntent,
): { maxOutputTokens: number | null; maxContentChars: number | null; timeoutMs: number; verbosity?: "low" } {
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
  // Every other turn is an ordinary chat reply, and the model's own length
  // control says so. The three cases above enumerate a whole profile and are
  // deliberately left at the API default.
  // `verbosity: "low"` was here and is gone with `docs/adr/0010`. It was a
  // global "be terse" nudge sitting on top of a turn the Judge may have told to
  // give a complete list, and it pushed the same direction as the count bound
  // that emptied eighteen of T-C4-022's twenty-four messages. Length is the
  // prompt's job, and the record says the prompt is doing it.
  return { maxOutputTokens: 600, maxContentChars: 2_400, timeoutMs: 45_000 };
}

/**
 * The guard the generation call is judged against.
 *
 * This used to strip the guard on `address` and `followup` unless it was the
 * reveal budget, on the reasoning that a direct answer should not be rewritten
 * for naming the wrong candidate. `docs/adr/0010` makes that unnecessary and
 * harmful in one move: the guard is now the list the Judge named for this turn,
 * and the two routes it stripped are the ones that carried 21 of Alex's 24 turns
 * in T-C4-022. Dropping it there would drop the only factual bound that remains.
 */
export function routeGenerationGuard(
  _routeKind: RouteKind,
  guard: RouteOutputScopeGuard | undefined,
): RouteOutputScopeGuard | undefined {
  return guard;
}

export interface OutputGuardAudit {
  /**
   * Whether any output scope guard was in force at generation. False is a
   * recorded fact, not an absence — the T-C2-041 seq 4 question was
   * unanswerable precisely because a turn with no guard and a turn whose guard
   * passed left the same empty record.
   */
  inForce: boolean;
  reason?: string;
  candidate?: Candidate;
  /** Exactly what the turn was permitted to introduce. */
  allowedTraitIds?: string[];
  requiredTraitId?: string;
  /**
   * What the deterministic matcher found in the broadcast message. Pool
   * identifiers only: no participant text, and no message content, enters this
   * record. The matcher is network-free, which is why it can run here at all.
   */
  traitIds: string[];
  /** The bound that was violated, when one was. */
  violation?: string;
}

/**
 * What Alex was allowed to reveal on this turn, and what it actually revealed.
 *
 * An enforcement mechanism that cannot be audited from its own output fails
 * silently, and this one already did: in T-C1-027 three messages shipped six to
 * eight traits each against a guard correctly set to one, recorded no violation,
 * and were found only by rebuilding the turn's context by hand.
 */
export function outputGuardAudit(input: {
  guard: RouteOutputScopeGuard | undefined;
  broadcastTraitIds: string[];
  violation?: string;
}): OutputGuardAudit {
  const { guard } = input;
  return {
    inForce: Boolean(guard),
    ...(guard?.reason !== undefined ? { reason: guard.reason } : {}),
    ...(guard?.candidate ? { candidate: guard.candidate } : {}),
    ...(guard?.allowedTraitIds ? { allowedTraitIds: guard.allowedTraitIds } : {}),
    ...(guard?.requiredTraitId ? { requiredTraitId: guard.requiredTraitId } : {}),
    traitIds: input.broadcastTraitIds,
    ...(input.violation ? { violation: input.violation } : {}),
  };
}

/**
 * The silence a lost turn is recorded as.
 *
 * Exhausted repair is not an API failure and must not be filed as one: the model
 * answered, the answer broke a bound, and the turn was spent rather than an
 * oversized message broadcast. Everything else keeps its own reason.
 */
export function silenceReasonForGenerationFailure(error: string): string | undefined {
  if (error.startsWith("output_violation_after_repair")) return "output_violation_after_repair";
  if (error.startsWith("output_repair_failed")) return "output_repair_failed";
  return undefined;
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
    // Every route now carries what the Judge named. The build_on restriction is
    // gone with `docs/adr/0010`: answering "list what you have on C" is the turn
    // that most needs to disclose, and it is not a build_on.
    discloseTraitIds: input.discloseTraitIds,
    judgeBrief: input.judgeBrief,
    mediationTrigger: input.mediationTrigger,
    mediationFocusCandidate: input.mediationFocusCandidate,
    mediationEvidence: input.mediationEvidence,
    buildOnsSinceMediation: input.buildOnsSinceMediation,
    requestIntentOverride: input.requestIntentOverride,
    communicativeAct: input.communicativeAct ?? defaultCommunicativeAct(input.routeKind),
    conversationSituation,
    // The task-grounding route branches on this; every other route ignores it.
    // A caller that already awaited the observation passes it, so the route is
    // not made to re-read the raw text for a fact the observation states.
    observedMentionedCandidates:
      input.observedMentionedCandidates ?? observerSnapshot?.observation.mentionedCandidates,
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
  // The board Alex reasoned against on this turn, read before Alex's own message
  // is extracted into it. Written to every record this turn can leave and read
  // by nothing — see the shadow-only assertion in test-intervention-v2.
  const candidateListAudit = {
    candidateList: computeCandidateList((session as any).revealStats),
    // What the humans had been naming lately, recorded so a session can be
    // re-read against a different window than the one the Judge was given.
    narrowedCandidates:
      humanNarrowedCandidates(
        docs.map((message: any) => ({
          seq: message.seq,
          senderRole: message.senderRole,
          speaker: message.sender,
          content: message.content ?? "",
        })),
      ) ?? undefined,
  };
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
      ...candidateListAudit,
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
      discloseTraitIds: input.discloseTraitIds,
      judgeBrief: input.judgeBrief,
      mediationTrigger: input.mediationTrigger,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "generation_failed",
      silenceReason: silenceReasonForGenerationFailure(error),
      // [Issue 21] The bounds that were in force, on the one class of turn where
      // they decided the outcome. Only `repairAudit.guard` carried them before,
      // so a guard-caused silence did not say which guard, and the audit that
      // found this had to reconstruct it from a nested field.
      outputGuard: outputGuardAudit({
        guard: generationGuard,
        broadcastTraitIds: [],
        ...(silenceReasonForGenerationFailure(error) === "output_violation_after_repair"
          ? { violation: error.replace(/^output_violation_after_repair:\s*/, "") }
          : {}),
      }),
      // [Issue 17] This path recorded no `owedRequestIds`, and it is the
      // largest silence class there is: ten of T-C1-021's silences came
      // through here and none of them said what the group was still waiting
      // for. The caller holds the ledger; this function never did.
      owedRequestIds: input.owedRequestIds,
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
    const buildOnTraitId = input.discloseTraitIds?.[0];
    if (
      !buildOnTraitId ||
      context.outputScopeGuard?.reason !== "selected_note_contribution"
    ) {
      await recordGenerationFailure("selected_trait_missing_or_invalid");
      return { ok: false, error: "selected_trait_missing_or_invalid" };
    }
    if (previouslySurfacedTraitIds.includes(buildOnTraitId)) {
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
        // [Issue 22] The human turn this one is answering. Traits Alex repeats
        // back from it are uptake, not disclosure, and the prompts ask for that
        // uptake by name.
        repliedToContent: messages.find(
          (message) => message.seq === input.anchorSeq && message.senderRole !== "ai",
        )?.content,
        // [T-C2-046] Not folded into `generationGuard`: two of the three turns
        // that broke this rule had no guard at all, so a question check hung
        // off the guard would have missed them.
        forbidQuestion: forbidsQuestionOutput(input.conditionCode),
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
      ...candidateListAudit,
      triggerReason: input.source,
      decision: "stay_silent",
      routeKind: input.routeKind,
      source: input.source,
      reservationId: input.reservationId,
      anchorSeq: input.anchorSeq,
      conversationEpoch: input.expectedConversationEpoch,
      interactionObligationEpoch: input.interactionObligationEpoch,
      postGenerationReevaluation: input.postGenerationReevaluation,
      discloseTraitIds: input.discloseTraitIds,
      judgeBrief: input.judgeBrief,
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
        ...candidateListAudit,
        triggerReason: input.source,
        decision: "stay_silent",
        routeKind: input.routeKind,
        source: input.source,
        reservationId: input.reservationId,
        anchorSeq: input.anchorSeq,
        conversationEpoch: input.expectedConversationEpoch,
        interactionObligationEpoch: input.interactionObligationEpoch,
        postGenerationReevaluation: input.postGenerationReevaluation,
        discloseTraitIds: input.discloseTraitIds,
      judgeBrief: input.judgeBrief,
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

  // What the matcher found in the message that is about to go out. Computed once
  // here, then reused by the ledger update below, so recording the guard's
  // evidence costs no extra pass and — because the matcher is deterministic and
  // network-free — puts no model call back on the broadcast path.
  const broadcastExtraction = extractedAiIds
    ? {
        acceptedIds: extractedAiIds,
        // [Issue 25] These used to be dropped. A guarded turn reused the
        // guard's id list and threw the near matches away, so the one class of
        // turn on which Alex actually discloses was the one class the bounded
        // verifier never saw. The guard still decides on the ids alone — a near
        // match may not cost a turn, and settling it is a model call that may
        // not sit before the broadcast — but the board now gets the same late
        // correction the unguarded and human paths already had.
        verificationCandidates: generated.unresolvedCandidates ?? [],
      }
    : extractHumanTraitsFast({ messageText: result.parsed.content });
  const broadcastTraitIds = [...new Set(broadcastExtraction.acceptedIds)];

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
      ...candidateListAudit,
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
      discloseTraitIds: input.discloseTraitIds,
      judgeBrief: input.judgeBrief,
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
      outputGuard: outputGuardAudit({
        guard: generationGuard,
        broadcastTraitIds,
        violation: generated.scopeRepair?.violation,
      }),
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

  /**
   * [Issue 25] What the message actually carried, written onto the turn's own
   * record once it is settled.
   *
   * `outputGuard.traitIds` is the evidence the guard decided on, and it has to
   * be: the decision happens before the broadcast, where only the network-free
   * matcher may run. It was also the only trait list the turn left behind, so
   * the guard's guess was being read as the record of the message — and on the
   * two of them that disagree, the analysis was reading the guess.
   *
   * These are two different questions and they now have two different fields.
   * `surfacedTraitIds` answers the second one, after the bounded verifier has
   * had its say, and re-runs the same bounds against it. A bound broken here is
   * recorded and nothing more: the message is already out, blocking it is not
   * on offer, and buying it back would cost a model call on the broadcast path
   * that T-C1-024 took off it. What the record must not do is stay silent —
   * the reveal budget is what keeps Alex's disclosure rate comparable across
   * conditions, and a budget whose breaches are invisible is not measurable.
   */
  const recordSurfaced = async (ids: string[]) => {
    if (!interventionId) return;
    const surfacedTraitIds = [...new Set(ids)];
    const postBroadcastViolation = generationGuard
      ? outputScopeViolation(
          result.parsed.content,
          surfacedTraitIds,
          generationGuard,
          previouslySurfacedTraitIds,
          // [Issue 22 x 25] The same echo set the guard decided on. Recomputing
          // it here, or omitting it, would make the post-broadcast record
          // disagree with the pre-broadcast decision by construction — a turn
          // that correctly took up a participant's own words would be filed as
          // having broken its budget.
          generated.echoedTraitIds ?? [],
        )
      : null;
    try {
      await AIIntervention.updateOne(
        { _id: interventionId },
        {
          $set: {
            surfacedTraitIds,
            ...(postBroadcastViolation ? { postBroadcastViolation } : {}),
          },
        },
      );
    } catch (error) {
      log.error("[route-turn] surfaced-trait record failed after broadcast:", error);
    }
    if (postBroadcastViolation) {
      log.warn(
        `[route-turn] delivered message broke ${postBroadcastViolation} ` +
          `guard=${generationGuard?.reason ?? "none"} surfaced=${surfacedTraitIds.length} ` +
          `guardSaw=${broadcastTraitIds.length} session=${input.sessionCode} seq=${savedMessage.seq}`,
      );
    }
  };

  if (contributesToBoard(input.routeKind)) {
  // What Alex actually put on the board, recorded only once the message is out.
  //
  // A turn becomes real at the broadcast, not at generation. `CONTEXT.md` says a
  // successful broadcast is the only thing that consumes an opportunity, and
  // that a failed generation, a blocked floor or a cancelled turn all leave it
  // open. The ledger obeyed that and pooling did not: this ran before the emit,
  // so a broadcast that threw left the traits counted as surfaced with nothing
  // to roll them back. The other lost-turn paths were always safe — a guard
  // death, a supersession and a lifecycle cancel all return before the message
  // is created at all.
  //
  // The matcher stays deterministic and network-free. This block used to
  // `await extractSurfacedTraits(...)`, an LLM round trip on the broadcast path
  // that T-C1-023 measured at 2.5-3.5 s of every spoken turn. Bounded model
  // verification still runs in the background, as the same late correction the
  // human path uses.
    try {
      const contributedTraitId = input.discloseTraitIds?.[0];
      const deterministic =
        input.routeKind === "build_on" &&
        input.judgeEvidence === "relevant_unsurfaced_information" &&
        contributedTraitId
          ? {
              // The selected note is guaranteed onto the board whatever the
              // matcher made of the wording — that is what this branch is for.
              // Whatever else the matcher plainly accepted is kept rather than
              // replaced: dropping it was how a second trait in the same
              // message left no trace.
              acceptedIds: [
                ...new Set([...(input.discloseTraitIds ?? []), ...broadcastExtraction.acceptedIds]),
              ],
              verificationCandidates: broadcastExtraction.verificationCandidates,
            }
          : broadcastExtraction;
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
            // [Issue 25] What the matcher found in Alex's message and the
            // verifier then declined. The human path has recorded this since
            // issue 15, after T-C2-045 lost two traits to a silent decline;
            // Alex's own near matches only started reaching the verifier in
            // this issue, and arrived with the same blind spot. Same field,
            // same meaning, pool identifiers only.
            const declined = [
              ...new Set(
                deterministic.verificationCandidates
                  .map((candidate) => candidate.traitId)
                  .filter((id) => !verified.ids.includes(id) && !ids.includes(id)),
              ),
            ];
            if (!extra.length && !declined.length) return await recordSurfaced(ids);
            await Promise.all([
              extra.length
                ? updateAiSurfaced(input.sessionId, extra, savedMessage.seq)
                : Promise.resolve(),
              Message.updateOne(
                { _id: savedMessage._id },
                {
                  ...(extra.length
                    ? { $addToSet: { sharedInfoIds: { $each: extra } } }
                    : {}),
                  ...(declined.length ? { $set: { declinedTraitIds: declined } } : {}),
                },
              ),
            ]);
            await recordSurfaced([...ids, ...extra]);
          } catch (error) {
            log.error("[pooling] AI late verification error:", error);
            await recordSurfaced(ids);
          }
        })();
      } else {
        await recordSurfaced(ids);
      }
    } catch (error) {
      log.error("[pooling] AI update error:", error);
    }
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
