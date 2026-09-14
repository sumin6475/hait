import type { RequestIntent } from "./routeContext.js";
import { guardEnabled } from "./guardFlags.js";
import type { Candidate, ParticipantRole } from "../types.js";

export const CONVERSATION_LEDGER_VERSION = "conversation-ledger-v4";

export type ConversationActor = "alex" | ParticipantRole;
export type ThreadStatus = "open" | "waiting" | "resolved" | "superseded";
export type OpportunityKind = "direct_question" | "invitation" | "group_request" | "uptake";
export type OpportunityExpectation = "required" | "invited";
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
  /**
   * The last message seq at which each candidate was literally named in this
   * thread.
   *
   * `focusCandidate` is a single slot filled by a probabilistic observer, and it
   * is null on exactly the turns that matter most: a comparison turn names two
   * candidates, so "the" focus is undecidable, and a continuation turn names
   * none. Session T-C2-037 ran 12 of 23 decisions with focus null, and on the
   * one turn Alex spoke voluntarily from an unranked list it surfaced a
   * Candidate A note while the group was eliminating Candidate C. Recency of
   * literal mention is deterministic, needs no model call, and survives the
   * turns where focus cannot be expressed at all.
   */
  candidateSalience?: Partial<Record<Candidate, number>>;
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
  /**
   * The seq of the Alex turn this opportunity's source message answered.
   *
   * [Issue 13] Set when the deterministic pair holds — Alex's question directly
   * precedes the source message. A turn can both answer Alex and ask for
   * something, and when it does the request branch wins on `kind`, which is
   * right; but an `invitation` gets no cooldown bypass, and the whole point of
   * the uptake bypass is that Alex may receive the answer to its own question.
   * At T-C2-045 seq 17 that cost the turn and then every later one: filtered
   * from the projection by the cooldown on the seq it was current, and by the
   * invited-not-current rule on every seq after. Never selectable at all.
   */
  answersAlexSeq?: number;
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

/**
 * The one test for "a human is holding the floor", over a bare floor reading.
 *
 * Takes the reading rather than the state so the observer's own floor object —
 * which has no `evidenceSeqs` and a wider `expectedNext` — can be asked the same
 * question as the ledger's. Before this, the leader drift gate asked it with an
 * inline `transition !== "held"` and got a different answer whenever Alex was
 * the holder.
 */
export function floorReadingIsHumanHeld(
  floor: Pick<ConversationFloorState, "holder" | "transition">,
): boolean {
  return (
    floor.transition === "held" &&
    floor.holder !== "alex" &&
    floor.holder !== "open" &&
    floor.holder !== "unclear"
  );
}

export function humanFloorHeld(state: ConversationLedgerState): boolean {
  return floorReadingIsHumanHeld(state.floor);
}

/**
 * Whether the held floor is allowed to change a decision on this run.
 *
 * `humanFloorHeld` answers what the observer saw; this answers whether that
 * observation gets to act. Every decision site reads *this* one, so a comparison
 * run has a single answer to "is the floor held" instead of one per call site.
 *
 * T-C2-050 is why the distinction is a function and not a convention. The run
 * asked for the floor veto off and lost three turns to it anyway (seqs 26, 27,
 * 41), because the flag had been applied at the check before the Judge and not
 * at the one after it. Review then found three more unflagged readers — the
 * cooldown bypass, the required-request validator, and the leader drift gate.
 * Four sites, four chances to forget. `docs/measurements.md`, T-C2-050.
 */
export function floorHeldForDecisions(state: ConversationLedgerState): boolean {
  return floorReadingHeldForDecisions(state.floor);
}

/** The same answer, for a caller that holds only the reading. */
export function floorReadingHeldForDecisions(
  floor: Pick<ConversationFloorState, "holder" | "transition">,
): boolean {
  return guardEnabled("humanFloor") && floorReadingIsHumanHeld(floor);
}

export function opportunityMayBypassCooldown(
  state: ConversationLedgerState,
  opportunity: ResponseOpportunity,
): boolean {
  if (opportunity.expectation === "required") return true;
  // An answer to Alex's own question speaks through the cooldown on the same
  // terms as an uptake, because it is one: the request branch takes precedence
  // on `kind` when the turn also asks for something, and that used to cost the
  // bypass. The conditions below are unchanged, so this widens what may bypass,
  // never how far.
  const answersAlex = opportunity.answersAlexSeq !== undefined;
  // Being named is being addressed, whether or not the sentence ends in a
  // question mark. `explicit` is minted on exactly one branch — the observation
  // put Alex in `addressees`, or read the turn as `explicit_addressee` — so it
  // means a participant aimed this at Alex rather than at the room. A question
  // asked that way is `required` and already speaks through the cooldown; a
  // request phrased as a proposal is `invited` and did not, so T-C4-022 seq 22
  // ("Alex - I want you to add about A") could have been met with silence for a
  // reason the participant has no way to see. The two differ in punctuation and
  // in nothing a participant would recognise.
  //
  // This reads the message and never the condition, so pacing stays the
  // condition-invariant arithmetic `docs/adr/0001` requires. It widens what may
  // bypass, not how far: the three conditions below are unchanged, so an
  // invitation still speaks only on the turn it was made, on the foreground
  // thread, and never over a human floor.
  const explicitlyAddressed = opportunity.targetBasis === "explicit";
  if (
    !answersAlex &&
    !explicitlyAddressed &&
    (opportunity.expectation !== "invited" || opportunity.kind !== "uptake")
  ) {
    return false;
  }
  return (
    state.foregroundThreadId === opportunity.threadId &&
    opportunity.evidenceSeqs.includes(state.currentTriggerSeq) &&
    !floorHeldForDecisions(state)
  );
}

/**
 * Whether an open opportunity is still one of this turn's options, or has
 * become history the Judge may read but not take.
 *
 * [Issue 13B] There used to be one rule for every `invited` expectation: its
 * evidence must include the current trigger. That made an invited opportunity
 * answerable during exactly one turn. Miss that turn for any reason — the
 * cooldown, a held floor, a Judge that chose otherwise — and the request became
 * unreachable while `state.opportunities` went on reporting it open. At
 * T-C2-045 `opp:17` was never selectable on any turn at all: cooldown filtered
 * it on the seq it was current, and this rule filtered it on every seq after.
 *
 * Two populations were sharing that rule, and only one of them is momentary.
 *
 * A **request** — `invitation` or `group_request` — is somebody asking Alex for
 * something. It is an obligation, and an obligation does not stop existing
 * because the next message was somebody else's. It stays takeable until it is
 * answered or the reducer retires it, which it does three ways: the thread
 * closes, Alex answers on the thread and supersedes the older ones, or the
 * [B4] TTL expires it. All three are seq arithmetic already in the reducer, so
 * nothing here needs a second staleness rule.
 *
 * An **uptake** is not a request. Nobody asked; it is minted because a human
 * just replied to Alex, and it licenses Alex to carry that reply one step
 * further. The licence is the reply being fresh. Left standing for the TTL it
 * would become an unconditional right to speak on every turn, which is the
 * thing the cadence invariant exists to prevent — so for an uptake the
 * current-trigger requirement is not staleness bookkeeping, it is the whole
 * meaning of the opportunity, and it stays.
 *
 * `required` expectations were never subject to the rule and are untouched: the
 * uptake branch mints `invited` unconditionally, so a required opportunity is
 * never an uptake and always takes the first return. Testing the expectation
 * here as well read as a second safeguard and was the opposite — it would have
 * silently disabled the uptake rule for the one case it exists to cover.
 *
 * The Judge's prompt, its validation and `deterministicVetoBeforeJudge` all
 * read this one function, so the three can never disagree about what was on
 * offer. They used to state the rule separately in two places.
 */
export function opportunityStillStands(
  state: ConversationLedgerState,
  opportunity: ResponseOpportunity,
): boolean {
  if (opportunity.kind !== "uptake") return true;
  return opportunity.evidenceSeqs.includes(state.currentTriggerSeq);
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
  /** Candidates literally named in the current trigger message. */
  mentionedCandidates?: Candidate[];
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
  answersAlexSeq?: number;
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

/**
 * Whether a proposal is somebody asking Alex for something.
 *
 * A question always is. A proposal is only when the Observer read it as an
 * explicit request. Without that second half an ordinary opinion opened a
 * request addressed to Alex: at T-C2-051 seq 29 a participant said that being
 * moody is not something you can neglect when lives are at stake, and the turn
 * minted an invitation. The Judge must then say what the request wants, so the
 * brief read "They asked why D would be the best" — a question nobody had asked.
 * Five turns across two sessions were built on a request nobody made
 * (T-C2-051 seqs 23, 31, 34; T-C2-050 seqs 20, 31), and in all five the writer
 * quietly dropped or repaired the false half, because it is handed the source
 * utterance and not the brief alone. The wording survived; the decision did not.
 *
 * The cost is the act. A listed request outranks every voluntary act, so while
 * one stands Alex cannot take up what the humans just said. At T-C2-051 seq 22 a
 * participant argued that A's danger-recognition matches B's composure, and the
 * reply engaged with none of it — it answered a request from seq 21 instead.
 *
 * The Observer already draws this line for its own obligation snapshot, which
 * requires `explicit` (`pendingAlexObligationFromObservation`). This is the same
 * rule on the other reader, which is where the two had drifted apart.
 */
export function proposalOpensRequest(
  requestExplicitness: ObservedTurnForLedger["requestExplicitness"],
): boolean {
  if (!guardEnabled("implicitRequest")) return true;
  return requestExplicitness === "explicit";
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
  /**
   * The seq of Alex's own question, when the message directly before this turn
   * is Alex's and is question-like.
   *
   * [Issue 12] The uptake branch below reads the Observer's classification of
   * the reply, and at T-C2-043 seq 17 that classification was wrong: it pointed
   * `replyToSeq` at the human's own earlier message and called the relation
   * unrelated, so nothing was minted and the turn was lost. The identical
   * pattern was read correctly thirty messages later, which makes it a
   * reliability distribution over a fact that pure position already settles.
   * Supplied deterministically by the caller; the Observer may still mint the
   * same opportunity on its own reading, and a stronger branch above still wins.
   */
  alexQuestionAwaitingReplySeq?: number;
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
    mentionedCandidates: uniqueSorted(input.observation.mentionedCandidates ?? []),
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
    input.observation.speechAct === "question" ||
    (input.observation.speechAct === "proposal" &&
      proposalOpensRequest(input.observation.requestExplicitness));
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
      ...(input.alexQuestionAwaitingReplySeq !== undefined
        ? { answersAlexSeq: input.alexQuestionAwaitingReplySeq }
        : {}),
    };
  } else if (addressesGroup && requestsAction) {
    opportunity = {
      threadId,
      kind: "group_request",
      // Invited, always. An obligation to answer comes from somebody asking
      // Alex, which the speech act and the addressee already settle above; it
      // does not come from a model's guess at how involved Alex is in a thread.
      // `alexParticipation` was that guess and it is a coin flip: the same
      // script gave "invited" 8 times against "required" 19 in T-C2-050, 19
      // against 9 in T-C2-051, and 2 against 27 in T-C2-052. What it bought was
      // the strongest powers in the ledger - a `required` opportunity bypasses
      // the cooldown unconditionally, cannot expire, is never swept, and the
      // Judge may not stay silent on one opened this turn. T-C2-052 seq 2 is the
      // visible cost: Alex answered one message after its own greeting, where
      // T-C2-051 waited, and nothing in the transcript differed.
      expectation: "invited",
      sourceRole: input.sourceRole,
      opportunitySourceSeq: input.currentTriggerSeq,
      originActor: input.sourceRole,
      originSeq: input.currentTriggerSeq,
      openedAtSeq: input.currentTriggerSeq,
      targets: exactRoster,
      targetBasis: "group_expanded",
      evidenceSeqs: [input.currentTriggerSeq],
      ...(input.alexQuestionAwaitingReplySeq !== undefined
        ? { answersAlexSeq: input.alexQuestionAwaitingReplySeq }
        : {}),
    };
  } else if (
    input.observation.alexRelation === "response_to_alex" ||
    input.observation.relationToPendingAlexQuestion === "direct_answer" ||
    input.observation.relationToPendingAlexQuestion === "related_addition" ||
    // The deterministic half: Alex asked, and this is the turn that followed.
    // Excluded when the turn names other humans and not Alex — a reply aimed at
    // someone else is not a reply to Alex, however well it is positioned.
    (input.alexQuestionAwaitingReplySeq !== undefined &&
      (input.observation.addressees.length === 0 || directlyAddressesAlex || addressesGroup))
  ) {
    // Cluster replies by the Alex turn they answer. A later Alex broadcast must
    // start a new opportunity even when the long-lived project thread is unchanged.
    const obligationRootSeq =
      input.alexQuestionAwaitingReplySeq ??
      input.alexUptakeRootSeq ??
      observedThread?.rootSeq ??
      input.currentTriggerSeq;
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
      // Same rule, and this branch needs it more: it mints an opportunity from a
      // thread being open rather than from anybody asking, so an obligation here
      // would be the system's strongest claim resting on its weakest evidence.
      expectation: "invited",
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
      candidateSalience: { ...(thread.candidateSalience ?? {}) },
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

/**
 * True when a reducer rejection is an idempotent no-op rather than evidence of
 * a state conflict.
 *
 * Both `already_terminal` rejections mean the ledger already holds the outcome
 * the proposal asked for: an opportunity that is closed stays closed, whether
 * the proposal tried to attach fresh evidence to it or to close it again. See
 * the degraded-mode note in `reduceConversationLedger` for why the distinction
 * matters.
 */
export function isRedundantRejection(code: string): boolean {
  return code.endsWith(":already_terminal");
}

/**
 * [B4] How far the conversation may move past an unconsumed, non-required Alex
 * opportunity before it stops being live, counted in seq (which includes Alex's
 * own messages). Sized against the observed runs rather than picked round: in
 * T-C1-024 every invitation Alex took up was consumed one seq after it opened,
 * and cooldown blocks Alex for at most a turn, so eight leaves generous room for
 * a blocked turn plus several human exchanges before an invitation is treated as
 * stale.
 */
const OPPORTUNITY_TTL_SEQS = 8;

const TERMINAL_OPPORTUNITY_STATUSES = new Set<OpportunityStatus>([
  "consumed_by_alex",
  "resolved_by_human",
  "declined",
  "withdrawn",
  "superseded",
  "expired",
]);

function mergeCandidateSalience(
  existing: Partial<Record<Candidate, number>> | undefined,
  mentioned: readonly Candidate[],
  seq: number,
): Partial<Record<Candidate, number>> {
  const merged: Partial<Record<Candidate, number>> = { ...(existing ?? {}) };
  for (const candidate of mentioned) {
    const previous = merged[candidate];
    if (previous === undefined || seq > previous) merged[candidate] = seq;
  }
  return merged;
}

/**
 * The thread's candidates ordered by what the group is currently on: the
 * candidate the current turn explicitly named first when the observer decided
 * one, then the most recently named candidate, then the rest of the scope in its
 * stable order.
 *
 * This is the ranking signal that `focusCandidate` alone could not carry. It is
 * a pure derivation over recorded mentions — no model call, no reinterpretation
 * of wording — so it stays available on the comparison and continuation turns
 * where focus is structurally null.
 *
 * Focus only outranks salience on a `current_explicit` basis. That basis is a
 * claim about *this* turn — normalization drops it when the turn's literal
 * mentions contradict it — so promoting it adds the observer's reading of which
 * named candidate the turn is about, which recency alone cannot express. Every
 * other basis is an inference about an announcement further back, and at
 * T-C2-039 seq 10 a focus carried from an earlier thread outranked the candidate
 * a participant had just named. A hint does not overrule the transcript.
 */
/**
 * The candidates a thread is about.
 *
 * Two callers derived this expression independently — here and in
 * `eligibleTraitIdsForLedgerState` — and the soundness of the Judge's "Your
 * card" sentence rests on the two agreeing: a candidate may only be reported as
 * spent if it was in the same scope the eligible list was filtered to. One
 * definition, so the agreement is structural rather than lucky.
 */
export function threadScopeCandidates(
  thread: Pick<ConversationThread, "candidates" | "scopeCandidates">,
): Candidate[] {
  return thread.scopeCandidates?.length ? thread.scopeCandidates : thread.candidates;
}

/**
 * The foreground thread, but only while it is still a thread Alex can act in.
 *
 * A thread the observer has marked `resolved` or `superseded` stays on the state
 * and stays foreground — the reducer sets `foregroundThreadId` on existence, not
 * on status — so "the foreground thread" and "a live thread" are two different
 * questions and were being answered by two different expressions.
 *
 * Found by review, 2026-09-10, before it reached a session. The eligible-trait
 * list has always applied this test; the Judge's new "Your card" sentence read
 * that list's emptiness as *Alex has nothing left to say*. On a resolved thread
 * the list is empty for a reason that has nothing to do with Alex's card, so a
 * turn where Alex still held all twenty-four of its traits was being told, in
 * plain words, that every candidate was spent. An ambiguous absence had become a
 * false statement. Both readers take the test from here now.
 */
export function liveForegroundThread(
  state: Pick<ConversationLedgerState, "threads" | "foregroundThreadId">,
): ConversationThread | undefined {
  const thread = state.threads.find((item) => item.id === state.foregroundThreadId);
  if (!thread) return undefined;
  return thread.status === "open" || thread.status === "waiting" ? thread : undefined;
}

export function candidateSalienceOrder(
  thread: Pick<ConversationThread, "focusCandidate" | "focusBasis" | "candidates" | "scopeCandidates" | "candidateSalience">,
): Candidate[] {
  const scope = threadScopeCandidates(thread);
  const salience = thread.candidateSalience ?? {};
  const ranked = [...scope].sort((left, right) => {
    const leftSeq = salience[left] ?? 0;
    const rightSeq = salience[right] ?? 0;
    if (leftSeq !== rightSeq) return rightSeq - leftSeq;
    return scope.indexOf(left) - scope.indexOf(right);
  });
  const focus = thread.focusCandidate;
  if (!focus || !ranked.includes(focus)) return ranked;
  if (thread.focusBasis !== "current_explicit") return ranked;
  return [focus, ...ranked.filter((candidate) => candidate !== focus)];
}

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
    const mentionedNow = uniqueSorted(proposal.mentionedCandidates ?? []);
    const existingIndex = state.threads.findIndex((thread) => thread.id === proposal.id);
    if (existingIndex < 0) {
      state.threads.push({
        ...proposal,
        candidates: uniqueSorted(proposal.candidates),
        scopeCandidates: uniqueSorted(proposal.scopeCandidates),
        candidateSalience: mergeCandidateSalience({}, mentionedNow, delta.currentTriggerSeq),
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
        // Salience accumulates; a turn that names nobody must not erase what the
        // group was already on. The spread above would have done exactly that.
        candidateSalience: mergeCandidateSalience(
          existing.candidateSalience,
          mentionedNow,
          delta.currentTriggerSeq,
        ),
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

  const consumedThisReduction: ResponseOpportunity[] = [];
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
    if (proposal.toStatus === "consumed_by_alex") consumedThisReduction.push(state.opportunities[index]!);
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

  // [B4] Opportunities never expired. T-C1-020 ended with three invitations
  // still open, one of them 58 turns old; T-C1-024 carried `opp:5` from seq 5 to
  // the end of the session. Every live opportunity is rendered into the Observer
  // and Judge prompts, so the cost of a turn grows with the backlog — T-C1-024
  // measured Observer output rising 384 → 527 tokens across nine decisions —
  // and the Judge is offered invitations the group moved past long ago.
  //
  // Both rules below are pure seq arithmetic over what the reducer already
  // holds: no model call, no rereading of intent, so the Observer/reducer split
  // in the invariants is untouched.
  //
  // Neither rule touches a direct question. An unanswered `direct_question` is a
  // real obligation on Alex and a failure worth keeping in the record; it is not
  // clutter to sweep.
  for (const consumed of consumedThisReduction) {
    for (const opportunity of state.opportunities) {
      if (opportunity.status !== "open" && opportunity.status !== "deferred") continue;
      if (opportunity.kind === "direct_question" || opportunity.expectation === "required") continue;
      if (opportunity.threadId !== consumed.threadId) continue;
      if (!opportunity.targets.includes("alex")) continue;
      // Strictly older only: the opportunity Alex just answered, and anything
      // raised after it, are untouched.
      if (opportunity.opportunitySourceSeq >= consumed.opportunitySourceSeq) continue;
      // Alex has now answered on this thread, so an older standing invitation
      // describes a request that has just been served. In T-C1-024 `opp:5` and
      // `opp:6` were one invitation restated ("Since we don't have the full
      // picture…" then "If that sounds like a plan?"); the Judge selected
      // `opp:6`, Alex spoke, and `opp:5` outlived the request it stood for.
      opportunity.status = "superseded";
      opportunity.resolutionEvidenceSeqs = uniqueSortedNumbers([
        ...(opportunity.resolutionEvidenceSeqs ?? []),
        ...(consumed.resolutionEvidenceSeqs ?? []),
      ]);
      opportunity.revision += 1;
      transition.accepted.push(
        `transition:${opportunity.id}:superseded:answered_by_${consumed.id}`,
      );
    }
  }
  // Backstop for the case rule 1 cannot reach: Alex never speaks at all, so no
  // consumption ever retires the backlog.
  for (const opportunity of state.opportunities) {
    if (opportunity.status !== "open" && opportunity.status !== "deferred") continue;
    if (opportunity.kind === "direct_question" || opportunity.expectation === "required") continue;
    if (!opportunity.targets.includes("alex")) continue;
    if (delta.contextThroughSeq - opportunity.openedAtSeq <= OPPORTUNITY_TTL_SEQS) continue;
    opportunity.status = "expired";
    opportunity.revision += 1;
    transition.accepted.push(`transition:${opportunity.id}:expired:ttl`);
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
  // A rejection means one of two very different things, and conflating them
  // silenced turns. Material rejections say the delta or a proposal contradicts
  // the authoritative state, so the projection cannot be trusted and the
  // controller should behave conservatively. Redundant rejections say the
  // proposal asked for something the ledger already reflects: re-proposing a
  // closed opportunity, or re-closing one, is an idempotent no-op. The observer
  // is only ever shown open opportunities, so it cannot know an id is finished
  // and will re-propose it as a matter of course. Counting that as evidence of
  // an unreliable ledger put the controller into degraded mode, which forbids
  // all inferred speech — routine bookkeeping became silence.
  //
  // Redundant rejections stay in `transition.rejected`, which is persisted as
  // the reducer audit, so nothing becomes invisible.
  const materialRejections = transition.rejected.filter(
    (code) => !isRedundantRejection(code),
  );
  state.conflictCodes = uniqueSorted([
    ...(delta.conflictCodes ?? []),
    ...materialRejections.map((code) => `reducer:${code}`),
  ]);
  state.degradedMode = delta.degradedMode === true || materialRejections.length > 0;
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
      // The thread's `requestedAction` is deliberately absent, for the same
      // reason it left `describeConversationSituation`: on the ledger_active
      // path this paragraph *is* the generator's `conversationSituation`, so a
      // description of what the group was doing when the thread opened arrives
      // as an instruction. T-C1-022 seq 10 greeted the room again from it. The
      // Judge loses nothing — its prompt serializes the whole decision ledger
      // beside this prose, so the field is still there to read as a fact.
      `Its goal is ${foreground.goal}.`,
      `Its scope candidates are ${(foreground.scopeCandidates ?? foreground.candidates).join(", ") || "not specified"}; current focus is ${foreground.focusCandidate ?? "none"} (${foreground.focusBasis ?? "none"}); evidence messages are ${foreground.evidenceSeqs.join(", ")}.`,
      `Its candidates ordered by what the group is currently on are ${candidateSalienceOrder(foreground).join(", ") || "not specified"}.`,
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
