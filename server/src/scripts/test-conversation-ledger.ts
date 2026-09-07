import assert from "node:assert/strict";
import { replayObservedConversation } from "../eval/conversationReplay.js";
import {
  CONVERSATION_LEDGER_VERSION,
  createConversationLedgerState,
  humanFloorHeld,
  observerDeltaFromTurn,
  opportunityMayBypassCooldown,
  reduceConversationLedger,
  responseOpportunityId,
  withOpportunityTransition,
  withProvisionalAlexAddress,
  type ObservedTurnForLedger,
} from "../lib/conversationLedger.js";
import { validateConversationLedgerJudgeDecision } from "../lib/interventionJudge.js";

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

console.log("[conversation-ledger] deterministic reducer tests passed");
