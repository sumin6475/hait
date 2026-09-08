import assert from "node:assert/strict";
import type { Candidate } from "../types.js";
import { replayObservedConversation } from "../eval/conversationReplay.js";
import {
  CONVERSATION_LEDGER_VERSION,
  candidateSalienceOrder,
  createConversationLedgerState,
  describeConversationLedger,
  humanFloorHeld,
  observerDeltaFromTurn,
  opportunityMayBypassCooldown,
  reduceConversationLedger,
  responseOpportunityId,
  withOpportunityTransition,
  withProvisionalAlexAddress,
  type ConversationLedgerState,
  type ObservedTurnForLedger,
} from "../lib/conversationLedger.js";
import { eligibleTraitIdsForLedgerState } from "../lib/interventionEngine.js";
import {
  canonicalizeConversationLedgerJudgeDecision,
  buildLedgerJudgeUserMessage,
  conversationLedgerDecisionProjection,
  deterministicVetoBeforeJudge,
  ledgerJudgeRoleGoal,
  ledgerJudgeSchemaFor,
  judgeCapitulatedToSilence,
  judgeCapitulationRuleCodes,
  validateConversationLedgerJudgeDecision,
  type ConversationLedgerJudgeCallAttempt,
} from "../lib/interventionJudge.js";

const roster = ["alex", "humanX", "humanY"] as const;

const provisionalDirect = withProvisionalAlexAddress(
  createConversationLedgerState({
    sessionKey: "T-C2-DIRECT",
    observerVersion: "test-observer",
    roster,
  }),
  {
    sourceRole: "humanX",
    currentTriggerSeq: 1,
    content: "Alex, who would you pick between A and B?",
    candidates: ["A", "B"],
  },
);
assert.equal(provisionalDirect.state.currentTriggerSeq, 1);
assert.equal(provisionalDirect.state.opportunities.length, 1);
assert.deepEqual(provisionalDirect.state.opportunities[0], {
  id: "opp:1:direct_question:alex",
  threadId: "thread:provisional-alex:1",
  kind: "direct_question",
  expectation: "required",
  sourceRole: "humanX",
  opportunitySourceSeq: 1,
  originActor: "humanX",
  originSeq: 1,
  openedAtSeq: 1,
  targets: ["alex"],
  targetBasis: "explicit",
  evidenceSeqs: [1],
  status: "open",
  revision: 1,
});
assert.equal(humanFloorHeld(provisionalDirect.state), false);
assert.equal(
  humanFloorHeld({
    ...provisionalDirect.state,
    floor: {
      holder: "humanY",
      expectedNext: ["humanY"],
      transition: "held",
      evidenceSeqs: [1],
    },
  }),
  true,
);

function observation(input: Partial<ObservedTurnForLedger> = {}): ObservedTurnForLedger {
  return {
    speechAct: "other",
    addressees: [],
    activeCandidates: [],
    requestExplicitness: "none",
    relationToPendingAlexQuestion: "unrelated",
    alexRelation: "unrelated",
    activeThread: null,
    floor: { holder: "open", expectedNext: [], transition: "available" },
    ...input,
  };
}

// --- Issue 12: a reply to Alex's own question is an opportunity ------------
//
// T-C2-043 seq 16-17. Alex asked an either/or question and the next human
// message answered it. The Observer pointed `replyToSeq` at the human's own
// earlier message, called the relation "unrelated" and left `addressees` empty,
// so no branch below minted anything and the turn was lost to
// `ledger_judge_failure`. Thirty messages later the identical pattern was read
// correctly — a reliability distribution over a fact that needs no model:
// Alex's message directly before this one was a question.
// `questionSeq` has no default on purpose: passing `undefined` to a defaulted
// parameter takes the default, which made the negative case silently positive.
const answeredAlexDelta = (over: Partial<ObservedTurnForLedger>, questionSeq: number | undefined) =>
  observerDeltaFromTurn({
    sessionKey: "T-C2-043-UPTAKE",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 17,
    contextThroughSeq: 17,
    alexQuestionAwaitingReplySeq: questionSeq,
    observation: observation({
      speechAct: "answer",
      alexRelation: "unrelated",
      relationToPendingAlexQuestion: "unrelated",
      activeThread: {
        threadId: "thread-1",
        rootSeq: 1,
        status: "open",
        goal: "compare_information",
        requestedAction: "discuss candidates",
        candidates: ["A", "D"],
        participants: [...roster],
        expectedResponders: ["humanY"],
        alexParticipation: "not_involved",
        evidenceSeqs: [17],
      },
      ...over,
    }),
  });
const answeredAlex = reduceConversationLedger(null, answeredAlexDelta({}, 16)).state;
assert.equal(
  answeredAlex.opportunities.length,
  1,
  "Alex asked, the next human message answered, and that is an opportunity without the Observer saying so",
);
assert.equal(answeredAlex.opportunities[0]!.kind, "uptake");
assert.equal(answeredAlex.opportunities[0]!.expectation, "invited");
assert.equal(
  answeredAlex.opportunities[0]!.originActor,
  "alex",
  "the obligation is rooted in Alex's own turn",
);
assert.equal(answeredAlex.opportunities[0]!.opportunitySourceSeq, 16);
assert.equal(answeredAlex.opportunities[0]!.status, "open");
// A reply aimed at another human mints nothing, even directly after an Alex
// question. The pair is "Alex asked" and "this answers it", not "Alex asked at
// some point".
assert.deepEqual(
  reduceConversationLedger(null, answeredAlexDelta({ addressees: ["humanX"] }, 16)).state.opportunities,
  [],
  "a reply addressed to another human is not a reply to Alex",
);
// And with no Alex question immediately before, nothing changes.
assert.deepEqual(
  reduceConversationLedger(null, answeredAlexDelta({}, undefined)).state.opportunities,
  [],
);

// --- Issue 13 (half): the answer to Alex's own question is reachable ---------
//
// T-C2-045 seq 16-17. Alex offered a choice; a participant answered it with an
// explicit request. Because the turn both answered Alex *and* asked for
// something, the request branch above minted an `invitation` — and an invitation
// gets no cooldown bypass, so on the one turn it was current it was filtered out
// of the Judge's view, and on every later turn the invited-not-current filter
// removed it. **It was never selectable on any turn.** Minted, unreachable,
// expired.
//
// The `uptake` bypass exists precisely so Alex can receive the answer to its own
// question. This turn missed it only because a stronger branch fired first.
const answersAlexRequest = reduceConversationLedger(
  null,
  observerDeltaFromTurn({
    sessionKey: "T-C2-045-ANSWERS-ALEX",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 17,
    contextThroughSeq: 17,
    alexQuestionAwaitingReplySeq: 16,
    observation: observation({
      speechAct: "proposal",
      addressees: ["alex"],
      requestExplicitness: "explicit",
      alexRelation: "explicit_addressee",
      activeThread: {
        threadId: "thread-1",
        rootSeq: 1,
        status: "open",
        goal: "compare_information",
        requestedAction: "discuss candidates",
        candidates: ["A", "B"],
        participants: [...roster],
        expectedResponders: ["alex"],
        alexParticipation: "invited",
        evidenceSeqs: [17],
      },
    }),
  }),
).state;
const answersAlexOpportunity = answersAlexRequest.opportunities[0]!;
assert.equal(answersAlexOpportunity.kind, "invitation", "the request branch still wins on kind");
assert.equal(
  answersAlexOpportunity.answersAlexSeq,
  16,
  "and the turn is also recorded as the answer to Alex's own question",
);
assert.equal(
  opportunityMayBypassCooldown(
    { ...answersAlexRequest, foregroundThreadId: "thread-1" },
    answersAlexOpportunity,
  ),
  true,
  "answering Alex's own question speaks through the cooldown, as an uptake would",
);
assert.deepEqual(
  conversationLedgerDecisionProjection(
    { ...answersAlexRequest, foregroundThreadId: "thread-1" },
    { cooldownAvailable: false },
  ).opportunities.map((item) => item.id),
  [answersAlexOpportunity.id],
  "so the Judge is actually offered it",
);
assert.equal(
  deterministicVetoBeforeJudge(
    { ...answersAlexRequest, foregroundThreadId: "thread-1" },
    { cooldownAvailable: false },
  ),
  null,
  "and the turn is no longer vetoed before the Judge runs",
);
// An ordinary invitation that answers nothing of Alex's still waits its turn.
const ordinaryInvitation = reduceConversationLedger(
  null,
  observerDeltaFromTurn({
    sessionKey: "T-C2-045-ORDINARY",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 17,
    contextThroughSeq: 17,
    observation: observation({
      speechAct: "proposal",
      addressees: ["alex"],
      requestExplicitness: "explicit",
      alexRelation: "explicit_addressee",
    }),
  }),
).state;
assert.equal(ordinaryInvitation.opportunities[0]!.answersAlexSeq, undefined);
assert.equal(
  opportunityMayBypassCooldown(ordinaryInvitation, ordinaryInvitation.opportunities[0]!),
  false,
  "the cooldown still governs every invitation that is not an answer to Alex",
);

const uptakeReplay = replayObservedConversation({
  sessionKey: "T-C4-UPTAKE-CLUSTER",
  observerVersion: "test-observer",
  roster: [...roster],
  turns: [7, 8].map((seq, index) => ({
    originalSeq: seq,
    replaySeq: seq,
    senderRole: index === 0 ? ("humanX" as const) : ("humanY" as const),
    observation: observation({
      speechAct: "answer",
      alexRelation: "response_to_alex",
      relationToPendingAlexQuestion: "direct_answer",
      activeThread: {
        threadId: "alex-question-1",
        rootSeq: 1,
        status: "open",
        goal: "answer_alex_question",
        requestedAction: "share views",
        candidates: [],
        participants: ["group"],
        expectedResponders: ["group"],
        alexParticipation: "invited",
        evidenceSeqs: [1, seq],
      },
    }),
  })),
});
const uptakeState = uptakeReplay.at(-1)!.stateAfter;
assert.equal(uptakeState.opportunities.length, 1, "answers to one Alex question share one uptake opportunity");
assert.equal(uptakeState.opportunities[0]!.id, "opp:1:uptake:alex");
assert.deepEqual(uptakeState.opportunities[0]!.evidenceSeqs, [7, 8]);
assert.equal(
  opportunityMayBypassCooldown(uptakeState, uptakeState.opportunities[0]!),
  true,
  "the current foreground uptake cluster may respond at the settled floor",
);
assert.equal(
  opportunityMayBypassCooldown(
    { ...uptakeState, currentTriggerSeq: 9 },
    uptakeState.opportunities[0]!,
  ),
  false,
  "stale uptake evidence cannot bypass cooldown",
);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "follow",
      selectedOpportunityId: uptakeState.opportunities[0]!.id,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [1, 7, 8],
    },
    state: { ...uptakeState, currentTriggerSeq: 9 },
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 7, 8, 9]),
    cooldownAvailable: true,
  }).ruleCodes.includes("selected_invited_opportunity_not_current"),
  "ordinary cooldown cannot make a stale invited opportunity selectable",
);

const nextAlexGenerationDelta = observerDeltaFromTurn({
  sessionKey: "T-C4-UPTAKE-GENERATIONS",
  observerVersion: "test-observer",
  roster,
  sourceRole: "humanX",
  currentTriggerSeq: 13,
  contextThroughSeq: 13,
  alexUptakeRootSeq: 12,
  observation: observation({
    speechAct: "answer",
    alexRelation: "response_to_alex",
    relationToPendingAlexQuestion: "related_addition",
    activeThread: {
      threadId: "alex-question-1",
      rootSeq: 1,
      status: "open",
      goal: "answer_alex_question",
      requestedAction: "share views",
      candidates: [],
      participants: ["group"],
      expectedResponders: ["group"],
      alexParticipation: "invited",
      evidenceSeqs: [1, 12, 13],
    },
  }),
});
assert.equal(
  nextAlexGenerationDelta.opportunityProposals[0]!.opportunitySourceSeq,
  12,
  "a later Alex turn starts a fresh uptake generation inside the same thread",
);
assert.equal(
  responseOpportunityId({
    opportunitySourceSeq: nextAlexGenerationDelta.opportunityProposals[0]!.opportunitySourceSeq,
    kind: "uptake",
    targets: ["alex"],
  }),
  "opp:12:uptake:alex",
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "follow",
      selectedOpportunityId: uptakeState.opportunities[0]!.id,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [1, 7, 8],
    },
    state: uptakeState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 7, 8]),
    cooldownAvailable: false,
  }).ok,
  true,
  "the validator permits the current settled uptake cluster without ordinary cooldown",
);

const replay = replayObservedConversation({
  sessionKey: "T-C2-026",
  observerVersion: "test-observer",
  roster: [...roster],
  turns: [
    {
      originalSeq: 4,
      replaySeq: 4,
      senderRole: "humanX",
      observation: observation({
        speechAct: "question",
        addressees: ["group"],
        activeCandidates: ["B", "C"],
        requestExplicitness: "explicit",
        alexRelation: "group_participant",
        activeThread: {
          threadId: "candidate-comparison",
          rootSeq: 1,
          status: "open",
          goal: "compare_information",
          requestedAction: "compare B and C",
          candidates: ["B", "C"],
          participants: ["group"],
          expectedResponders: ["group"],
          alexParticipation: "invited",
          evidenceSeqs: [1, 4],
        },
      }),
    },
    {
      originalSeq: 9,
      replaySeq: 9,
      senderRole: "humanY",
      observation: observation({
        speechAct: "question",
        addressees: ["group"],
        activeCandidates: ["A", "D"],
        requestExplicitness: "explicit",
        alexRelation: "group_participant",
        activeThread: {
          threadId: "candidate-comparison",
          rootSeq: 1,
          status: "open",
          goal: "compare_information",
          requestedAction: "now compare A and D",
          candidates: ["A", "D"],
          participants: ["group"],
          expectedResponders: ["group"],
          alexParticipation: "invited",
          evidenceSeqs: [1, 9],
        },
      }),
    },
  ],
});

assert.equal(replay.length, 2);
const finalState = replay.at(-1)!.stateAfter;
assert.equal(finalState.threads.length, 1, "one persistent QUD can span both requests");
assert.equal(finalState.threads[0]!.threadRootSeq, 1);
assert.equal(finalState.currentTriggerSeq, 9);
assert.equal(finalState.contextThroughSeq, 9);
assert.equal(finalState.opportunities.length, 2, "each human request gets exact identity");
assert.deepEqual(
  finalState.opportunities.map((item) => item.opportunitySourceSeq),
  [4, 9],
);
assert.notEqual(finalState.opportunities[0]!.id, finalState.opportunities[1]!.id);
assert.deepEqual(finalState.opportunities[0]!.targets, [...roster].sort());
assert.equal(finalState.opportunities.some((item) => item.targets.includes("humanZ")), false);

const collisionReplay = replayObservedConversation({
  sessionKey: "legacy-sequence-collision",
  observerVersion: "test-observer",
  roster: [...roster],
  turns: [
    {
      originalSeq: 21,
      replaySeq: 21,
      senderRole: "humanY",
      observation: observation(),
    },
    {
      originalSeq: 21,
      replaySeq: 22,
      senderRole: "humanX",
      observation: observation(),
    },
  ],
});
assert.deepEqual(
  collisionReplay.map((turn) => [turn.originalSeq, turn.replaySeq]),
  [
    [21, 21],
    [21, 22],
  ],
  "legacy original sequence collisions remain auditable while replay evidence is unique",
);
assert.equal(collisionReplay.at(-1)!.stateAfter.currentTriggerSeq, 22);

const secondId = responseOpportunityId({
  opportunitySourceSeq: 9,
  kind: "group_request",
  targets: [...roster],
});
const rejectedConsume = withOpportunityTransition(finalState, {
  opportunityId: secondId,
  toStatus: "consumed_by_alex",
  reason: "test",
  evidenceSeqs: [9],
  handledThroughSeq: 9,
  broadcastSucceeded: false,
});
assert.equal(
  rejectedConsume.state.opportunities.find((item) => item.id === secondId)!.status,
  "open",
);
assert.ok(
  rejectedConsume.transition.rejected.includes(`transition:${secondId}:consume_without_broadcast`),
);

const consumed = withOpportunityTransition(finalState, {
  opportunityId: secondId,
  toStatus: "consumed_by_alex",
  reason: "successful_broadcast",
  evidenceSeqs: [9],
  handledThroughSeq: 9,
  alexBroadcastSeq: 10,
  broadcastSucceeded: true,
});
assert.equal(
  consumed.state.opportunities.find((item) => item.id === secondId)!.status,
  "consumed_by_alex",
);
assert.equal(
  consumed.state.opportunities.find((item) => item.id === secondId)!.alexBroadcastSeq,
  10,
);

const cannotReopen = withOpportunityTransition(consumed.state, {
  opportunityId: secondId,
  toStatus: "open",
  reason: "late_correction",
  evidenceSeqs: [9],
});
assert.ok(
  cannotReopen.transition.rejected.includes(`transition:${secondId}:already_terminal`),
);
const cannotConsumeTwice = withOpportunityTransition(consumed.state, {
  opportunityId: secondId,
  toStatus: "consumed_by_alex",
  reason: "duplicate_broadcast_attempt",
  evidenceSeqs: [9],
  alexBroadcastSeq: 11,
  broadcastSucceeded: true,
});
assert.ok(
  cannotConsumeTwice.transition.rejected.includes(`transition:${secondId}:already_terminal`),
);
const invalidated = withOpportunityTransition(consumed.state, {
  opportunityId: secondId,
  toStatus: "consumed_by_alex",
  reason: "late_correction",
  evidenceSeqs: [9],
  invalidateConsumedInterpretation: true,
});
assert.equal(
  invalidated.state.opportunities.find((item) => item.id === secondId)!
    .invalidatedAfterConsumption,
  true,
);

const standingOpportunity = observerDeltaFromTurn({
  sessionKey: "T-C2-026",
  observerVersion: "test-observer",
  roster,
  sourceRole: "humanX",
  currentTriggerSeq: 12,
  contextThroughSeq: 12,
  observation: observation({
    speechAct: "answer",
    addressees: ["humanY"],
    alexRelation: "unrelated",
    activeThread: {
      threadId: "candidate-comparison",
      rootSeq: 1,
      status: "open",
      goal: "compare_information",
      requestedAction: "compare all candidates",
      candidates: ["A", "B", "C", "D"],
      participants: ["group"],
      expectedResponders: ["group"],
      alexParticipation: "required",
      evidenceSeqs: [1, 12],
    },
  }),
});
assert.equal(
  standingOpportunity.opportunityProposals.length,
  1,
  "an unserved persistent thread participation requirement creates a stable opportunity",
);
assert.deepEqual(
  standingOpportunity.opportunityProposals[0] && {
    originActor: standingOpportunity.opportunityProposals[0].originActor,
    originSeq: standingOpportunity.opportunityProposals[0].originSeq,
    openedAtSeq: standingOpportunity.opportunityProposals[0].openedAtSeq,
  },
  { originActor: "alex", originSeq: 1, openedAtSeq: 12 },
);
const standingReduced = reduceConversationLedger(finalState, standingOpportunity);
const standingId = responseOpportunityId({
  opportunitySourceSeq: 1,
  kind: "group_request",
  targets: ["alex"],
});
assert.equal(
  standingReduced.state.opportunities.filter((item) => item.id === standingId).length,
  1,
  "standing opportunity identity is unique per thread origin",
);
const requiredStandingSelection = validateConversationLedgerJudgeDecision({
  decision: {
    decision: "speak",
    act: "participate",
    selectedOpportunityId: standingId,
    evidence: "selected_open_opportunity",
    selectedTraitId: null,
    evidenceSeqs: [1, 12],
  },
  state: standingReduced.state,
  eligibleTraitIds: [],
  transcriptSeqs: new Set([1, 4, 9, 12]),
});
assert.equal(requiredStandingSelection.ok, true);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "silent",
      act: null,
      selectedOpportunityId: null,
      evidence: "no_useful_move",
      selectedTraitId: null,
      evidenceSeqs: [12],
    },
    state: standingReduced.state,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9, 12]),
  }).ruleCodes.includes("current_required_opportunity_not_selected"),
);
const standingConsumed = withOpportunityTransition(standingReduced.state, {
  opportunityId: standingId,
  toStatus: "consumed_by_alex",
  reason: "successful_broadcast",
  evidenceSeqs: [12],
  handledThroughSeq: 12,
  alexBroadcastSeq: 13,
  broadcastSucceeded: true,
});
assert.equal(
  standingConsumed.state.opportunities.find((item) => item.id === standingId)?.status,
  "consumed_by_alex",
);

const invalidTargetDelta = {
  ...standingOpportunity,
  currentTriggerSeq: 13,
  contextThroughSeq: 13,
  opportunityProposals: [
    {
      threadId: "candidate-comparison",
      kind: "group_request" as const,
      expectation: "invited" as const,
      sourceRole: "humanX" as const,
      opportunitySourceSeq: 13,
      targets: ["alex", "humanZ"] as any,
      targetBasis: "group_expanded" as const,
      evidenceSeqs: [13],
    },
  ],
  floorProposal: {
    holder: "open" as const,
    expectedNext: [],
    transition: "available" as const,
    evidenceSeqs: [13],
  },
};
const invalidTarget = reduceConversationLedger(finalState, invalidTargetDelta);
assert.equal(invalidTarget.state.opportunities.length, 2);
assert.ok(
  invalidTarget.transition.rejected.includes("opportunity:13:group_request:invalid"),
);
assert.equal(invalidTarget.state.ledgerVersion, CONVERSATION_LEDGER_VERSION);

const validJudgeSelection = validateConversationLedgerJudgeDecision({
  decision: {
    decision: "speak",
    act: "participate",
    selectedOpportunityId: secondId,
    evidence: "selected_open_opportunity",
    selectedTraitId: null,
    evidenceSeqs: [9],
  },
  state: finalState,
  eligibleTraitIds: [],
  transcriptSeqs: new Set([1, 4, 9]),
});
assert.equal(validJudgeSelection.value?.selectedOpportunityId, secondId);
assert.equal(validJudgeSelection.ok, true);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: secondId,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [9],
    },
    state: finalState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9]),
    cooldownAvailable: false,
  }).ruleCodes.includes("selected_opportunity_requires_cooldown"),
  "an invited group request cannot bypass ordinary cooldown merely because it was selected",
);
const directAfterOlderOpen = withProvisionalAlexAddress(finalState, {
  sourceRole: "humanX",
  currentTriggerSeq: 14,
  content: "Alex, answer the question I just asked.",
}).state;
const staleOpportunityId = directAfterOlderOpen.opportunities.find(
  (opportunity) => opportunity.opportunitySourceSeq !== 14,
)!.id;
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: staleOpportunityId,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [4],
    },
    state: directAfterOlderOpen,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9, 14]),
  }).ok,
  false,
  "a current required opportunity must outrank a stale open opportunity",
);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: null,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [9],
    },
    state: finalState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9]),
  }).ruleCodes.includes("interaction_act_missing_opportunity"),
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: null,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [9],
    },
    state: finalState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9]),
  }).ok,
  false,
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: secondId,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [9],
    },
    state: consumed.state,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9]),
  }).ok,
  false,
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "contribute",
      selectedOpportunityId: null,
      evidence: "no_useful_move",
      selectedTraitId: null,
      evidenceSeqs: [9],
    },
    state: finalState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9]),
  }).ok,
  false,
  "speech without an opportunity or useful voluntary-act basis is forbidden",
);

// --- Gate 1 regressions -----------------------------------------------------
// Reproduces the three defects observed in session T-C2-034. Shapes are taken
// from that run's stored observations; no participant text is reproduced.

// Gate 1 / C3. The observer marked Alex the explicit addressee of a request
// while returning an empty `addressees` array. Dispatching on `addressees`
// alone routed the request into the inferred thread-continuation branch, where
// it merged into an already-consumed id and was never answered.
const explicitRelationOnlyThread = {
  threadId: "thread-1",
  rootSeq: 1,
  status: "open" as const,
  goal: "compare_information",
  requestedAction: "discuss candidates",
  candidates: ["A", "B", "C", "D"] as const,
  participants: ["alex", "humanX", "humanY"] as const,
  expectedResponders: ["humanX"] as const,
  alexParticipation: "invited" as const,
  evidenceSeqs: [1, 16],
};
const explicitRelationOnly = observerDeltaFromTurn({
  sessionKey: "T-C2-034",
  observerVersion: "test-observer",
  roster,
  sourceRole: "humanY",
  currentTriggerSeq: 16,
  contextThroughSeq: 16,
  alexUptakeRootSeq: 15,
  observation: observation({
    speechAct: "proposal",
    addressees: [],
    alexRelation: "explicit_addressee",
    requestExplicitness: "explicit",
    activeCandidates: ["B", "C"],
    activeThread: {
      ...explicitRelationOnlyThread,
      candidates: [...explicitRelationOnlyThread.candidates],
      participants: [...explicitRelationOnlyThread.participants],
      expectedResponders: [...explicitRelationOnlyThread.expectedResponders],
    },
  }),
});
assert.equal(
  explicitRelationOnly.opportunityProposals.length,
  1,
  "an explicit request still opens an opportunity when addressees is empty",
);
assert.deepEqual(
  explicitRelationOnly.opportunityProposals[0] && {
    kind: explicitRelationOnly.opportunityProposals[0].kind,
    expectation: explicitRelationOnly.opportunityProposals[0].expectation,
    opportunitySourceSeq: explicitRelationOnly.opportunityProposals[0].opportunitySourceSeq,
    openedAtSeq: explicitRelationOnly.opportunityProposals[0].openedAtSeq,
    targetBasis: explicitRelationOnly.opportunityProposals[0].targetBasis,
  },
  {
    kind: "invitation",
    expectation: "invited",
    opportunitySourceSeq: 16,
    openedAtSeq: 16,
    targetBasis: "explicit",
  },
  "the request is keyed to the current trigger, not folded into the thread root",
);
assert.ok(
  explicitRelationOnly.repairCodes.includes("alex_addressee_taken_from_explicit_relation"),
  "resolving the addressee/relation disagreement is auditable",
);

// The same turn without an explicit Alex relation must stay in the inferred
// continuation branch, so the repair cannot silently widen Alex's entitlement.
const groupParticipantSameTurn = observerDeltaFromTurn({
  sessionKey: "T-C2-034",
  observerVersion: "test-observer",
  roster,
  sourceRole: "humanY",
  currentTriggerSeq: 16,
  contextThroughSeq: 16,
  observation: observation({
    speechAct: "proposal",
    addressees: [],
    alexRelation: "group_participant",
    activeThread: {
      ...explicitRelationOnlyThread,
      candidates: [...explicitRelationOnlyThread.candidates],
      participants: [...explicitRelationOnlyThread.participants],
      expectedResponders: [...explicitRelationOnlyThread.expectedResponders],
    },
  }),
});
assert.equal(
  groupParticipantSameTurn.opportunityProposals[0]?.opportunitySourceSeq,
  1,
  "a turn that does not address Alex keeps the inferred thread-root behaviour",
);
assert.equal(
  groupParticipantSameTurn.repairCodes.includes("alex_addressee_taken_from_explicit_relation"),
  false,
  "the addressee repair is recorded only when it actually changed the dispatch",
);

// Gate 1 / C2. A consumed opportunity must not keep absorbing evidence. In
// T-C2-034 `opp:1:group_request:alex` was consumed on the first Alex broadcast
// and then merged evidence from eight later turns, hiding the closure from the
// observer, which is shown only open opportunities.
const terminalMergeBase = reduceConversationLedger(
  createConversationLedgerState({
    sessionKey: "T-C2-TERMINAL-MERGE",
    observerVersion: "test-observer",
    roster,
  }),
  observerDeltaFromTurn({
    sessionKey: "T-C2-TERMINAL-MERGE",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 2,
    contextThroughSeq: 2,
    observation: observation({
      speechAct: "answer",
      addressees: [],
      alexRelation: "group_participant",
      activeThread: {
        threadId: "thread-1",
        rootSeq: 1,
        status: "open",
        goal: "compare_information",
        requestedAction: "discuss candidates",
        candidates: [],
        participants: ["alex", "humanX", "humanY"],
        expectedResponders: [],
        alexParticipation: "invited",
        evidenceSeqs: [2],
      },
    }),
  }),
).state;
const terminalMergeId = terminalMergeBase.opportunities[0]!.id;
assert.equal(terminalMergeBase.opportunities[0]!.status, "open");
const terminalMergeConsumed = withOpportunityTransition(terminalMergeBase, {
  opportunityId: terminalMergeId,
  toStatus: "consumed_by_alex",
  reason: "alex_broadcast_succeeded",
  broadcastSucceeded: true,
  evidenceSeqs: [2],
  alexBroadcastSeq: 3,
}).state;
assert.equal(terminalMergeConsumed.opportunities[0]!.status, "consumed_by_alex");
const consumedEvidenceBefore = [...terminalMergeConsumed.opportunities[0]!.evidenceSeqs];
const terminalMergeAttempt = reduceConversationLedger(
  { ...terminalMergeConsumed, contextThroughSeq: 4, currentTriggerSeq: 4 },
  observerDeltaFromTurn({
    sessionKey: "T-C2-TERMINAL-MERGE",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 4,
    contextThroughSeq: 4,
    observation: observation({
      speechAct: "answer",
      addressees: [],
      alexRelation: "group_participant",
      activeThread: {
        threadId: "thread-1",
        rootSeq: 1,
        status: "open",
        goal: "compare_information",
        requestedAction: "discuss candidates",
        candidates: [],
        participants: ["alex", "humanX", "humanY"],
        expectedResponders: [],
        alexParticipation: "invited",
        evidenceSeqs: [4],
      },
    }),
  }),
);
assert.ok(
  terminalMergeAttempt.transition.rejected.includes(`opportunity:${terminalMergeId}:already_terminal`),
  "evidence cannot be merged into a consumed opportunity",
);
assert.deepEqual(
  terminalMergeAttempt.state.opportunities.find((item) => item.id === terminalMergeId)!.evidenceSeqs,
  consumedEvidenceBefore,
  "a consumed opportunity's evidence set stops growing once it is closed",
);
assert.equal(
  terminalMergeAttempt.state.opportunities.filter((item) => item.id === terminalMergeId).length,
  1,
  "rejecting the merge does not duplicate or resurrect the closed opportunity",
);

// Gate 1 / C4. The Judge prompt serialized the whole ledger, so terminal ids
// stayed visible even though the prose summary listed only open ones. The model
// selected a consumed id, deterministic validation rejected it, and the retry
// capitulated to silence. The decision projection must expose exactly what is
// selectable.
const projectionState = {
  ...terminalMergeConsumed,
  currentTriggerSeq: 20,
  contextThroughSeq: 20,
  opportunities: [
    terminalMergeConsumed.opportunities[0]!,
    {
      ...terminalMergeConsumed.opportunities[0]!,
      id: "opp:18:direct_question:alex",
      kind: "direct_question" as const,
      expectation: "required" as const,
      status: "open" as const,
      opportunitySourceSeq: 18,
      originSeq: 18,
      openedAtSeq: 18,
      evidenceSeqs: [18],
    },
    {
      ...terminalMergeConsumed.opportunities[0]!,
      id: "opp:19:uptake:alex",
      kind: "uptake" as const,
      expectation: "invited" as const,
      status: "open" as const,
      opportunitySourceSeq: 19,
      originSeq: 19,
      openedAtSeq: 20,
      evidenceSeqs: [19],
    },
    {
      ...terminalMergeConsumed.opportunities[0]!,
      id: "opp:20:uptake:alex",
      kind: "uptake" as const,
      expectation: "invited" as const,
      status: "open" as const,
      opportunitySourceSeq: 20,
      originSeq: 20,
      openedAtSeq: 20,
      evidenceSeqs: [20],
    },
  ],
};
assert.deepEqual(
  conversationLedgerDecisionProjection(projectionState).opportunities.map((item) => item.id),
  ["opp:18:direct_question:alex", "opp:20:uptake:alex"],
  "the projection drops terminal ids and stale invited ids, and keeps current ones",
);
assert.equal(
  conversationLedgerDecisionProjection(projectionState).opportunities.some(
    (item) => item.status === "consumed_by_alex",
  ),
  false,
  "a consumed opportunity is never offered to the Judge as a choice",
);

// --- Gate 2 regressions -----------------------------------------------------

// Gate 2 / degraded mode. The reducer treated every rejection as evidence that
// the ledger could not be trusted, and degraded mode forbids inferred speech.
// In T-C2-034 the only degraded turn (13) was produced by a single idempotent
// no-op: the observer proposed closing an opportunity that was already closed.
// The observer is shown only open opportunities, so it re-proposes finished
// ones as a matter of course; that must not silence a turn.
const redundantRejectionBase = withOpportunityTransition(terminalMergeBase, {
  opportunityId: terminalMergeId,
  toStatus: "consumed_by_alex",
  reason: "alex_broadcast_succeeded",
  broadcastSucceeded: true,
  evidenceSeqs: [2],
  alexBroadcastSeq: 3,
}).state;
const reclosedAlreadyTerminal = withOpportunityTransition(
  { ...redundantRejectionBase, contextThroughSeq: 5, currentTriggerSeq: 5 },
  {
    opportunityId: terminalMergeId,
    toStatus: "resolved_by_human",
    reason: "observer re-proposed a closure that already happened",
    evidenceSeqs: [5],
  },
);
assert.ok(
  reclosedAlreadyTerminal.transition.rejected.some((code) =>
    code.endsWith(":already_terminal"),
  ),
  "re-closing a closed opportunity is still rejected",
);
assert.equal(
  reclosedAlreadyTerminal.state.degradedMode,
  false,
  "an idempotent no-op rejection must not put the controller into degraded mode",
);
assert.deepEqual(
  reclosedAlreadyTerminal.state.conflictCodes,
  [],
  "a redundant rejection is not a state conflict",
);

// A materially invalid proposal must still degrade. Evidence pointing past the
// observed context is a real inconsistency, not a no-op.
const materialConflict = reduceConversationLedger(redundantRejectionBase, {
  ledgerVersion: CONVERSATION_LEDGER_VERSION,
  observerVersion: "test-observer",
  sessionKey: "T-C2-TERMINAL-MERGE",
  roster: [...roster],
  sourceRole: "humanY",
  currentTriggerSeq: 6,
  contextThroughSeq: 6,
  foregroundThreadId: "thread-1",
  threadProposals: [],
  opportunityProposals: [],
  opportunityTransitions: [],
  floorProposal: {
    holder: "open",
    expectedNext: [],
    transition: "available",
    evidenceSeqs: [99],
  },
  observerConflicts: [],
  repairCodes: [],
  conflictCodes: [],
  degradedMode: false,
});
assert.ok(
  materialConflict.transition.rejected.includes("floor:invalid"),
  "evidence outside the observed context is rejected",
);
assert.equal(
  materialConflict.state.degradedMode,
  true,
  "a material rejection still degrades the controller",
);

// Gate 2 / capitulation. A silence that follows a rejected request to speak is
// a different event from a Judge that never wanted the floor, but both report
// evidence "no_useful_move". T-C2-034 turns 22, 25 and 26 all took the first
// shape and were recorded as the second.
const capitulationAttempts: ConversationLedgerJudgeCallAttempt[] = [
  {
    attempt: 1,
    status: "validation_failed",
    model: "test-judge",
    latencyMs: 1,
    parsedOutput: {
      decision: "speak",
      act: "follow",
      selectedOpportunityId: "opp:19:uptake:alex",
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [20],
    },
    ruleCodes: ["selected_opportunity_not_open_for_alex", "selected_invited_opportunity_not_current"],
  },
  { attempt: 2, status: "accepted", model: "test-judge", latencyMs: 1 },
];
const capitulatedSilence = {
  decision: "silent" as const,
  act: null,
  selectedOpportunityId: null,
  evidence: "no_useful_move" as const,
  selectedTraitId: null,
  evidenceSeqs: [] as number[],
};
assert.equal(
  judgeCapitulatedToSilence(capitulatedSilence, capitulationAttempts),
  true,
  "silence after a rejected request to speak is a capitulation",
);
assert.deepEqual(
  judgeCapitulationRuleCodes(capitulationAttempts),
  ["selected_invited_opportunity_not_current", "selected_opportunity_not_open_for_alex"],
  "the rules the Judge backed away from are carried into the silence audit",
);
assert.equal(
  judgeCapitulatedToSilence(capitulatedSilence, [
    { attempt: 1, status: "accepted", model: "test-judge", latencyMs: 1 },
  ]),
  false,
  "a first-attempt silence is a genuine judgement, not a capitulation",
);
assert.equal(
  judgeCapitulatedToSilence(
    {
      decision: "speak" as const,
      act: "contribute" as const,
      selectedOpportunityId: null,
      evidence: "relevant_unsurfaced_information" as const,
      selectedTraitId: "A_p1",
      evidenceSeqs: [20],
    },
    capitulationAttempts,
  ),
  false,
  "a retry that recovers a valid speak is not a capitulation",
);
assert.equal(
  judgeCapitulatedToSilence(capitulatedSilence, [
    {
      attempt: 1,
      status: "validation_failed",
      model: "test-judge",
      latencyMs: 1,
      parsedOutput: {
        decision: "silent" as const,
        act: null,
        selectedOpportunityId: "opp:19:uptake:alex",
        evidence: "no_useful_move" as const,
        selectedTraitId: null,
        evidenceSeqs: [] as number[],
      },
      ruleCodes: ["non_speak_has_opportunity"],
    },
    { attempt: 2, status: "accepted", model: "test-judge", latencyMs: 1 },
  ]),
  false,
  "a malformed silence corrected into a clean silence is not a capitulation",
);

// --- Gate 3b: focus ranks trait eligibility, it never gates it ---------------
//
// T-C2-035 turns 21-24: the foreground thread had no focus candidate, the old
// helper therefore offered the Judge zero traits, every voluntary act became
// invalid, and the Judge capitulated to silence four turns in a row.
const gate3Thread: ConversationLedgerState["threads"][number] = {
  id: "thread-1",
  threadRootSeq: 1,
  status: "open",
  goal: "compare_information",
  requestedAction: "discuss candidates",
  candidates: ["A", "B", "C", "D"],
  scopeCandidates: ["A", "B", "C", "D"],
  focusCandidate: null,
  focusBasis: "none",
  participants: ["alex", "humanX", "humanY"],
  evidenceSeqs: [1],
  revision: 1,
};
const gate3State: ConversationLedgerState = {
  ...createConversationLedgerState({
    sessionKey: "T-GATE3",
    observerVersion: "test-observer",
    roster,
  }),
  currentTriggerSeq: 21,
  contextThroughSeq: 21,
  foregroundThreadId: "thread-1",
  threads: [gate3Thread],
};
const nothingSurfaced = new Set<string>();
const unfocusedEligible = eligibleTraitIdsForLedgerState(gate3State, nothingSurfaced);
assert.equal(
  unfocusedEligible.length,
  24,
  "a thread with no focus offers its whole scope, not nothing",
);
const focusedState: ConversationLedgerState = {
  ...gate3State,
  threads: [{ ...gate3Thread, focusCandidate: "C", focusBasis: "current_explicit" }],
};
const focusedEligible = eligibleTraitIdsForLedgerState(focusedState, nothingSurfaced);
assert.equal(focusedEligible.length, 24, "focus reorders eligibility, it does not shrink it");
assert.ok(
  focusedEligible.slice(0, 6).every((id) => id.startsWith("C_")),
  "the focus candidate's traits rank first",
);
assert.ok(
  focusedEligible.slice(6).some((id) => id.startsWith("B_")),
  "off-focus traits stay selectable behind the focused ones",
);
assert.equal(
  eligibleTraitIdsForLedgerState(focusedState, new Set(["C_p1", "A_p1"])).length,
  22,
  "already surfaced traits are excluded regardless of focus",
);
assert.deepEqual(
  eligibleTraitIdsForLedgerState(
    { ...gate3State, threads: [{ ...gate3Thread, status: "resolved" }] },
    nothingSurfaced,
  ),
  [],
  "a thread that is no longer live offers nothing",
);
assert.deepEqual(
  eligibleTraitIdsForLedgerState({ ...gate3State, threads: [] }, nothingSurfaced),
  [],
  "a missing foreground thread offers nothing",
);

// --- Gate 3c: following the humans no longer requires an opportunity ---------
//
// `follow` was classed as an interaction act, so it needed an opportunity id,
// and the only kind that produces one (`uptake`) is minted only after a human
// replies to Alex. While the humans talked to each other, taking up their point
// was structurally illegal — the exact decision the Judge tried and lost on
// turns 18, 21, 22, 23 and 24.
const gate3cTranscript = new Set([1, 20, 21]);
const voluntaryFollow = validateConversationLedgerJudgeDecision({
  decision: {
    decision: "speak",
    act: "follow",
    selectedOpportunityId: null,
    evidence: "conversation_grounded_synthesis",
    selectedTraitId: null,
    evidenceSeqs: [20, 21],
  },
  state: gate3State,
  eligibleTraitIds: [],
  transcriptSeqs: gate3cTranscript,
  cooldownAvailable: true,
});
assert.deepEqual(
  voluntaryFollow.ruleCodes,
  [],
  "a grounded voluntary follow is valid with no opportunity open",
);
assert.equal(voluntaryFollow.ok, true);
assert.deepEqual(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "follow",
      selectedOpportunityId: null,
      evidence: "social_uptake",
      selectedTraitId: null,
      evidenceSeqs: [21],
    },
    state: gate3State,
    eligibleTraitIds: [],
    transcriptSeqs: gate3cTranscript,
    cooldownAvailable: true,
  }).ruleCodes,
  ["voluntary_act_evidence_invalid"],
  "a voluntary follow still has to be grounded in what was just said",
);
// The turns-18-to-24 output verbatim: an interaction act with no opportunity.
// `participate` is a reply to a request, so it must still name the request.
assert.deepEqual(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: null,
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [21],
    },
    state: gate3State,
    eligibleTraitIds: [],
    transcriptSeqs: gate3cTranscript,
    cooldownAvailable: true,
  }).ruleCodes,
  ["interaction_act_missing_opportunity", "voluntary_act_evidence_invalid"],
  "answering or participating without a request on record is still invalid",
);

// --- Gate 3d: candidate salience ranks eligibility when focus is null -------
//
// T-C2-037 turns 5-9. The humans eliminated Candidate C at seq 5 and carried
// that point through seq 7 and 8 without naming anyone again. Every one of
// those turns reached the Judge with `focusCandidate: null`, so the eligible
// list arrived in trait-id order, the Judge read from the top, and Alex
// broadcast a Candidate A note into a Candidate C discussion. Salience is the
// state that was missing: it survives the turns where focus cannot be
// expressed.
const salienceTurns: Array<{ seq: number; mentioned: Candidate[] }> = [
  { seq: 5, mentioned: ["C"] },
  { seq: 7, mentioned: [] },
  { seq: 8, mentioned: [] },
];
let salienceState: ConversationLedgerState | null = null;
for (const turn of salienceTurns) {
  salienceState = reduceConversationLedger(
    salienceState,
    observerDeltaFromTurn({
      sessionKey: "T-C2-037-SALIENCE",
      observerVersion: "test-observer",
      roster,
      sourceRole: "humanY",
      currentTriggerSeq: turn.seq,
      contextThroughSeq: turn.seq,
      observation: observation({
        speechAct: "answer",
        mentionedCandidates: turn.mentioned,
        scopeCandidates: ["A", "B", "C", "D"],
        focusCandidate: null,
        focusBasis: "none",
        activeThread: {
          threadId: "thread-1",
          rootSeq: 1,
          status: "open",
          goal: "compare_information",
          requestedAction: "discuss candidates",
          candidates: ["A", "B", "C", "D"],
          participants: [...roster],
          expectedResponders: ["humanX", "humanY"],
          alexParticipation: "invited",
          evidenceSeqs: [turn.seq],
        },
      }),
    }),
  ).state;
}
const salienceThread = salienceState!.threads.find((thread) => thread.id === "thread-1")!;
assert.equal(
  salienceThread.candidateSalience?.C,
  5,
  "a literal mention records the seq it happened on",
);
assert.equal(
  salienceThread.focusCandidate,
  null,
  "the observer's focus is still null on these turns",
);
assert.deepEqual(
  candidateSalienceOrder(salienceThread).slice(0, 1),
  ["C"],
  "a turn that names nobody must not erase what the group was already on",
);
const salienceEligible = eligibleTraitIdsForLedgerState(
  { ...salienceState!, foregroundThreadId: "thread-1" },
  new Set<string>(),
);
assert.ok(
  salienceEligible[0]?.startsWith("C_"),
  "the most recently discussed candidate ranks first when focus is null",
);
assert.equal(
  salienceEligible.length,
  24,
  "salience reorders eligibility, it does not shrink it",
);
assert.deepEqual(
  candidateSalienceOrder({ ...salienceThread, focusCandidate: "D", focusBasis: "current_explicit" }).slice(0, 1),
  ["D"],
  "an explicit focus still outranks recency",
);
// --- T-C2-039 seq 10: a carried focus does not outrank a name -----------------
//
// Focus is a hint, and it is a hint of two quite different qualities. On a
// "current_explicit" basis the speaker named that candidate on this turn, and
// the observer's reading of which one the turn is about is worth more than
// recency. On a "carried_thread" basis it is an inference about an announcement
// several turns back, and it was beating the candidate a participant had just
// named. Salience ranks in that case; the observer's guess does not get to
// overrule the transcript.
assert.deepEqual(
  candidateSalienceOrder({ ...salienceThread, focusCandidate: "D", focusBasis: "carried_thread" }).slice(0, 1),
  ["C"],
  "a focus carried from an earlier thread does not outrank the candidate just named",
);
assert.deepEqual(
  candidateSalienceOrder({ ...salienceThread, focusCandidate: "D", focusBasis: "multiple_explicit" }).slice(0, 1),
  ["C"],
  "a focus the turn could not decide does not outrank the candidate just named",
);
assert.deepEqual(
  candidateSalienceOrder({ ...salienceThread, focusCandidate: "D", focusBasis: "none" }).slice(0, 1),
  ["C"],
);
// --- T-C1-022 seq 10: a thread's requested action is revisable ---------------
//
// The ledger already takes a new `requestedAction` from every turn's proposal;
// what T-C1-022 showed is that the Observer kept describing the thread's opening
// purpose, and generation received that description as an instruction. The field
// stays in the ledger and in the audit — it just stops instructing. What must
// hold either way is that revising it changes nothing else: the thread's id is
// what opportunity keying depends on.
const revisedActionState = reduceConversationLedger(
  salienceState,
  observerDeltaFromTurn({
    sessionKey: "T-C2-037-SALIENCE",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 9,
    contextThroughSeq: 9,
    observation: observation({
      speechAct: "answer",
      mentionedCandidates: [],
      scopeCandidates: ["A", "B", "C", "D"],
      focusCandidate: null,
      focusBasis: "none",
      activeThread: {
        threadId: "thread-1",
        rootSeq: 1,
        status: "open",
        goal: "compare_information",
        requestedAction: "settle between the last two candidates",
        candidates: ["A", "B", "C", "D"],
        participants: [...roster],
        expectedResponders: ["humanX", "humanY"],
        alexParticipation: "invited",
        evidenceSeqs: [9],
      },
    }),
  }),
).state;
// And the description does not reach generation. `describeConversationLedger` is
// what the `ledger_active` path passes as `conversationSituation`, so leaving the
// requested action in this prose would have left the T-C1-022 seq 10 shape in
// place on the path that actually runs. The Judge loses nothing: its prompt
// serializes the whole decision ledger beside this paragraph.
const ledgerSituation = describeConversationLedger({
  ...revisedActionState,
  foregroundThreadId: "thread-1",
});
assert.doesNotMatch(
  ledgerSituation,
  /settle between the last two candidates/,
  "a thread's requested action is not an instruction to the generator",
);
assert.match(ledgerSituation, /Its goal is compare_information\./);

const revisedThread = revisedActionState.threads.find((thread) => thread.id === "thread-1")!;
assert.equal(revisedThread.requestedAction, "settle between the last two candidates");
assert.equal(revisedThread.id, "thread-1", "thread identity is stable across a revision");
assert.equal(revisedThread.threadRootSeq, salienceThread.threadRootSeq);
assert.equal(revisedActionState.threads.length, salienceState!.threads.length);

// A comparison names two candidates, produces no focus, and still ranks.
assert.deepEqual(
  candidateSalienceOrder({
    ...salienceThread,
    focusCandidate: null,
    focusBasis: "none",
    candidateSalience: { A: 3, B: 9, C: 5 },
  }),
  ["B", "C", "A", "D"],
  "a comparison turn has no focus to consult and ranks by recency alone",
);

// --- Gate 3e: an option the validator will reject is not offered ------------
//
// T-C2-037 turn 2. The only listed opportunity was invited, Alex had spoken on
// the previous message, and `selected_opportunity_requires_cooldown` therefore
// rejected it on both attempts — the turn produced no decision at all. Terminal
// and stale-invited opportunities were already filtered for exactly this
// reason; cooldown is the third class.
const cooldownBlockedState: ConversationLedgerState = {
  ...gate3State,
  currentTriggerSeq: 2,
  contextThroughSeq: 2,
  opportunities: [
    {
      id: "opp:1:group_request:alex",
      threadId: "thread-1",
      kind: "group_request",
      expectation: "invited",
      sourceRole: "humanY",
      opportunitySourceSeq: 1,
      originActor: "alex",
      originSeq: 1,
      openedAtSeq: 2,
      targets: ["alex"],
      targetBasis: "inferred",
      evidenceSeqs: [1, 2],
      status: "open",
      revision: 1,
    },
  ],
};
assert.equal(
  conversationLedgerDecisionProjection(cooldownBlockedState, { cooldownAvailable: true })
    .opportunities.length,
  1,
  "with cooldown available the invited opportunity is a real choice",
);
assert.equal(
  conversationLedgerDecisionProjection(cooldownBlockedState, { cooldownAvailable: false })
    .opportunities.length,
  0,
  "an opportunity cooldown forbids is context, not a choice",
);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: "opp:1:group_request:alex",
      evidence: "selected_open_opportunity",
      selectedTraitId: null,
      evidenceSeqs: [2],
    },
    state: cooldownBlockedState,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 2]),
    cooldownAvailable: false,
  }).ruleCodes.includes("selected_opportunity_requires_cooldown"),
  "the rule that made it unselectable is still enforced",
);

// --- Gate 3f: an inert field is repaired, not punished with silence ---------
//
// T-C2-037 turns 18, 19, 25 and 26 are one shape four times: the Judge asked to
// follow the humans with a grounded synthesis and also filled selectedTraitId,
// which reaches generation only through build_on + relevant_unsurfaced_information
// and is inert here. Validation rejected the whole decision, and the retry took
// the one output that always validates.
const strayTrait = canonicalizeConversationLedgerJudgeDecision({
  decision: "speak",
  act: "follow",
  selectedOpportunityId: null,
  evidence: "conversation_grounded_synthesis",
  selectedTraitId: "A_p2",
  evidenceSeqs: [18],
});
assert.equal(strayTrait.decision.selectedTraitId, null, "the inert field is cleared");
assert.equal(strayTrait.decision.act, "follow", "the decision itself is untouched");
assert.deepEqual(
  strayTrait.repairCodes,
  ["trait_cleared_for_non_trait_evidence"],
  "the repair is recorded rather than silently applied",
);
assert.deepEqual(
  validateConversationLedgerJudgeDecision({
    decision: strayTrait.decision,
    state: gate3State,
    eligibleTraitIds: ["A_p2"],
    transcriptSeqs: new Set([18, 21]),
    cooldownAvailable: true,
  }).ruleCodes,
  [],
  "the repaired decision validates instead of forcing a retry",
);
const carriedTrait = canonicalizeConversationLedgerJudgeDecision({
  decision: "speak",
  act: "contribute",
  selectedOpportunityId: null,
  evidence: "relevant_unsurfaced_information",
  selectedTraitId: "C_n1",
  evidenceSeqs: [10],
});
assert.equal(
  carriedTrait.decision.selectedTraitId,
  "C_n1",
  "a trait the evidence licenses is never cleared",
);
assert.deepEqual(carriedTrait.repairCodes, [], "an already-valid decision reports no repair");
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: canonicalizeConversationLedgerJudgeDecision({
      decision: "speak",
      act: "contribute",
      selectedOpportunityId: null,
      evidence: "relevant_unsurfaced_information",
      selectedTraitId: "Z_z9",
      evidenceSeqs: [10],
    }).decision,
    state: gate3State,
    eligibleTraitIds: ["C_n1"],
    transcriptSeqs: new Set([10, 21]),
    cooldownAvailable: true,
  }).ruleCodes.includes("relevant_fact_trait_invalid"),
  "repair never launders a trait id the ledger does not offer",
);

// ─────────────────────────────────────────────────────────────────────────────
// [B4] Opportunity lifetime. Measured on T-C1-020 (three invitations still open
// at the end, one 58 turns old) and T-C1-024 (`opp:5` carried from seq 5 to the
// end of the session while Observer output grew 384 → 527 tokens).
// ─────────────────────────────────────────────────────────────────────────────

const b4Thread = {
  id: "thread-1",
  threadRootSeq: 1,
  status: "open" as const,
  goal: "compare_information",
  requestedAction: "go through information on each candidate",
  candidates: [] as Candidate[],
  scopeCandidates: [] as Candidate[],
  focusCandidate: null,
  focusBasis: "none" as const,
  mentionedCandidates: [] as Candidate[],
  participants: [...roster],
  evidenceSeqs: [1],
};
const b4Opportunity = (
  seq: number,
  overrides: Partial<{ kind: string; expectation: string; targets: string[] }> = {},
) => ({
  threadId: "thread-1",
  kind: "invitation",
  expectation: "invited",
  sourceRole: "humanX",
  opportunitySourceSeq: seq,
  originActor: "humanX",
  originSeq: seq,
  openedAtSeq: seq,
  targets: ["alex"],
  targetBasis: "explicit",
  evidenceSeqs: [seq],
  ...overrides,
});
const b4Delta = (triggerSeq: number, proposals: unknown[]) =>
  ({
    ledgerVersion: CONVERSATION_LEDGER_VERSION,
    observerVersion: "test-observer",
    sessionKey: "T-C1-024-B4",
    roster: [...roster],
    sourceRole: "humanX",
    currentTriggerSeq: triggerSeq,
    contextThroughSeq: triggerSeq,
    foregroundThreadId: "thread-1",
    threadProposals: [b4Thread],
    opportunityProposals: proposals,
    opportunityTransitions: [],
    floorProposal: {
      holder: "open",
      expectedNext: ["alex"],
      transition: "available",
      evidenceSeqs: [triggerSeq],
    },
    observerConflicts: [],
    repairCodes: [],
    conflictCodes: [],
    degradedMode: false,
  }) as any;
const b4Live = (state: { opportunities: { status: string; id: string }[] }) =>
  state.opportunities.filter((o) => o.status === "open" || o.status === "deferred").map((o) => o.id);

// B4a — Alex answering a thread retires that thread's older standing
// invitations. In T-C1-024 `opp:5` and `opp:6` were one invitation restated;
// the Judge selected `opp:6`, Alex spoke, and `opp:5` outlived the request it
// stood for.
const b4Seq5 = reduceConversationLedger(null, b4Delta(5, [b4Opportunity(5)])).state;
const b4Seq6 = reduceConversationLedger(b4Seq5, b4Delta(6, [b4Opportunity(6)])).state;
assert.deepEqual(
  b4Live(b4Seq6),
  ["opp:5:invitation:alex", "opp:6:invitation:alex"],
  "both invitations are live until Alex answers one of them",
);
const b4Answered = withOpportunityTransition(b4Seq6, {
  opportunityId: "opp:6:invitation:alex",
  toStatus: "consumed_by_alex",
  reason: "broadcast",
  broadcastSucceeded: true,
  alexBroadcastSeq: 7,
  evidenceSeqs: [6],
});
assert.deepEqual(b4Live(b4Answered.state), [], "answering the thread retires the older invitation");
assert.equal(
  b4Answered.state.opportunities.find((o) => o.id === "opp:5:invitation:alex")?.status,
  "superseded",
);
assert.ok(
  b4Answered.transition.accepted.some((code) =>
    code.startsWith("transition:opp:5:invitation:alex:superseded:answered_by_"),
  ),
  "the supersession names the opportunity that answered the thread",
);

// A newer invitation is not retired by an older consumption, and a different
// thread is never touched.
const b4Newer = reduceConversationLedger(b4Seq6, b4Delta(8, [b4Opportunity(8)])).state;
const b4NewerAnswered = withOpportunityTransition(b4Newer, {
  opportunityId: "opp:6:invitation:alex",
  toStatus: "consumed_by_alex",
  reason: "broadcast",
  broadcastSucceeded: true,
  alexBroadcastSeq: 9,
  evidenceSeqs: [8],
});
assert.deepEqual(
  b4Live(b4NewerAnswered.state),
  ["opp:8:invitation:alex"],
  "an invitation raised after the one Alex answered stays live",
);

// A direct question is an obligation, not clutter: neither rule may retire it.
// An opportunity may only be opened at the current trigger seq, so the question
// is raised on its own turn ahead of the two invitations.
const b4QuestionSeq4 = reduceConversationLedger(
  null,
  b4Delta(4, [b4Opportunity(4, { kind: "direct_question", expectation: "required" })]),
).state;
const b4WithQuestion = reduceConversationLedger(
  reduceConversationLedger(b4QuestionSeq4, b4Delta(5, [b4Opportunity(5)])).state,
  b4Delta(6, [b4Opportunity(6)]),
).state;
assert.deepEqual(
  b4Live(b4WithQuestion),
  ["opp:4:direct_question:alex", "opp:5:invitation:alex", "opp:6:invitation:alex"],
  "the question and both invitations are live before Alex answers",
);
const b4QuestionAnswered = withOpportunityTransition(b4WithQuestion, {
  opportunityId: "opp:6:invitation:alex",
  toStatus: "consumed_by_alex",
  reason: "broadcast",
  broadcastSucceeded: true,
  alexBroadcastSeq: 7,
  evidenceSeqs: [6],
});
assert.deepEqual(
  b4Live(b4QuestionAnswered.state),
  ["opp:4:direct_question:alex"],
  "the older invitation is retired but the unanswered direct question survives",
);

// B4b — the TTL backstop, for the case rule 1 cannot reach: Alex never speaks,
// so no consumption ever retires the backlog. T-C1-020 held one invitation open
// for 58 turns this way.
const b4Ttl = (triggerSeq: number) =>
  b4Live(reduceConversationLedger(b4Seq5, b4Delta(triggerSeq, [])).state);
assert.deepEqual(
  b4Ttl(13),
  ["opp:5:invitation:alex"],
  "an invitation is still live exactly at the TTL boundary (5 + 8)",
);
assert.deepEqual(b4Ttl(14), [], "one seq past the boundary the invitation expires");
assert.equal(
  reduceConversationLedger(b4Seq5, b4Delta(14, [])).state.opportunities[0]?.status,
  "expired",
);
const b4TtlQuestion = reduceConversationLedger(
  reduceConversationLedger(
    null,
    b4Delta(5, [b4Opportunity(5, { kind: "direct_question", expectation: "required" })]),
  ).state,
  b4Delta(40, []),
).state;
assert.deepEqual(
  b4Live(b4TtlQuestion),
  ["opp:5:direct_question:alex"],
  "the TTL never expires a direct question, however far the conversation moves",
);

// --- Issue 01: the router's verdict is known before the Judge is asked -------
//
// Every silence in T-C1-024 and T-C1-025, and both non-greeting silences in
// T-C2-041, were the router's cooldown veto applied *after* a full Observer and
// a full Judge had run. The veto is arithmetic over documents already loaded,
// so on those turns the answer was known before either model was called.
//
// The predicate is built from the same projection the Judge's prompt is built
// from, deliberately. A second, independently written rule for "what can Alex
// take this turn" is how the prose summary and the serialized ledger came to
// disagree once already.
assert.equal(
  deterministicVetoBeforeJudge(cooldownBlockedState, { cooldownAvailable: true }),
  null,
  "with cooldown available the Judge decides; nothing here pre-empts it",
);
assert.equal(
  deterministicVetoBeforeJudge(cooldownBlockedState, { cooldownAvailable: false }),
  "cooldown",
  "an invited opportunity cooldown forbids leaves nothing takeable, so the Judge is not asked",
);
assert.equal(
  deterministicVetoBeforeJudge(provisionalDirect.state, { cooldownAvailable: false }),
  null,
  "a required opportunity speaks through the cooldown and must still reach the Judge",
);
assert.equal(
  deterministicVetoBeforeJudge(uptakeState, { cooldownAvailable: false }),
  null,
  "the current uptake cluster bypasses the cooldown and must still reach the Judge",
);
const notForAlex: ConversationLedgerState = {
  ...cooldownBlockedState,
  opportunities: [
    {
      ...cooldownBlockedState.opportunities[0]!,
      expectation: "required",
      kind: "direct_question",
      targets: ["humanX"],
    },
  ],
};
assert.equal(
  deterministicVetoBeforeJudge(notForAlex, { cooldownAvailable: false }),
  "cooldown",
  "an opportunity aimed at a human is not Alex's to take, whatever its expectation",
);

// The floor is the other deterministic veto, and it outranks the cooldown
// because the router applies it first. Reporting the wrong one would conflate
// two silences the invariants require to stay distinct.
const floorHeld: ConversationLedgerState = {
  ...provisionalDirect.state,
  floor: { ...provisionalDirect.state.floor, transition: "held", holder: "humanY" },
};
assert.equal(humanFloorHeld(floorHeld), true, "fixture check: the floor is held by a human");
assert.equal(
  deterministicVetoBeforeJudge(floorHeld, { cooldownAvailable: true }),
  "human_floor_held",
  "a held human floor vetoes every act even when the cooldown is available",
);
// The fixture for the ordering has to be one where the two vetoes disagree.
// The first version of this assertion reused a state holding a required
// opportunity, so both the correct order and the reverse returned the floor and
// the test passed with the order inverted. It is the fifth vacuous first
// attempt in this repair; recorded in the checkpoint's method note.
const floorHeldNothingTakeable: ConversationLedgerState = {
  ...cooldownBlockedState,
  floor: { ...cooldownBlockedState.floor, transition: "held", holder: "humanY" },
};
assert.equal(
  humanFloorHeld(floorHeldNothingTakeable),
  true,
  "fixture check: the floor is held and the cooldown also forbids everything",
);
assert.equal(
  deterministicVetoBeforeJudge(floorHeldNothingTakeable, { cooldownAvailable: false }),
  "human_floor_held",
  "when both vetoes apply the floor is reported, matching the order the router applies them",
);

// --- Issue 02: the Judge decides which act, and is not shown the clock ------
//
// The prompt used to carry "Messages since Alex" and "Ordinary cooldown
// available". Both are facts about time, on a stage that must not decide when
// Alex speaks — and combined with a condition-dependent role goal they would
// have made intervention timing condition-dependent, which the study holds
// constant. What replaces them says which moves exist this turn.
const judgeUserMessage = buildLedgerJudgeUserMessage({
  messages: [
    { seq: 1, senderRole: "humanY", speaker: "Participant Y", content: "Let's start with Candidate B." },
    { seq: 2, senderRole: "humanX", speaker: "Participant X", content: "Sounds good to me." },
  ],
  state: cooldownBlockedState,
  cooldownAvailable: false,
  backchannelAvailable: true,
  eligibleTraitIds: [],
});
assert.doesNotMatch(
  judgeUserMessage,
  /messages since alex/i,
  "the Judge is not told how long it has been; a counter reads as a budget",
);
assert.doesNotMatch(
  judgeUserMessage,
  /cooldown/i,
  "the Judge is not told about the cooldown at all, by that or any name",
);
assert.match(
  judgeUserMessage,
  /Voluntary acts \(contribute, follow\): not available/,
  "it is told which moves exist this turn, which is a fact about options",
);
assert.match(
  buildLedgerJudgeUserMessage({
    messages: [
      { seq: 1, senderRole: "humanY", speaker: "Participant Y", content: "Let's start with Candidate B." },
    ],
    state: cooldownBlockedState,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
  }),
  /Voluntary acts \(contribute, follow\): available/,
  "and the same line reports availability the other way",
);

// The rule the prompt used to ask for in prose, now checked. Both cooldown
// silences in T-C2-041 were voluntary contributions on turns where the router
// then discarded them; nothing rejected either one.
const voluntaryWithoutCooldown = validateConversationLedgerJudgeDecision({
  decision: {
    decision: "speak",
    act: "contribute",
    selectedOpportunityId: null,
    evidence: "relevant_unsurfaced_information",
    selectedTraitId: "A_p1",
    evidenceSeqs: [2],
  },
  state: cooldownBlockedState,
  eligibleTraitIds: ["A_p1"],
  transcriptSeqs: new Set([1, 2]),
  cooldownAvailable: false,
});
assert.ok(
  voluntaryWithoutCooldown.ruleCodes.includes("voluntary_act_unavailable_this_turn"),
  "a voluntary act on a turn that has none is rejected, not merely discouraged",
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "contribute",
      selectedOpportunityId: null,
      evidence: "relevant_unsurfaced_information",
      selectedTraitId: "A_p1",
      evidenceSeqs: [2],
    },
    state: cooldownBlockedState,
    eligibleTraitIds: ["A_p1"],
    transcriptSeqs: new Set([1, 2]),
    cooldownAvailable: true,
  }).ok,
  true,
  "the same act is fine on a turn that has voluntary acts available",
);

// Orthogonality lives in the action space, not in a prompt rule.
assert.equal(
  (ledgerJudgeSchemaFor("C1").shape.act.unwrap().options as readonly string[]).includes("mediate"),
  false,
  "a Member cannot express mediate; the act is unrepresentable, not forbidden",
);
assert.equal(
  (ledgerJudgeSchemaFor("C3").shape.act.unwrap().options as readonly string[]).includes("mediate"),
  false,
  "both Member conditions, not just one",
);
for (const chair of ["C2", "C4"] as const) {
  assert.equal(
    (ledgerJudgeSchemaFor(chair).shape.act.unwrap().options as readonly string[]).includes(
      "mediate",
    ),
    true,
    `a Chair keeps mediate (${chair})`,
  );
}

// The role goal reaches the Judge, and stops short of timing.
for (const member of ["C1", "C3"] as const) {
  const goal = ledgerJudgeRoleGoal(member);
  assert.match(goal, /without directing, managing, or mediating/i, `${member} is a member`);
  assert.doesNotMatch(goal, /chairs this group/i, `${member} is not told to chair`);
}
for (const chair of ["C2", "C4"] as const) {
  const goal = ledgerJudgeRoleGoal(chair);
  assert.match(goal, /chairs this group/i, `${chair} chairs`);
  assert.doesNotMatch(goal, /without directing/i, `${chair} is not told to stand back`);
}
for (const condition of ["C1", "C2", "C3", "C4"] as const) {
  assert.match(
    ledgerJudgeRoleGoal(condition),
    /does not decide when Alex speaks/i,
    `${condition}: the boundary ADR-0001 draws is stated in the prompt itself`,
  );
}
assert.equal(
  ledgerJudgeRoleGoal("C1") === ledgerJudgeRoleGoal("C3") &&
    ledgerJudgeRoleGoal("C2") === ledgerJudgeRoleGoal("C4"),
  true,
  "the goal varies with status only — the communication strategy is the other axis and is applied elsewhere",
);

console.log("[conversation-ledger] deterministic reducer tests passed");
