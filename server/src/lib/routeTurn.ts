import type { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "../sockets/events.js";
import type {
  ConditionCode,
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
  type TranscriptMessage,
} from "./routeContext.js";
import { transcriptLabel } from "./labels.js";
import { extractSurfacedTraits } from "./poolingExtractor.js";
import { updateAiSurfaced } from "./poolingDV.js";
import { log } from "./log.js";
import { allSurfacedIds } from "./informationPools.js";
import { generateScopedRouteMessage, type OutputRepairAudit } from "./routeScopedGeneration.js";
import { LEADER_OPENING, PEER_OPENING } from "./prompts.js";
import { KO_LEADER_OPENING, KO_PEER_OPENING } from "./koPilot.js";

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
  commitGuard?: () => boolean;
}

export interface RouteTurnResult {
  ok: boolean;
  messageId?: string;
  messageSeq?: number;
  response?: string;
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

export function deterministicGreetingContent(
  conditionCode: ConditionCode,
  language: "en" | "ko",
): string {
  const leader = conditionCode === "C2" || conditionCode === "C4";
  if (language === "ko") return leader ? KO_LEADER_OPENING : KO_PEER_OPENING;
  return leader ? LEADER_OPENING : PEER_OPENING;
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
    last?.senderRole === "ai" &&
    input.routeKind !== "closing" &&
    input.routeKind !== "greeting"
  ) {
    return { ok: false, error: "anti_double_post" };
  }

  const messages: TranscriptMessage[] = docs.map((message: any) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: transcriptLabel(message.senderRole),
    content: message.content,
  }));
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
  });
  const previouslySurfacedTraitIds = [
    ...new Set([
      ...allSurfacedIds((session as any).revealStats),
      ...docs.flatMap((message: any) => message.sharedInfoIds ?? []),
    ]),
  ];
  const focusDepthAudit = {
    focusCandidate: context.focusDepthState.candidate ?? undefined,
    focusBasis: context.focusDepthState.basis,
    focusHumanConfirmedCount: context.focusDepthState.humanConfirmedCount,
    focusDepthThreshold: context.focusDepthState.threshold,
    focusDirective: context.focusDepthState.directive,
    focusGuarded: context.outputScopeGuard?.reason === "focus_depth",
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
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
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
        userPrompt: context.userPrompt,
        limits: routeGenerationLimits(input.routeKind, context.requestIntent),
        guard: context.outputScopeGuard,
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
      selectedTraitId: input.selectedTraitId ?? undefined,
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
      repairAudit: generated.repairAudit,
      model: result.model,
    });
  };

  if (input.commitGuard && !input.commitGuard()) {
    await recordSupersededDuringGeneration();
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
        selectedTraitId: input.selectedTraitId ?? undefined,
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
        repairAudit: generated.repairAudit,
        model: result.model,
      });
      return { ok: false, error: "lifecycle_changed_during_generation" };
    }
  }

  // Close the freshness window after the lifecycle read as well. For the
  // long-silence route this prevents a newly arrived human message from being
  // overtaken by a response generated for the prior quiet anchor.
  if (input.commitGuard && !input.commitGuard()) {
    await recordSupersededDuringGeneration();
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
  try {
    await AIIntervention.create({
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
      priorityRoute: input.priorityRoute ?? undefined,
      priorityEvidence: input.priorityEvidence,
      mainJudgeDecision: input.mainJudgeDecision ?? undefined,
      judgeEvidence: input.judgeEvidence ?? undefined,
      selectedTraitId: input.selectedTraitId ?? undefined,
      decisionStage: input.decisionStage ?? "system",
      routeReason: input.routeReason,
      outcome: "broadcast",
      promptKey: prompt.promptKey,
      promptVersion: prompt.promptVersion,
      promptHash: prompt.promptHash,
      contextFromSeq: context.contextFromSeq ?? undefined,
      contextToSeq: context.contextToSeq ?? undefined,
      floorMs: input.floorMs,
      generationSucceeded: true,
      interventionSaved: true,
      broadcastSucceeded: true,
      mediationLatched: input.mediationLatched,
      mediationEvidence: input.mediationEvidence,
      buildOnsSinceMediation: input.buildOnsSinceMediation,
      mediationTrigger: input.mediationTrigger,
      outputScopeCandidate: context.outputScopeGuard?.candidate,
      requestIntentKind: context.requestIntent.kind,
      requestIntentSource: context.requestIntent.source,
      outputScopeRepaired: Boolean(generated.scopeRepair),
      outputScopeViolation: generated.scopeRepair?.violation,
      internalMetadataRepaired: Boolean(generated.internalMetadataRepair),
      internalMetadataViolation: generated.internalMetadataRepair?.violation,
      repairAudit: generated.repairAudit,
      ...focusDepthAudit,
    });
    interventionSaved = true;
  } catch (error) {
    log.error("[route-turn] intervention log failed after message save:", error);
  }

  if (!["summary", "closing", "greeting", "backchannel"].includes(input.routeKind)) {
    try {
      // A selected note has already passed the exact output guard, so record
      // its known id directly. Other generated answers are extracted before
      // broadcast. Either way the next human turn sees a settled ledger.
      const ids =
        input.routeKind === "build_on" &&
        input.judgeEvidence === "relevant_unsurfaced_information" &&
        input.selectedTraitId
          ? [input.selectedTraitId]
          : (extractedAiIds ?? (await extractSurfacedTraits(result.parsed.content)));
      await Promise.all([
        updateAiSurfaced(input.sessionId, ids, savedMessage.seq),
        ids.length
          ? Message.updateOne(
              { _id: savedMessage._id },
              { $addToSet: { sharedInfoIds: { $each: ids } } },
            )
          : Promise.resolve(),
      ]);
    } catch (error) {
      log.error("[pooling] AI update error:", error);
    }
  }

  input.io.to(input.sessionCode).emit("new-message", {
    seq: savedMessage.seq,
    sender: savedMessage.sender,
    senderRole: savedMessage.senderRole,
    content: savedMessage.content,
    createdAt: (savedMessage as any).createdAt.toISOString(),
  });

  if (!interventionSaved) {
    log.warn(`[route-turn] message broadcast without intervention row (${input.sessionCode})`);
  }
  return {
    ok: true,
    messageId: savedMessage._id.toString(),
    messageSeq: savedMessage.seq,
    response: result.parsed.content,
  };
}
