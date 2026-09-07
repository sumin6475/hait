import type { RequestIntent } from "./routeContext.js";
import type { Candidate, ParticipantRole } from "../types.js";

export const CONVERSATION_LEDGER_VERSION = "conversation-ledger-v4";

export type ConversationActor = "alex" | ParticipantRole;
export type ThreadStatus = "open" | "waiting" | "resolved" | "superseded";
export type OpportunityKind = "direct_question" | "invitation" | "group_request" | "uptake";
export type OpportunityExpectation = "required" | "invited" | "optional";
export type OpportunityStatus =
  | "open"
  | "deferred"
  | "consumed_by_alex"
  | "resolved_by_human"
  | "declined"
  | "withdrawn"
  | "superseded"
  | "expired";
export type TargetBasis = "explicit" | "group_expanded" | "inferred";

export interface ConversationThread {
  id: string;
  threadRootSeq: number;
  status: ThreadStatus;
  goal: string;
  requestedAction: string;
  candidates: Candidate[];
  scopeCandidates: Candidate[];
  focusCandidate: Candidate | null;
  focusBasis: "current_explicit" | "carried_thread" | "multiple_explicit" | "none";
  participants: ConversationActor[];
  evidenceSeqs: number[];
  revision: number;
}

export interface ResponseOpportunity {
  requestIntent?: RequestIntent;
  id: string;
  threadId: string;
  kind: OpportunityKind;
  expectation: OpportunityExpectation;
  sourceRole: ParticipantRole;
  opportunitySourceSeq: number;
  originActor: ConversationActor;
  originSeq: number;
  openedAtSeq: number;
  targets: ConversationActor[];
  targetBasis: TargetBasis;
  evidenceSeqs: number[];
  status: OpportunityStatus;
  revision: number;
  deferredReason?: string;
  handledThroughSeq?: number;
  alexBroadcastSeq?: number;
  resolutionEvidenceSeqs?: number[];
  invalidatedAfterConsumption?: boolean;
  invalidationEvidenceSeqs?: number[];
}

export interface ConversationFloorState {
  holder: ConversationActor | "open" | "unclear";
  expectedNext: ConversationActor[];
  transition: "available" | "held" | "unclear";
  evidenceSeqs: number[];
}

export interface ConversationLedgerState {
  ledgerVersion: typeof CONVERSATION_LEDGER_VERSION;
  sessionKey: string;
  observerVersion: string;
  roster: ConversationActor[];
  contextThroughSeq: number;
  currentTriggerSeq: number;
  foregroundThreadId: string | null;
  threads: ConversationThread[];
  opportunities: ResponseOpportunity[];
  floor: ConversationFloorState;
  repairCodes: string[];
  conflictCodes: string[];
  degradedMode: boolean;
}

export function humanFloorHeld(state: ConversationLedgerState): boolean {
  return (
    state.floor.transition === "held" &&
    state.floor.holder !== "alex" &&
    state.floor.holder !== "open" &&
    state.floor.holder !== "unclear"
  );
}

export function opportunityMayBypassCooldown(
  state: ConversationLedgerState,
  opportunity: ResponseOpportunity,
): boolean {
  if (opportunity.expectation === "required") return true;
  if (opportunity.expectation !== "invited" || opportunity.kind !== "uptake") return false;
  return (
    state.foregroundThreadId === opportunity.threadId &&
    opportunity.evidenceSeqs.includes(state.currentTriggerSeq) &&
    !humanFloorHeld(state)
  );
}

export interface ThreadProposal {
  id: string;
  threadRootSeq: number;
  status: ThreadStatus;
  goal: string;
  requestedAction: string;
  candidates: Candidate[];
  scopeCandidates: Candidate[];
  focusCandidate: Candidate | null;
  focusBasis: ConversationThread["focusBasis"];
  participants: ConversationActor[];
  evidenceSeqs: number[];
}

export interface OpportunityProposal {
  requestIntent?: RequestIntent;
  threadId: string;
  kind: OpportunityKind;
  expectation: OpportunityExpectation;
  sourceRole: ParticipantRole;
  opportunitySourceSeq: number;
  originActor?: ConversationActor;
  originSeq?: number;
  openedAtSeq?: number;
  targets: ConversationActor[];
  targetBasis: TargetBasis;
  evidenceSeqs: number[];
}

export interface OpportunityTransitionProposal {
  opportunityId: string;
  toStatus: OpportunityStatus;
  reason: string;
  evidenceSeqs: number[];
  handledThroughSeq?: number;
  alexBroadcastSeq?: number;
  broadcastSucceeded?: boolean;
  invalidateConsumedInterpretation?: boolean;
  correctedThreadId?: string | null;
}

export interface ConversationObserverDelta {
  ledgerVersion: typeof CONVERSATION_LEDGER_VERSION;
  observerVersion: string;
  sessionKey: string;
  roster: ConversationActor[];
  sourceRole: ParticipantRole;
  currentTriggerSeq: number;
  contextThroughSeq: number;
  foregroundThreadId: string | null;
  threadProposals: ThreadProposal[];
  opportunityProposals: OpportunityProposal[];
  opportunityTransitions: OpportunityTransitionProposal[];
  floorProposal: ConversationFloorState;
  observerConflicts: string[];
  repairCodes: string[];
  conflictCodes: string[];
  degradedMode: boolean;
}

export interface ReducerTransitionAudit {
  ledgerVersion: typeof CONVERSATION_LEDGER_VERSION;
  currentTriggerSeq: number;
  contextThroughSeq: number;
  accepted: string[];
  rejected: string[];
}

export interface ObservedTurnForLedger {
  requestIntent?: RequestIntent | null;
  opportunityTransitions?: OpportunityTransitionProposal[];
  speechAct:
    | "question"
    | "answer"
    | "proposal"
    | "agreement"
    | "defer"
    | "topic_shift"
    | "closure"
    | "other";
  addressees: Array<ConversationActor | "group">;
  activeCandidates: Candidate[];
  mentionedCandidates?: Candidate[];
  scopeCandidates?: Candidate[];
  focusCandidate?: Candidate | null;
  focusBasis?: "current_explicit" | "carried_thread" | "multiple_explicit" | "none";
  requestExplicitness: "none" | "implicit" | "explicit";
  relationToPendingAlexQuestion: "direct_answer" | "related_addition" | "unrelated" | "uncertain";
  alexRelation:
    | "explicit_addressee"
    | "group_participant"
    | "response_to_alex"
    | "about_alex"
    | "unrelated"
    | "uncertain";
  activeThread: {
    threadId: string;
    rootSeq: number;
    status: ThreadStatus;
    goal: string;
    requestedAction: string;
    candidates: Candidate[];
    participants: Array<ConversationActor | "group">;
    expectedResponders: Array<ConversationActor | "group">;
    alexParticipation: "required" | "invited" | "relevant" | "not_involved";
    evidenceSeqs: number[];
  } | null;
  floor: {
    holder: ConversationActor | "open" | "unclear";
    expectedNext: Array<ConversationActor | "group">;
    transition: "available" | "held" | "unclear";
  };
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function exactActors(
  values: readonly (ConversationActor | "group")[],
  roster: readonly ConversationActor[],
): ConversationActor[] {
  const expanded = values.flatMap((value) => (value === "group" ? roster : [value]));
  return uniqueSorted(expanded.filter((value): value is ConversationActor => roster.includes(value)));
}

function normalizeThreadId(value: string, fallbackRootSeq: number): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 80);
  return normalized || `thread-${fallbackRootSeq}`;
}

export function responseOpportunityId(input: {
  opportunitySourceSeq: number;
  kind: OpportunityKind;
  targets: readonly ConversationActor[];
}): string {
  return `opp:${input.opportunitySourceSeq}:${input.kind}:${uniqueSorted(input.targets).join("+")}`;
}

export function createConversationLedgerState(input: {
  sessionKey: string;
  observerVersion: string;
  roster: readonly ConversationActor[];
}): ConversationLedgerState {
  const roster = uniqueSorted(input.roster);
  if (!roster.includes("alex")) roster.push("alex");
  return {
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    sessionKey: input.sessionKey,
    observerVersion: input.observerVersion,
    roster: uniqueSorted(roster),
    contextThroughSeq: 0,
    currentTriggerSeq: 0,
    foregroundThreadId: null,
    threads: [],
    opportunities: [],
    floor: {
      holder: "unclear",
      expectedNext: [],
      transition: "unclear",
      evidenceSeqs: [],
    },
    repairCodes: [],
    conflictCodes: [],
    degradedMode: false,
  };
}

export function observerDeltaFromTurn(input: {
  sessionKey: string;
  observerVersion: string;
  roster: readonly ConversationActor[];
  sourceRole: ParticipantRole;
  currentTriggerSeq: number;
  contextThroughSeq: number;
  observation: ObservedTurnForLedger;
  observerConflicts?: readonly string[];
  threadOriginActor?: ConversationActor;
  alexUptakeRootSeq?: number;
  repairCodes?: readonly string[];
  conflictCodes?: readonly string[];
  degradedMode?: boolean;
}): ConversationObserverDelta {
  const roster = uniqueSorted(input.roster);
  if (!roster.includes("alex")) roster.push("alex");
  const exactRoster = uniqueSorted(roster);
  const observedThread = input.observation.activeThread;
  const threadRootSeq = observedThread?.rootSeq ?? input.currentTriggerSeq;
  const threadId = normalizeThreadId(observedThread?.threadId ?? "", threadRootSeq);
  const threadParticipants = observedThread
    ? exactActors(observedThread.participants, exactRoster)
    : uniqueSorted([input.sourceRole, "alex"]);
  const threadProposal: ThreadProposal = {
    id: threadId,
    threadRootSeq,
    status: observedThread?.status ?? "open",
    goal: observedThread?.goal ?? "other",
    requestedAction: observedThread?.requestedAction ?? "",
    candidates: uniqueSorted(
      input.observation.scopeCandidates ?? observedThread?.candidates ?? input.observation.activeCandidates,
    ),
    scopeCandidates: uniqueSorted(
      input.observation.scopeCandidates ?? observedThread?.candidates ?? input.observation.activeCandidates,
    ),
    focusCandidate: input.observation.focusCandidate ?? null,
    focusBasis: input.observation.focusBasis ?? "none",
    participants: threadParticipants,
    evidenceSeqs: uniqueSortedNumbers([
      ...(observedThread?.evidenceSeqs ?? []),
      input.currentTriggerSeq,
    ]),
  };

  // The observer can mark Alex the explicit addressee while leaving `addressees`
  // empty; the prompt states the addressees -> alexRelation rule in one direction
  // only, and normalization keeps the model's alexRelation when addressees omits
  // Alex. Dispatching on `addressees` alone sent an explicit request that the
  // observer had parsed correctly into the inferred thread-continuation branch,
  // where it merged into an already-consumed id and was never answered. Accept
  // either signal; `requestsAction` below still gates this on the turn actually
  // asking for something.
  const explicitAlexRelationOnly =
    !input.observation.addressees.includes("alex") &&
    input.observation.alexRelation === "explicit_addressee";
  const directlyAddressesAlex =
    input.observation.addressees.includes("alex") || explicitAlexRelationOnly;
  const addressesGroup = input.observation.addressees.includes("group");
  const requestsAction =
    input.observation.speechAct === "question" || input.observation.speechAct === "proposal";
  let opportunity: OpportunityProposal | null = null;
  if (directlyAddressesAlex && requestsAction) {
    opportunity = {
      threadId,
      kind: input.observation.speechAct === "question" ? "direct_question" : "invitation",
      expectation: input.observation.speechAct === "question" ? "required" : "invited",
      sourceRole: input.sourceRole,
      opportunitySourceSeq: input.currentTriggerSeq,
      originActor: input.sourceRole,
      originSeq: input.currentTriggerSeq,
      openedAtSeq: input.currentTriggerSeq,
      targets: ["alex"],
      targetBasis: "explicit",
      evidenceSeqs: [input.currentTriggerSeq],
    };
  } else if (addressesGroup && requestsAction) {
    opportunity = {
      threadId,
      kind: "group_request",
      expectation:
        observedThread?.alexParticipation === "required" ? "required" : "invited",
      sourceRole: input.sourceRole,
      opportunitySourceSeq: input.currentTriggerSeq,
      originActor: input.sourceRole,
      originSeq: input.currentTriggerSeq,
      openedAtSeq: input.currentTriggerSeq,
      targets: exactRoster,
      targetBasis: "group_expanded",
      evidenceSeqs: [input.currentTriggerSeq],
    };
  } else if (
    input.observation.alexRelation === "response_to_alex" ||
    input.observation.relationToPendingAlexQuestion === "direct_answer" ||
    input.observation.relationToPendingAlexQuestion === "related_addition"
  ) {
    // Cluster replies by the Alex turn they answer. A later Alex broadcast must
    // start a new opportunity even when the long-lived project thread is unchanged.
    const obligationRootSeq =
      input.alexUptakeRootSeq ?? observedThread?.rootSeq ?? input.currentTriggerSeq;
    opportunity = {
      threadId,
      kind: "uptake",
      expectation: "invited",
      sourceRole: input.sourceRole,
      opportunitySourceSeq: obligationRootSeq,
      originActor: "alex",
      originSeq: obligationRootSeq,
      openedAtSeq: input.currentTriggerSeq,
      targets: ["alex"],
      targetBasis: "inferred",
      evidenceSeqs: [input.currentTriggerSeq],
    };
  } else if (
    observedThread &&
    (observedThread.status === "open" || observedThread.status === "waiting") &&
    (observedThread.alexParticipation === "required" ||
      observedThread.alexParticipation === "invited") &&
    !["other", "agreement", "defer", "closure", "topic_shift"].includes(input.observation.speechAct)
  ) {
    const originSeq = observedThread.rootSeq;
    opportunity = {
      threadId,
      kind: "group_request",
      expectation: observedThread.alexParticipation === "required" ? "required" : "invited",
      sourceRole: input.sourceRole,
      opportunitySourceSeq: originSeq,
      originActor: input.threadOriginActor ?? (originSeq < input.currentTriggerSeq ? "alex" : input.sourceRole),
      originSeq,
      openedAtSeq: input.currentTriggerSeq,
      targets: ["alex"],
      targetBasis: "inferred",
      evidenceSeqs: uniqueSortedNumbers([originSeq, input.currentTriggerSeq]),
    };
  }

  return {
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    observerVersion: input.observerVersion,
    sessionKey: input.sessionKey,
    roster: exactRoster,
    sourceRole: input.sourceRole,
    currentTriggerSeq: input.currentTriggerSeq,
    contextThroughSeq: input.contextThroughSeq,
    foregroundThreadId: observedThread ? threadId : null,
    threadProposals: observedThread || opportunity ? [threadProposal] : [],
    opportunityProposals: opportunity ? [{ ...opportunity, ...(input.observation.requestIntent ? { requestIntent: input.observation.requestIntent } : {}) }] : [],
    opportunityTransitions: input.observation.opportunityTransitions ?? [],
    floorProposal: {
      holder: exactRoster.includes(input.observation.floor.holder as ConversationActor)
        ? (input.observation.floor.holder as ConversationActor)
        : input.observation.floor.holder === "open"
          ? "open"
          : "unclear",
      expectedNext: exactActors(input.observation.floor.expectedNext, exactRoster),
      transition: input.observation.floor.transition,
      evidenceSeqs: [input.currentTriggerSeq],
    },
    observerConflicts: [...(input.observerConflicts ?? [])],
    repairCodes: [
      ...(input.repairCodes ?? []),
      // Audit the addressee/relation disagreement that this delta resolved in
      // Alex's favour, so over-firing stays measurable rather than invisible.
      ...(explicitAlexRelationOnly && requestsAction
        ? ["alex_addressee_taken_from_explicit_relation"]
        : []),
    ],
    conflictCodes: [...(input.conflictCodes ?? [])],
    degradedMode: input.degradedMode === true,
  };
}

function copyState(state: ConversationLedgerState): ConversationLedgerState {
  return {
    ...state,
    roster: [...state.roster],
    threads: state.threads.map((thread) => ({
      ...thread,
      candidates: [...thread.candidates],
      scopeCandidates: [...(thread.scopeCandidates ?? thread.candidates)],
      focusCandidate: thread.focusCandidate ?? null,
      focusBasis: thread.focusBasis ?? "none",
      participants: [...thread.participants],
      evidenceSeqs: [...thread.evidenceSeqs],
    })),
    opportunities: state.opportunities.map((opportunity) => ({
      ...opportunity,
      targets: [...opportunity.targets],
      evidenceSeqs: [...opportunity.evidenceSeqs],
      resolutionEvidenceSeqs: opportunity.resolutionEvidenceSeqs
        ? [...opportunity.resolutionEvidenceSeqs]
        : undefined,
      invalidationEvidenceSeqs: opportunity.invalidationEvidenceSeqs
        ? [...opportunity.invalidationEvidenceSeqs]
        : undefined,
    })),
    floor: {
      ...state.floor,
      expectedNext: [...state.floor.expectedNext],
      evidenceSeqs: [...state.floor.evidenceSeqs],
    },
    repairCodes: [...(state.repairCodes ?? [])],
    conflictCodes: [...(state.conflictCodes ?? [])],
    degradedMode: state.degradedMode === true,
  };
}

function validEvidence(evidenceSeqs: readonly number[], contextThroughSeq: number): boolean {
  return evidenceSeqs.every(
    (seq) => Number.isInteger(seq) && seq > 0 && seq <= contextThroughSeq,
  );
}

const TERMINAL_OPPORTUNITY_STATUSES = new Set<OpportunityStatus>([
  "consumed_by_alex",
  "resolved_by_human",
  "declined",
  "withdrawn",
  "superseded",
  "expired",
]);

export function reduceConversationLedger(
  previous: ConversationLedgerState | null | undefined,
  delta: ConversationObserverDelta,
): { state: ConversationLedgerState; transition: ReducerTransitionAudit } {
  const base = previous ??
    createConversationLedgerState({
      sessionKey: delta.sessionKey,
      observerVersion: delta.observerVersion,
      roster: delta.roster,
    });
  const state = copyState(base);
  const transition: ReducerTransitionAudit = {
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    currentTriggerSeq: delta.currentTriggerSeq,
    contextThroughSeq: delta.contextThroughSeq,
    accepted: [],
    rejected: [],
  };
  if (delta.sessionKey !== state.sessionKey) {
    transition.rejected.push("delta:session_mismatch");
    return { state, transition };
  }
  if (delta.contextThroughSeq < state.contextThroughSeq) {
    transition.rejected.push("delta:stale_context");
    return { state, transition };
  }
  if (delta.currentTriggerSeq > delta.contextThroughSeq) {
    transition.rejected.push("delta:trigger_after_context");
    return { state, transition };
  }
  const authoritativeRoster = uniqueSorted(state.roster);
  if (uniqueSorted(delta.roster).join("|") !== authoritativeRoster.join("|")) {
    transition.rejected.push("delta:roster_mismatch");
  }
  if (!authoritativeRoster.includes(delta.sourceRole)) {
    transition.rejected.push(`delta:invalid_source:${delta.sourceRole}`);
    return { state, transition };
  }

  for (const proposal of delta.threadProposals) {
    const invalidParticipants = proposal.participants.filter(
      (participant) => !authoritativeRoster.includes(participant),
    );
    if (
      proposal.threadRootSeq > delta.contextThroughSeq ||
      invalidParticipants.length > 0 ||
      !validEvidence(proposal.evidenceSeqs, delta.contextThroughSeq)
    ) {
      transition.rejected.push(`thread:${proposal.id}:invalid`);
      continue;
    }
    const existingIndex = state.threads.findIndex((thread) => thread.id === proposal.id);
    if (existingIndex < 0) {
      state.threads.push({
        ...proposal,
        candidates: uniqueSorted(proposal.candidates),
        scopeCandidates: uniqueSorted(proposal.scopeCandidates),
        participants: uniqueSorted(proposal.participants),
        evidenceSeqs: uniqueSortedNumbers(proposal.evidenceSeqs),
        revision: 1,
      });
      transition.accepted.push(`thread:${proposal.id}:created`);
    } else {
      const existing = state.threads[existingIndex]!;
      state.threads[existingIndex] = {
        ...existing,
        ...proposal,
        threadRootSeq: existing.threadRootSeq,
        candidates: uniqueSorted(proposal.scopeCandidates),
        scopeCandidates: uniqueSorted(proposal.scopeCandidates),
        participants: uniqueSorted([...existing.participants, ...proposal.participants]),
        evidenceSeqs: uniqueSortedNumbers([...existing.evidenceSeqs, ...proposal.evidenceSeqs]),
        revision: existing.revision + 1,
      };
      transition.accepted.push(`thread:${proposal.id}:revised`);
    }
  }

  for (const proposal of delta.opportunityProposals) {
    const targets = uniqueSorted(proposal.targets);
    const invalidTargets = targets.filter((target) => !authoritativeRoster.includes(target));
    const sourceIsHuman = authoritativeRoster.includes(proposal.sourceRole);
    const originActor = proposal.originActor ?? proposal.sourceRole;
    const originSeq = proposal.originSeq ?? proposal.opportunitySourceSeq;
    const openedAtSeq = proposal.openedAtSeq ?? delta.currentTriggerSeq;
    if (
      !state.threads.some((thread) => thread.id === proposal.threadId) ||
      !sourceIsHuman ||
      !authoritativeRoster.includes(originActor) ||
      !targets.includes("alex") ||
      invalidTargets.length > 0 ||
      openedAtSeq !== delta.currentTriggerSeq ||
      originSeq > openedAtSeq ||
      !validEvidence(proposal.evidenceSeqs, delta.contextThroughSeq)
    ) {
      transition.rejected.push(
        `opportunity:${proposal.opportunitySourceSeq}:${proposal.kind}:invalid`,
      );
      continue;
    }
    const id = responseOpportunityId({
      opportunitySourceSeq: proposal.opportunitySourceSeq,
      kind: proposal.kind,
      targets,
    });
    const existingIndex = state.opportunities.findIndex((opportunity) => opportunity.id === id);
    if (existingIndex < 0) {
      state.opportunities.push({
        ...proposal,
        id,
        originActor,
        originSeq,
        openedAtSeq,
        targets,
        evidenceSeqs: uniqueSortedNumbers(proposal.evidenceSeqs),
        status: "open",
        revision: 1,
      });
      transition.accepted.push(`opportunity:${id}:created`);
    } else {
      const existing = state.opportunities[existingIndex]!;
      // A closed opportunity is history, not a live record. Merging fresh
      // evidence into one grew a terminal entry for the rest of the session and
      // hid the closure from the observer, which is shown only open
      // opportunities and therefore kept re-proposing an id that can never be
      // selected again. Reject instead, so a derivation branch that can only
      // ever mint one id per session becomes visible in the audit.
      if (TERMINAL_OPPORTUNITY_STATUSES.has(existing.status)) {
        transition.rejected.push(`opportunity:${id}:already_terminal`);
        continue;
      }
      state.opportunities[existingIndex] = {
        ...existing,
        threadId: proposal.threadId,
        expectation: proposal.expectation,
        targetBasis: proposal.targetBasis,
        ...(proposal.requestIntent ? { requestIntent: proposal.requestIntent } : {}),
        evidenceSeqs: uniqueSortedNumbers([...existing.evidenceSeqs, ...proposal.evidenceSeqs]),
        revision: existing.revision + 1,
      };
      transition.accepted.push(`opportunity:${id}:evidence_attached`);
    }
  }

  for (const proposal of delta.opportunityTransitions) {
    const index = state.opportunities.findIndex(
      (opportunity) => opportunity.id === proposal.opportunityId,
    );
    if (index < 0 || proposal.evidenceSeqs.length === 0 || !validEvidence(proposal.evidenceSeqs, delta.contextThroughSeq) ||
      (proposal.correctedThreadId && !state.threads.some((thread) => thread.id === proposal.correctedThreadId))) {
      transition.rejected.push(`transition:${proposal.opportunityId}:invalid`);
      continue;
    }
    const opportunity = state.opportunities[index]!;
    if (proposal.invalidateConsumedInterpretation) {
      if (opportunity.status !== "consumed_by_alex") {
        transition.rejected.push(`transition:${opportunity.id}:not_consumed`);
        continue;
      }
      state.opportunities[index] = {
        ...opportunity,
        invalidatedAfterConsumption: true,
        invalidationEvidenceSeqs: uniqueSortedNumbers([
          ...(opportunity.invalidationEvidenceSeqs ?? []),
          ...proposal.evidenceSeqs,
        ]),
        revision: opportunity.revision + 1,
      };
      transition.accepted.push(`transition:${opportunity.id}:invalidated_after_consumption`);
      continue;
    }
    if (TERMINAL_OPPORTUNITY_STATUSES.has(opportunity.status) &&
      !(proposal.toStatus === "consumed_by_alex" && proposal.broadcastSucceeded && opportunity.status !== "consumed_by_alex") &&
      !(proposal.toStatus === "open" && opportunity.status !== "consumed_by_alex" &&
        proposal.evidenceSeqs.includes(delta.currentTriggerSeq))) {
      transition.rejected.push(`transition:${opportunity.id}:already_terminal`);
      continue;
    }
    if (proposal.toStatus === "consumed_by_alex" && !proposal.broadcastSucceeded) {
      transition.rejected.push(`transition:${opportunity.id}:consume_without_broadcast`);
      continue;
    }
    state.opportunities[index] = {
      ...opportunity,
      status: proposal.toStatus,
      threadId: proposal.correctedThreadId ?? opportunity.threadId,
      deferredReason: proposal.toStatus === "deferred" ? proposal.reason : undefined,
      handledThroughSeq: proposal.handledThroughSeq ?? opportunity.handledThroughSeq,
      alexBroadcastSeq: proposal.alexBroadcastSeq ?? opportunity.alexBroadcastSeq,
      resolutionEvidenceSeqs: uniqueSortedNumbers([
        ...(opportunity.resolutionEvidenceSeqs ?? []),
        ...proposal.evidenceSeqs,
      ]),
      revision: opportunity.revision + 1,
    };
    transition.accepted.push(`transition:${opportunity.id}:${proposal.toStatus}`);
  }

  // Reconcile all threads, including stale open opportunities persisted by older versions.
  for (const opportunity of state.opportunities) {
    if (opportunity.status !== "open" && opportunity.status !== "deferred") continue;
    const thread = state.threads.find((item) => item.id === opportunity.threadId);
    if (thread?.status !== "resolved" && thread?.status !== "superseded") continue;
    opportunity.status = thread.status === "resolved" ? "resolved_by_human" : "superseded";
    opportunity.resolutionEvidenceSeqs = uniqueSortedNumbers([...(opportunity.resolutionEvidenceSeqs ?? []), ...thread.evidenceSeqs]);
    opportunity.revision += 1;
    transition.accepted.push(`transition:${opportunity.id}:${opportunity.status}:thread_closed`);
  }

  const invalidFloorActors = [
    ...(delta.floorProposal.holder === "open" || delta.floorProposal.holder === "unclear"
      ? []
      : [delta.floorProposal.holder]),
    ...delta.floorProposal.expectedNext,
  ].filter((actor) => !authoritativeRoster.includes(actor));
  if (
    invalidFloorActors.length ||
    !validEvidence(delta.floorProposal.evidenceSeqs, delta.contextThroughSeq)
  ) {
    transition.rejected.push("floor:invalid");
  } else {
    state.floor = {
      ...delta.floorProposal,
      expectedNext: uniqueSorted(delta.floorProposal.expectedNext),
      evidenceSeqs: uniqueSortedNumbers(delta.floorProposal.evidenceSeqs),
    };
    transition.accepted.push("floor:updated");
  }

  state.observerVersion = delta.observerVersion;
  state.ledgerVersion = CONVERSATION_LEDGER_VERSION;
  state.contextThroughSeq = delta.contextThroughSeq;
  state.currentTriggerSeq = delta.currentTriggerSeq;
  state.repairCodes = uniqueSorted([...(state.repairCodes ?? []), ...(delta.repairCodes ?? [])]);
  state.conflictCodes = uniqueSorted([
    ...(delta.conflictCodes ?? []),
    ...transition.rejected.map((code) => `reducer:${code}`),
  ]);
  state.degradedMode = delta.degradedMode === true || transition.rejected.length > 0;
  if (delta.foregroundThreadId === null) {
    state.foregroundThreadId = null;
  } else if (
    delta.foregroundThreadId &&
    state.threads.some((thread) => thread.id === delta.foregroundThreadId)
  ) {
    state.foregroundThreadId = delta.foregroundThreadId;
  }
  for (const conflict of delta.observerConflicts) {
    transition.rejected.push(`observer_conflict:${conflict}`);
  }
  state.threads.sort((left, right) => left.threadRootSeq - right.threadRootSeq);
  state.opportunities.sort(
    (left, right) => left.opportunitySourceSeq - right.opportunitySourceSeq,
  );
  return { state, transition };
}

export function withOpportunityTransition(
  state: ConversationLedgerState,
  input: Omit<OpportunityTransitionProposal, "evidenceSeqs"> & { evidenceSeqs?: number[] },
): { state: ConversationLedgerState; transition: ReducerTransitionAudit } {
  const sourceRole = state.roster.find((actor): actor is ParticipantRole => actor !== "alex");
  if (!sourceRole) {
    return {
      state,
      transition: {
        ledgerVersion: CONVERSATION_LEDGER_VERSION,
        currentTriggerSeq: state.currentTriggerSeq,
        contextThroughSeq: state.contextThroughSeq,
        accepted: [],
        rejected: ["transition:no_human_source"],
      },
    };
  }
  return reduceConversationLedger(state, {
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    observerVersion: state.observerVersion,
    sessionKey: state.sessionKey,
    roster: state.roster,
    sourceRole,
    currentTriggerSeq: state.currentTriggerSeq,
    contextThroughSeq: state.contextThroughSeq,
    foregroundThreadId: state.foregroundThreadId,
    threadProposals: [],
    opportunityProposals: [],
    opportunityTransitions: [
      {
        ...input,
        evidenceSeqs: input.evidenceSeqs ?? [state.currentTriggerSeq],
      },
    ],
    floorProposal: state.floor,
    observerConflicts: [],
    repairCodes: [],
    conflictCodes: [],
    degradedMode: state.degradedMode,
  });
}

/**
 * Degraded-mode projection for a literal Alex address. It uses the same
 * reducer and identity rules as Observer output, but never runs for pronoun or
 * group-address hints.
 */
export function withProvisionalAlexAddress(
  state: ConversationLedgerState,
  input: {
    sourceRole: ParticipantRole;
    currentTriggerSeq: number;
    content: string;
    candidates?: Candidate[];
  },
): { state: ConversationLedgerState; transition: ReducerTransitionAudit } {
  const threadId = `thread:provisional-alex:${input.currentTriggerSeq}`;
  return reduceConversationLedger(state, {
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    observerVersion: state.observerVersion,
    sessionKey: state.sessionKey,
    roster: state.roster,
    sourceRole: input.sourceRole,
    currentTriggerSeq: input.currentTriggerSeq,
    contextThroughSeq: input.currentTriggerSeq,
    foregroundThreadId: threadId,
    threadProposals: [
      {
        id: threadId,
        threadRootSeq: input.currentTriggerSeq,
        status: "open",
        goal: "answer_question",
        requestedAction: input.content.trim().slice(0, 500),
        candidates: uniqueSorted(input.candidates ?? []),
        scopeCandidates: uniqueSorted(input.candidates ?? []),
        focusCandidate: input.candidates?.length === 1 ? input.candidates[0]! : null,
        focusBasis: input.candidates?.length === 1 ? "current_explicit" : "none",
        participants: uniqueSorted([input.sourceRole, "alex"]),
        evidenceSeqs: [input.currentTriggerSeq],
      },
    ],
    opportunityProposals: [
      {
        threadId,
        kind: "direct_question",
        expectation: "required",
        sourceRole: input.sourceRole,
        opportunitySourceSeq: input.currentTriggerSeq,
        originActor: input.sourceRole,
        originSeq: input.currentTriggerSeq,
        openedAtSeq: input.currentTriggerSeq,
        targets: ["alex"],
        targetBasis: "explicit",
        evidenceSeqs: [input.currentTriggerSeq],
      },
    ],
    opportunityTransitions: [],
    floorProposal: {
      holder: "open",
      expectedNext: ["alex"],
      transition: "available",
      evidenceSeqs: [input.currentTriggerSeq],
    },
    observerConflicts: ["literal_alex_address_provisional_fallback"],
    repairCodes: [],
    conflictCodes: ["literal_alex_address_provisional_fallback"],
    degradedMode: true,
  });
}

export function describeConversationLedger(state: ConversationLedgerState): string {
  const foreground = state.foregroundThreadId
    ? state.threads.find((thread) => thread.id === state.foregroundThreadId)
    : undefined;
  const openOpportunities = state.opportunities.filter(
    (opportunity) => opportunity.status === "open" || opportunity.status === "deferred",
  );
  const lines = [
    `The transcript and structured state are current through message ${state.contextThroughSeq}.`,
    `The turn being judged is message ${state.currentTriggerSeq}.`,
    `The authoritative participant roster is ${state.roster.join(", ")}.`,
  ];
  if (foreground) {
    lines.push(
      `The foreground thread is ${foreground.id}, rooted at message ${foreground.threadRootSeq}; it is ${foreground.status}.`,
      `Its goal is ${foreground.goal}: ${foreground.requestedAction || "no additional action description"}.`,
      `Its scope candidates are ${(foreground.scopeCandidates ?? foreground.candidates).join(", ") || "not specified"}; current focus is ${foreground.focusCandidate ?? "none"} (${foreground.focusBasis ?? "none"}); evidence messages are ${foreground.evidenceSeqs.join(", ")}.`,
    );
  } else {
    lines.push("No thread is exclusively foregrounded; other recorded threads may still remain open.");
  }
  lines.push(
    `The floor is ${state.floor.transition}; holder ${state.floor.holder}; expected next ${state.floor.expectedNext.join(", ") || "not specified"}.`,
  );
  if (!openOpportunities.length) {
    lines.push("There are no open or deferred Alex response opportunities.");
  } else {
    for (const opportunity of openOpportunities) {
      lines.push(
        `Opportunity ${opportunity.id} is ${opportunity.status}: ${opportunity.kind}/${opportunity.expectation}, originated by ${opportunity.originActor ?? opportunity.sourceRole} at message ${opportunity.originSeq ?? opportunity.opportunitySourceSeq}, opened at ${opportunity.openedAtSeq ?? opportunity.opportunitySourceSeq}, targets ${opportunity.targets.join(", ")}, thread ${opportunity.threadId}, evidence ${opportunity.evidenceSeqs.join(", ")}.`,
      );
    }
  }
  return lines.join("\n");
}
