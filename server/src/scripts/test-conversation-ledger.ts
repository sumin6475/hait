import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { forceGuardsOnForTest } from "../lib/guardFlags.js";
// A comparison run leaves guards off in `server/.env`, and these suites load it.
// Pin them on before anything reads them, so a suite can never quietly assert
// the behaviour of a build nobody ships.
forceGuardsOnForTest();
import type { Candidate } from "../types.js";
import { ALEX_Z_IDS } from "../lib/traitData.js";
import { replayObservedConversation } from "../eval/conversationReplay.js";
import {
  CONVERSATION_LEDGER_VERSION,
  candidateSalienceOrder,
  createConversationLedgerState,
  describeConversationLedger,
  humanFloorHeld,
  floorHeldForDecisions,
  observerDeltaFromTurn,
  opportunityMayBypassCooldown,
  reduceConversationLedger,
  responseOpportunityId,
  withOpportunityTransition,
  withProvisionalAlexAddress,
  type ConversationLedgerState,
  type ObservedTurnForLedger,
} from "../lib/conversationLedger.js";
import {
  eligibleTraitIdsForLedgerState,
  ledgerRouteKindForAct,
  ledgerSpeechBlockedByHumanFloor,
  mediationAvailableFor,
  recapAvailableFor,
} from "../lib/interventionEngine.js";
import {
  canonicalizeConversationLedgerJudgeDecision,
  buildLedgerJudgeUserMessage,
  currentRequiredOpportunityIdsFor,
  alexPreferenceNote,
  exhaustedCandidateNote,
  humanMessagesSinceAlexSpoke,
  humanNarrowedCandidates,
  NARROWING_WINDOW_HUMAN_MESSAGES,
  leaderCoverageNote,
  LEDGER_JUDGE_TRAIT_RETRY_RULE_CODES,
  ledgerJudgeRetryMessage,
  conversationLedgerDecisionProjection,
  deterministicVetoBeforeJudge,
  ledgerJudgeRoleGoal,
  ledgerJudgeSchemaFor,
  unansweredRequestsForAlex,
  LEDGER_JUDGE_SYSTEM,
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
// Naming Alex speaks through the cooldown, whether or not the sentence is a
// question.
//
// This assertion used to read `false`, with the reason "the cooldown still
// governs every invitation that is not an answer to Alex". It was vacuous: the
// fixture left `foregroundThreadId` at `null`, so the thread comparison inside
// `opportunityMayBypassCooldown` short-circuited before the kind test was
// reached, and the same `false` came back however the predicate was written.
// Setting the thread is what makes this exercise the predicate at all.
//
// The behaviour it asserted is also the one being changed. T-C4-022 seq 22 named
// Alex and asked for more on Candidate A; because the sentence was a proposal
// rather than a question it minted an `invitation`, which did not bypass. Alex
// can therefore be addressed by name and answer with silence, for a reason no
// participant can see. Punctuation is the whole of the difference.
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
const ordinaryInvitationOpportunity = ordinaryInvitation.opportunities[0]!;
assert.equal(ordinaryInvitationOpportunity.answersAlexSeq, undefined);
assert.equal(ordinaryInvitationOpportunity.kind, "invitation");
assert.equal(
  ordinaryInvitationOpportunity.targetBasis,
  "explicit",
  "a turn that names Alex is minted with an explicit target basis",
);
const namedOnForegroundThread = {
  ...ordinaryInvitation,
  foregroundThreadId: ordinaryInvitationOpportunity.threadId,
};
assert.equal(
  opportunityMayBypassCooldown(namedOnForegroundThread, ordinaryInvitationOpportunity),
  true,
  "naming Alex speaks through the cooldown even when the request is not a question",
);
// The widening is to being named and to nothing else. A request put to the room
// still waits its turn, on the same thread and the same trigger, so an ordinary
// group turn cannot reach the bypass by inheriting it.
const groupRequest = reduceConversationLedger(
  null,
  observerDeltaFromTurn({
    sessionKey: "T-C4-022-GROUP",
    observerVersion: "test-observer",
    roster,
    sourceRole: "humanY",
    currentTriggerSeq: 17,
    contextThroughSeq: 17,
    observation: observation({
      speechAct: "proposal",
      addressees: ["group"],
      requestExplicitness: "explicit",
    }),
  }),
).state;
const groupOpportunity = groupRequest.opportunities[0]!;
assert.equal(groupOpportunity.targetBasis, "group_expanded");
assert.equal(
  opportunityMayBypassCooldown(
    { ...groupRequest, foregroundThreadId: groupOpportunity.threadId },
    groupOpportunity,
  ),
  false,
  "a request put to the room is not a request put to Alex, and still waits",
);

// --- Issue 28: an opinion is not a request ---------------------------------
//
// T-C2-051 seq 29. "being moody in that situation when he is responsible for
// people's lives is not something that you can neglect it easy" — an opinion
// about D, read by the Observer as a proposal that names Alex, and marked
// `implicit`. The branch above ignored that mark and minted an invitation, so
// the Judge had to write what the request wanted and produced "They asked why D
// would be the best". Nobody asked that. Five turns across T-C2-051 and
// T-C2-050 were built this way.
//
// The mark is now read. A question is untouched: T-C2-050 seq 37 asked what
// happens if A reacts poorly to criticism and carries the same `implicit`, and
// killing that turn would cost Alex an answer somebody actually wanted.
const opinionNamingAlex = (over: Partial<ObservedTurnForLedger> = {}) =>
  reduceConversationLedger(
    null,
    observerDeltaFromTurn({
      sessionKey: "T-C2-051-OPINION",
      observerVersion: "test-observer",
      roster,
      sourceRole: "humanX",
      currentTriggerSeq: 29,
      contextThroughSeq: 29,
      observation: observation({
        speechAct: "proposal",
        addressees: ["humanY", "alex"],
        requestExplicitness: "implicit",
        alexRelation: "explicit_addressee",
        ...over,
      }),
    }),
  ).state;

assert.deepEqual(
  opinionNamingAlex().opportunities,
  [],
  "an implicit proposal that names Alex is an opinion, not a request",
);
assert.deepEqual(
  opinionNamingAlex({ addressees: ["group"], alexRelation: "group_participant" }).opportunities,
  [],
  "and the same opinion put to the room opens nothing either",
);
assert.equal(
  opinionNamingAlex({ requestExplicitness: "explicit" }).opportunities[0]?.kind,
  "invitation",
  "an explicit proposal is still a request",
);
assert.equal(
  opinionNamingAlex({ speechAct: "question" }).opportunities[0]?.kind,
  "direct_question",
  "a question is a request however the Observer marked its explicitness",
);
// The turn still answers Alex when it answers Alex. Removing the request must
// not remove the uptake underneath it — that is the whole of issue 12.
assert.equal(
  reduceConversationLedger(
    null,
    observerDeltaFromTurn({
      sessionKey: "T-C2-051-OPINION-UPTAKE",
      observerVersion: "test-observer",
      roster,
      sourceRole: "humanX",
      currentTriggerSeq: 29,
      contextThroughSeq: 29,
      alexQuestionAwaitingReplySeq: 28,
      observation: observation({
        speechAct: "proposal",
        addressees: ["alex"],
        requestExplicitness: "implicit",
        alexRelation: "explicit_addressee",
      }),
    }),
  ).state.opportunities[0]?.kind,
  "uptake",
  "an opinion that answers Alex is still reachable as an uptake",
);
// And the comparison build still runs the old reading, so the two transcripts
// differ in this and nothing else.
process.env.HAIT_GUARD_IMPLICIT_REQUEST = "off";
assert.equal(
  opinionNamingAlex().opportunities[0]?.kind,
  "invitation",
  "with the guard off an implicit proposal opens a request again",
);
delete process.env.HAIT_GUARD_IMPLICIT_REQUEST;

// --- Issue 13 half B: an unanswered request survives the turn it was made on -
//
// The same T-C2-045 stretch, one layer down. Half A got seq 17 past the
// cooldown; this is what happens on seqs 18, 21 and 25, where Alex spoke three
// times with that request still open and answered something else each time. The
// Judge was not choosing a voluntary act over the request — the projection had
// removed it, so the Judge was never shown it at all.
const openRequest = { ...answersAlexRequest, foregroundThreadId: "thread-1" };
for (const laterSeq of [18, 21, 25]) {
  const later = { ...openRequest, currentTriggerSeq: laterSeq, contextThroughSeq: laterSeq };
  assert.deepEqual(
    conversationLedgerDecisionProjection(later, { cooldownAvailable: true }).opportunities.map(
      (item) => item.id,
    ),
    [answersAlexOpportunity.id],
    `seq ${laterSeq}: an unanswered request is still one of the turn's options`,
  );
  assert.equal(
    validateConversationLedgerJudgeDecision({
      decision: {
        decision: "speak",
        act: "participate",
        selectedOpportunityId: answersAlexOpportunity.id,
        evidence: "selected_open_opportunity",
        discloseTraitIds: [],
        focusCandidate: null,
        brief: "answer what they just asked",
        evidenceSeqs: [17],
      },
      state: later,
      eligibleTraitIds: [],
      transcriptSeqs: new Set([16, 17, 18, 21, 25]),
      cooldownAvailable: true,
    }).ruleCodes.includes("selected_invited_opportunity_not_current"),
    false,
    `seq ${laterSeq}: and taking it is valid, so the prompt and the validator agree`,
  );
}

// The cadence is untouched. An older request cannot bypass the cooldown, because
// `opportunityMayBypassCooldown` still requires current-trigger evidence — so
// the widened selectability only ever adds an option to a turn where Alex could
// already have spoken voluntarily.
const laterBlocked = { ...openRequest, currentTriggerSeq: 18, contextThroughSeq: 18 };
assert.deepEqual(
  conversationLedgerDecisionProjection(laterBlocked, { cooldownAvailable: false }).opportunities,
  [],
  "an unanswered request does not speak through the cooldown on a later turn",
);
assert.equal(
  deterministicVetoBeforeJudge(laterBlocked, { cooldownAvailable: false }),
  "cooldown",
  "and the turn is still vetoed before the Judge runs, as it was",
);
assert.equal(
  deterministicVetoBeforeJudge(
    {
      ...laterBlocked,
      floor: { holder: "humanX", expectedNext: ["humanX"], transition: "held", evidenceSeqs: [18] },
    },
    { cooldownAvailable: true },
  ),
  "human_floor_held",
  "an owed answer is still not a reason to take a floor a human holds",
);

// The other population is unchanged. An uptake is not a request: nobody asked,
// and the licence to follow is the reply being fresh. Left standing it would
// become an unconditional right to speak, which is the thing the cadence
// invariant exists to prevent.
const staleUptake: ConversationLedgerState = {
  ...openRequest,
  currentTriggerSeq: 19,
  contextThroughSeq: 19,
  opportunities: [
    { ...answersAlexOpportunity, id: "opp:16:uptake:alex", kind: "uptake", answersAlexSeq: undefined },
  ],
};
assert.deepEqual(
  conversationLedgerDecisionProjection(staleUptake, { cooldownAvailable: true }).opportunities,
  [],
  "an uptake whose evidence is not the current trigger is still history, not a choice",
);

// An expired request is not revived. The [B4] TTL is what bounds how long an
// unanswered request stays reachable now that its own seq no longer does, so it
// has to actually fire.
const ttlDelta = observerDeltaFromTurn({
  sessionKey: "T-C2-045-ANSWERS-ALEX",
  observerVersion: "test-observer",
  roster,
  sourceRole: "humanX",
  currentTriggerSeq: 26,
  contextThroughSeq: 26,
  observation: observation(),
});
const afterTtl = reduceConversationLedger(openRequest, ttlDelta).state;
assert.equal(
  afterTtl.opportunities[0]!.status,
  "expired",
  "eight seqs past its opening, the request is retired by the reducer",
);
assert.deepEqual(
  conversationLedgerDecisionProjection(afterTtl, { cooldownAvailable: true }).opportunities,
  [],
  "and an expired request is not offered back to the Judge",
);
assert.ok(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "speak",
      act: "participate",
      selectedOpportunityId: answersAlexOpportunity.id,
      evidence: "selected_open_opportunity",
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
      evidenceSeqs: [17],
    },
    state: afterTtl,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([16, 17, 26]),
    cooldownAvailable: true,
  }).ruleCodes.includes("selected_opportunity_not_open_for_alex"),
  "selecting it anyway is rejected",
);

// The ranking is a fact the Judge reads, not a correction applied to its answer.
const twoRequests: ConversationLedgerState = {
  ...openRequest,
  currentTriggerSeq: 21,
  contextThroughSeq: 21,
  opportunities: [
    { ...answersAlexOpportunity, id: "opp:20:group_request:alex", kind: "group_request", opportunitySourceSeq: 20, originSeq: 20, openedAtSeq: 20, evidenceSeqs: [20] },
    answersAlexOpportunity,
    { ...answersAlexOpportunity, id: "opp:21:uptake:alex", kind: "uptake", opportunitySourceSeq: 21, originSeq: 21, openedAtSeq: 21, evidenceSeqs: [21] },
  ],
};
assert.deepEqual(
  unansweredRequestsForAlex(
    conversationLedgerDecisionProjection(twoRequests, { cooldownAvailable: true }).opportunities,
  ).map((item) => item.id),
  [answersAlexOpportunity.id, "opp:20:group_request:alex"],
  "requests are listed oldest first, and an uptake is not a request",
);
const twoRequestsPrompt = buildLedgerJudgeUserMessage({
  messages: [16, 17, 20, 21].map((seq) => ({
    seq,
    senderRole: "humanY" as const,
    speaker: "Participant Y",
    content: `m${seq}`,
  })),
  state: twoRequests,
  cooldownAvailable: true,
  backchannelAvailable: true,
  eligibleTraitIds: [],
});
assert.match(
  twoRequestsPrompt,
  /Unanswered requests addressed to Alex, oldest first: opp:17:invitation:alex \(asked at message 17\), opp:20:group_request:alex \(asked at message 20\)/,
  "the Judge is told which requests are owed before it decides, not after",
);

// The ranking stops at voluntary acts, and that boundary is the whole of it.
// `current_required_opportunity_not_selected` forces a required opportunity
// opened on this turn ahead of everything else. Before half B an older request
// was never listed, so the two could not disagree; now they can, and a prompt
// that told the Judge to answer the oldest request first would be telling it to
// walk into a rejection whose cheapest escape is silence.
const requiredNowWithOlderRequest: ConversationLedgerState = {
  ...openRequest,
  currentTriggerSeq: 21,
  contextThroughSeq: 21,
  opportunities: [
    answersAlexOpportunity,
    {
      ...answersAlexOpportunity,
      id: "opp:21:direct_question:alex",
      kind: "direct_question",
      expectation: "required",
      opportunitySourceSeq: 21,
      originSeq: 21,
      openedAtSeq: 21,
      evidenceSeqs: [21],
    },
  ],
};
const selectingTheOlderRequest = validateConversationLedgerJudgeDecision({
  decision: {
    decision: "speak",
    act: "participate",
    selectedOpportunityId: answersAlexOpportunity.id,
    evidence: "selected_open_opportunity",
    discloseTraitIds: [],
    focusCandidate: null,
    brief: "answer what they just asked",
    evidenceSeqs: [17],
  },
  state: requiredNowWithOlderRequest,
  eligibleTraitIds: [],
  transcriptSeqs: new Set([16, 17, 21]),
  cooldownAvailable: true,
}).ruleCodes;
assert.ok(
  selectingTheOlderRequest.includes("current_required_opportunity_not_selected"),
  "a question asked on this turn is still answered before a request carried over",
);
assert.doesNotMatch(
  LEDGER_JUDGE_SYSTEM,
  /oldest/i,
  "so the prompt states no ordering among requests — the validator owns that",
);
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /outranks a voluntary act/,
  "and the ranking it does state is the one half B was asked for",
);

// ── The leader's coverage note, and the peer's silence about it ─────────────
// [T-C4-024] On a turn where nobody had asked anything and A and D had nothing
// on them, the Judge wrote "propose a clear criterion to decide" and Alex
// invented a rule that weighted trait categories. Equal weighting is the study's
// control, so that turn was not a wording problem. Two things follow, and both
// are asserted here: the leader is told which candidates are thin, so the turn
// has a legitimate move; and the peer is told nothing, because owning the
// discussion procedure is the status manipulation.
{
  // `aiSurfacedIds` is one flat list on the root, not per candidate — the shape
  // `informationPools` actually reads.
  // B_n3 and C_p2 are the load-bearing ids: they sit on one human's card and not
  // on Alex's, so they are what retires B and C. Everything else here is shared
  // or Alex's own, and under `docs/adr/0011` none of it moves the list.
  const boardOnBandC = {
    byCandidate: {
      A: { revealedIds: [] },
      B: { revealedIds: ["B_p1", "B_p2", "B_p3", "B_n3"] },
      C: { revealedIds: ["C_p1", "C_n1", "C_n2", "C_p2"] },
      D: { revealedIds: [] },
    },
    aiSurfacedIds: ["B_p4", "B_n5", "C_p6", "C_p7"],
  };
  // Leader: the thin candidates are named, and the covered ones are the contrast.
  for (const leader of ["C2", "C4"] as const) {
    const note = leaderCoverageNote(leader, boardOnBandC);
    assert.ok(note, `${leader} is a leader and receives the coverage note`);
    assert.match(note!, /from their own notes about A and D/);
    assert.match(note!, /B, C/);
    // The Judge is handed the reading, never the arithmetic — the brief rules
    // forbid a count reaching the writer, and a Judge given integers can leak one.
    assert.doesNotMatch(note!, /\d/, "the coverage note carries no number");
  }
  // Peer: nothing at all. This is the manipulation, not an optimisation.
  for (const peer of ["C1", "C3"] as const) {
    assert.equal(
      leaderCoverageNote(peer, boardOnBandC),
      null,
      `${peer} is a peer and must not receive the live candidate list`,
    );
  }
  // The note reaches the Judge's turn facts only when a condition is supplied,
  // and it reaches them beside the other moves available now — not in the role
  // goal, which is a session constant and would lose its cache prefix.
  const judgeMessages = [2, 3].map((seq) => ({
    seq,
    senderRole: "humanY" as const,
    speaker: "Participant Y",
    content: `m${seq}`,
  }));
  const leaderPrompt = buildLedgerJudgeUserMessage({
    messages: judgeMessages,
    state: twoRequests,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
    conditionCode: "C2",
    revealStats: boardOnBandC,
  });
  assert.match(
    leaderPrompt,
    /Moves available on this turn:[\s\S]*- Coverage: Nobody has brought anything from their own notes about A and D/,
  );
  // No board, no sentence about the board. `revealStats` has been documented as
  // "absent means no note is added" since it was added and did not do it:
  // an empty pooled count for all four candidates reads as "nobody has brought
  // anything of their own", so an absent board produced a fabrication rather
  // than a silence. The offline replay eval is the caller that passes nothing —
  // its corpus records no surfaced ids on any of its 1451 messages — and it is
  // the instrument these notes are measured with.
  assert.doesNotMatch(
    buildLedgerJudgeUserMessage({
      messages: judgeMessages,
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C4",
    }),
    /- Coverage:|- Your card:/,
    "a leader with no board is told nothing about the board, not told it is empty",
  );
  const peerPrompt = buildLedgerJudgeUserMessage({
    messages: judgeMessages,
    state: twoRequests,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
    conditionCode: "C1",
    revealStats: boardOnBandC,
  });
  assert.doesNotMatch(peerPrompt, /- Coverage:/, "the peer's Judge never sees a coverage line");
  // Every candidate covered is a state with its own reading, not an empty string
  // that would read as a missing input.
  // One human-only trait per candidate and nothing else is needed: `A_n1`,
  // `B_n3`, `C_p2`, `D_n4` each sit on exactly one participant's card.
  const fullBoard = {
    byCandidate: {
      A: { revealedIds: ["A_p1", "A_p2", "A_p3", "A_n1"] },
      B: { revealedIds: ["B_p1", "B_p2", "B_p3", "B_n3"] },
      C: { revealedIds: ["C_p1", "C_n1", "C_n2", "C_p2"] },
      D: { revealedIds: ["D_p1", "D_p2", "D_p3", "D_n4"] },
    },
    aiSurfacedIds: ["A_n5", "B_n5", "C_n1", "D_n5"],
  };
  assert.match(
    leaderCoverageNote("C4", fullBoard)!,
    /no coverage gap to name/,
    "an exhausted list says so rather than going quiet",
  );
  // [ADR 0011] Alex cannot empty the list by itself. Every trait Alex holds for
  // every candidate, said by Alex, retires nobody — which is the whole of the
  // change, and the state T-C2-051 reached at seq 17 and never left.
  const alexSaidEverythingItHolds = {
    byCandidate: { A: { revealedIds: [] }, B: { revealedIds: [] }, C: { revealedIds: [] }, D: { revealedIds: [] } },
    aiSurfacedIds: ALEX_Z_IDS,
  };
  assert.match(
    leaderCoverageNote("C2", alexSaidEverythingItHolds)!,
    /Nobody has brought anything from their own notes about any candidate so far: A, B, C, D/,
    "Alex emptying its own card leaves every candidate where it was",
  );
}

// ── What the group has narrowed to ─────────────────────────────────────────
// Nothing computed this. The concept lived in the Judge's prompt as a sentence
// and in a comment saying it was the model's to read off the transcript, and the
// leader frame's late-half moves all hang on it
// (`.scratch/leader-decision-frame/spec.md`).
{
  const human = (seq: number, content: string, who: "humanX" | "humanY" = "humanY") =>
    ({ seq, senderRole: who, speaker: who, content }) as const;
  const alex = (seq: number, content: string) =>
    ({ seq, senderRole: "ai" as const, speaker: "Alex", content }) as const;

  assert.equal(NARROWING_WINDOW_HUMAN_MESSAGES, 5);

  // Until every candidate has been in view, "only B and C have been named" is
  // the discussion not having started. That early reading is the one that would
  // have made the note dangerous, so it is a precondition rather than a filter.
  assert.equal(
    humanNarrowedCandidates([
      human(1, "I like Candidate B"),
      human(2, "Candidate C is weak"),
      human(3, "B again for me"),
    ]),
    null,
    "two candidates named at the start is not a narrowing",
  );

  const wholeField = [
    human(1, "Candidate A looks strong"),
    human(2, "Candidate B keeps a cool head"),
    human(3, "Candidate C is not verbally skillful"),
    human(4, "Candidate D is very resilient"),
  ];
  // All four in view and all four still being named: nothing to report.
  assert.equal(humanNarrowedCandidates(wholeField), null);

  // Five more human messages naming only A and B, and the last stretch is A, B.
  const narrowed = [
    ...wholeField,
    human(5, "I think it is between Candidate A and Candidate B"),
    human(6, "Candidate A's organisation matters"),
    human(7, "Candidate B is more reliable"),
    human(8, "still Candidate B for me"),
    human(9, "Candidate A though"),
  ];
  assert.deepEqual(humanNarrowedCandidates(narrowed), ["A", "B"]);

  // Alex naming a candidate does not keep it in the room. A group has not stayed
  // wide because Alex kept talking about D.
  assert.deepEqual(
    humanNarrowedCandidates([
      ...narrowed,
      alex(10, "Candidate C and Candidate D are still on the table"),
      alex(11, "Candidate D can concentrate very well"),
    ]),
    ["A", "B"],
    "Alex's own messages are not the group's attention",
  );

  // It reads attention, not intent. A candidate that was forgotten reads the
  // same as one that was argued away, and the leader's move is the same — that
  // is the whole reason this is not a sentence matcher.
  assert.deepEqual(
    humanNarrowedCandidates([
      ...wholeField,
      human(5, "Candidate A is organised"),
      human(6, "Candidate B is reliable"),
      human(7, "Candidate A again"),
      human(8, "Candidate B's tone is a problem"),
      human(9, "I still prefer Candidate A"),
    ]),
    ["A", "B"],
    "nobody said 'let us drop C' and it makes no difference",
  );

  // [T-C2-053] A record now, and never given to the Judge. From seq 24 it read
  // "only C and D" while the people were arguing both of them out; the Judge
  // reads that move from what they wrote.
  for (const conditionCode of ["C1", "C2", "C3", "C4"] as const) {
    assert.doesNotMatch(
      buildLedgerJudgeUserMessage({
        messages: narrowed as any,
        state: twoRequests,
        cooldownAvailable: true,
        backchannelAvailable: true,
        eligibleTraitIds: [],
        conditionCode,
      }),
      /Where the group is|last stretch/,
    );
  }

  // The shortfall is keyed to the people's move, and the bound on it stays.
  assert.doesNotMatch(LEDGER_JUDGE_SYSTEM, /last stretch of the discussion/);
  assert.match(LEDGER_JUDGE_SYSTEM, /move to set a candidate aside, to narrow the field, or to decide/);
  assert.match(LEDGER_JUDGE_SYSTEM, /which you read from what they wrote/);
  assert.match(LEDGER_JUDGE_SYSTEM, /Say it once and accept their answer/);
  assert.match(LEDGER_JUDGE_SYSTEM, /pushing, not leading/);
}

// ── A turn replies to what was said since Alex last spoke ──────────────────
// [T-C2-052, T-C2-053] The Judge built each turn around the trigger, so a message
// the cooldown kept Alex from answering, or one overtaken before any decision,
// was passed over: T-C2-053 seq 32 asked the room for top choices and nothing
// answered it.
{
  const said = (seq: number, senderRole: "ai" | "humanX" | "humanY") => ({ seq, senderRole });
  assert.deepEqual(
    humanMessagesSinceAlexSpoke(
      [said(1, "ai"), said(2, "humanX"), said(3, "humanY"), said(4, "ai"), said(5, "humanX"), said(6, "humanY")],
      6,
    ),
    [5, 6],
  );
  assert.deepEqual(
    humanMessagesSinceAlexSpoke([said(4, "ai"), said(5, "humanX"), said(6, "humanY"), said(7, "humanX")], 6),
    [5, 6],
    "a message after the judged turn is not part of it",
  );
  assert.deepEqual(humanMessagesSinceAlexSpoke([said(1, "humanX"), said(2, "humanY")], 2), [1, 2]);
  assert.deepEqual(humanMessagesSinceAlexSpoke([said(1, "humanX"), said(2, "ai")], 2), []);

  const prompt = buildLedgerJudgeUserMessage({
    messages: [
      { seq: 30, senderRole: "ai" as const, speaker: "Alex", content: "a" },
      { seq: 31, senderRole: "humanY" as const, speaker: "Participant Y", content: "I have no common misses" },
      { seq: 32, senderRole: "humanY" as const, speaker: "Participant Y", content: "What are your top choices?" },
      { seq: 33, senderRole: "humanX" as const, speaker: "Participant X", content: "@Y, your preferred candidate?" },
    ],
    state: { ...twoRequests, currentTriggerSeq: 33, contextThroughSeq: 33 },
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
    conditionCode: "C2",
  });
  assert.match(prompt, /- Said by the humans since Alex last spoke: messages 31, 32, 33/);

  // Listed as what to reply to, never as a clock; the rule says both halves.
  assert.match(LEDGER_JUDGE_SYSTEM, /What the humans said since Alex last spoke is what this turn replies to/);
  assert.match(LEDGER_JUDGE_SYSTEM, /This is about content, never pacing/);
  assert.match(LEDGER_JUDGE_SYSTEM, /never hand the writer a premise nobody stated/);
  assert.match(LEDGER_JUDGE_SYSTEM, /The coverage line is not by itself a reason to take a turn/);
  assert.match(LEDGER_JUDGE_SYSTEM, /never write a brief that calls the information on a candidate exhausted/);
}

// ── The Chair's board recap is an act, not a timer ─────────────────────────
// [Issue 26 / ADR 0012] `armSummaryIfEligible` set `summaryStatus: "pending"` on
// five thresholds and the two gates that consumed it were unreachable under the
// shipped controller. T-C2-052 logged "summary armed" at seq 46 and never
// summarised. The arming was also arithmetic about *when* Alex speaks, decided
// outside the Judge and only in leader conditions — the one thing ADR 0001 holds
// constant. What is left is a move offered on the turns it is Alex's to take.
{
  const board = {
    byCandidate: {
      A: { revealedIds: ["A_p1"] },
      B: { revealedIds: [] },
      C: { revealedIds: [] },
      D: { revealedIds: [] },
    },
    humanConfirmedIds: ["A_p1"],
    aiSurfacedIds: [] as string[],
  };
  // No clock and no message count. A board, a leader, and a recap not yet spent.
  assert.equal(recapAvailableFor({ conditionCode: "C2", summaryStatus: "not_eligible" }, { revealStats: board }), true);
  assert.equal(recapAvailableFor({ conditionCode: "C4", summaryStatus: "not_eligible" }, { revealStats: board }), true);
  // A Member reciting the group's board is the status being contrasted against.
  assert.equal(recapAvailableFor({ conditionCode: "C1", summaryStatus: "not_eligible" }, { revealStats: board }), false);
  assert.equal(recapAvailableFor({ conditionCode: "C3", summaryStatus: "not_eligible" }, { revealStats: board }), false);
  // Once a session. That is a bound on repetition, not on timing.
  assert.equal(recapAvailableFor({ conditionCode: "C2", summaryStatus: "done" }, { revealStats: board }), false);
  assert.equal(recapAvailableFor({ conditionCode: "C2", summaryStatus: "generating" }, { revealStats: board }), false);
  // Nothing to recite is not a recap.
  assert.equal(recapAvailableFor({ conditionCode: "C2", summaryStatus: "not_eligible" }, { revealStats: undefined }), false);

  // The move is listed beside the others, and only when it is on offer.
  const promptWith = buildLedgerJudgeUserMessage({
    messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
    state: twoRequests,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
    conditionCode: "C2",
    recapAvailable: true,
  });
  assert.match(promptWith, /- recap: available/);
  assert.match(
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C2",
      recapAvailable: false,
    }),
    /- recap: not available/,
  );
  // A recap is a voluntary act, so the cooldown governs it like the others.
  assert.match(
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: false,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C2",
      recapAvailable: true,
    }),
    /- recap: not available/,
  );
  // A caller that says nothing about the recap is told nothing about it.
  assert.doesNotMatch(
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C2",
    }),
    /- recap:/,
  );

  // The schema is the first lock: a Member cannot express the act at all.
  const asRecap = {
    decision: "speak",
    act: "recap",
    selectedOpportunityId: null,
    evidence: "conversation_grounded_synthesis",
    discloseTraitIds: [],
    focusCandidate: null,
    brief: "put the board back in front of them",
    evidenceSeqs: [2],
  };
  assert.equal(
    ledgerJudgeSchemaFor("C1").safeParse(asRecap).success,
    false,
    "a Member's schema cannot express recap",
  );
  assert.equal(ledgerJudgeSchemaFor("C3").safeParse(asRecap).success, false);
  assert.equal(ledgerJudgeSchemaFor("C2").safeParse(asRecap).success, true);
  assert.equal(ledgerJudgeSchemaFor("C4").safeParse(asRecap).success, true);
  // The routing seam is the second, for any path that hands over a wide decision.
  assert.equal(ledgerRouteKindForAct("recap", "C2"), "summary");
  assert.equal(ledgerRouteKindForAct("recap", "C4"), "summary");
  assert.equal(ledgerRouteKindForAct("recap", "C1"), "build_on");
  assert.equal(ledgerRouteKindForAct("recap", "C3"), "build_on");

  const recapDecision = {
    decision: "speak" as const,
    act: "recap" as const,
    selectedOpportunityId: null,
    evidence: "conversation_grounded_synthesis" as const,
    discloseTraitIds: [] as string[],
    focusCandidate: null,
    brief: "put the board back in front of them as it stands",
    evidenceSeqs: [2],
  };
  const validate = (over: Record<string, unknown>, recapAvailable: boolean) =>
    validateConversationLedgerJudgeDecision({
      decision: { ...recapDecision, ...over } as any,
      state: { ...twoRequests, currentTriggerSeq: 2, contextThroughSeq: 2 },
      eligibleTraitIds: ["A_p1"],
      transcriptSeqs: new Set([1, 2]),
      cooldownAvailable: true,
      recapAvailable,
    });
  assert.equal(validate({}, true).ok, true, "an offered recap is accepted");
  assert.ok(
    validate({}, false).ruleCodes.includes("recap_unavailable_this_turn"),
    "a recap nobody offered is rejected",
  );
  // The board is recited, never written. A recap that also names a fact would
  // not contain it — the message is assembled from the board.
  assert.ok(
    validate({ discloseTraitIds: ["A_p1"] }, true).ruleCodes.includes("recap_names_a_trait"),
  );
}

// ── The Chair's mediation ──────────────────────────────────────────────────
// [S-C2-002] `mediate` has been in the Chair's schema since the schema existed
// and was chosen zero times in every recorded session. The moves block never
// listed it, and the system prompt says a move that is not listed is not a
// choice. Meanwhile the engine latched the discussion-state evidence that opens
// it on every push and never read the latch back: S-C2-002 latched at seq 16 on
// candidate concentration and stayed latched while the group narrowed to A and
// B, and C — the one candidate nobody had brought their own notes on — left the
// table at seq 42 and never returned.
{
  const leaderTurn = (over: Record<string, unknown>) =>
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C2",
      ...over,
    } as any);

  assert.match(leaderTurn({ mediationAvailable: true }), /- mediate: available/);
  assert.match(leaderTurn({ mediationAvailable: false }), /- mediate: not available/);
  // A voluntary act, so the cooldown governs it like the others.
  assert.match(
    leaderTurn({ mediationAvailable: true, cooldownAvailable: false }),
    /- mediate: not available/,
  );
  // A Member is told nothing about a move it cannot make.
  assert.doesNotMatch(leaderTurn({}), /- mediate:/);
  // The evidence rides along so the Judge reads a state, not a permission.
  assert.match(
    leaderTurn({ mediationAvailable: true, mediationEvidence: ["candidate_concentration"] }),
    /- mediate: available \(the discussion state that opened it: candidate_concentration\)/,
  );

  // Availability is the discussion state, never the build-on counter: "mediate
  // every two build-ons" is arithmetic about when Alex speaks, and `docs/adr/0001`
  // holds that constant across conditions.
  assert.equal(mediationAvailableFor({ conditionCode: "C2", mediationLatched: true }), true);
  assert.equal(mediationAvailableFor({ conditionCode: "C4", mediationLatched: true }), true);
  assert.equal(mediationAvailableFor({ conditionCode: "C2", mediationLatched: false }), false);
  assert.equal(mediationAvailableFor({ conditionCode: "C1", mediationLatched: true }), false);
  assert.equal(mediationAvailableFor({ conditionCode: "C3", mediationLatched: true }), false);

  // The schema is the first lock, the routing seam the second — same two locks
  // the recap has.
  const asMediation = {
    decision: "speak",
    act: "mediate",
    selectedOpportunityId: null,
    evidence: "conversation_grounded_synthesis",
    discloseTraitIds: [],
    focusCandidate: "B",
    brief: "say where the discussion stands and what it has not reached",
    evidenceSeqs: [2],
  };
  assert.equal(ledgerJudgeSchemaFor("C1").safeParse(asMediation).success, false);
  assert.equal(ledgerJudgeSchemaFor("C3").safeParse(asMediation).success, false);
  assert.equal(ledgerJudgeSchemaFor("C2").safeParse(asMediation).success, true);
  assert.equal(ledgerRouteKindForAct("mediate", "C2"), "mediation");
  assert.equal(ledgerRouteKindForAct("mediate", "C4"), "mediation");
  assert.equal(ledgerRouteKindForAct("mediate", "C1"), "build_on");
  assert.equal(ledgerRouteKindForAct("mediate", "C3"), "build_on");

  const validateMediation = (over: Record<string, unknown>, mediationAvailable: boolean) =>
    validateConversationLedgerJudgeDecision({
      decision: { ...asMediation, ...over } as any,
      state: { ...twoRequests, currentTriggerSeq: 2, contextThroughSeq: 2 },
      eligibleTraitIds: ["A_p1"],
      transcriptSeqs: new Set([1, 2]),
      cooldownAvailable: true,
      mediationAvailable,
    });
  assert.equal(validateMediation({}, true).ok, true, "an offered mediation is accepted");
  assert.ok(
    validateMediation({}, false).ruleCodes.includes("mediation_unavailable_this_turn"),
    "a mediation nobody offered is rejected",
  );
  // Mediation is about the shape of the discussion, not its contents.
  assert.ok(
    validateMediation({ discloseTraitIds: ["A_p1"] }, true).ruleCodes.includes(
      "mediation_names_a_trait",
    ),
  );
}

// ── Alex's own read of the candidates ──────────────────────────────────────
// [T-C2-051 seq 24-25] "Alex, why do you think D is the best?" — Alex had never
// said D was best, and answered "My current read is Candidate D" off the
// question's premise. The server computes that read from Alex's card and the
// board, and it reached nothing on that turn: the generator's cue is gated on
// four request kinds and the turn was classified as no request at all. It never
// fired once in the whole session. The Judge now holds the read on every turn.
{
  const board = (human: string[], ai: string[] = []) => ({
    byCandidate: Object.fromEntries(
      (["A", "B", "C", "D"] as const).map((candidate) => [
        candidate,
        { revealedIds: human.filter((id) => id.startsWith(`${candidate}_`)) },
      ]),
    ),
    aiSurfacedIds: ai,
  });

  // The read is over Alex's whole card plus the board, not the board alone, so
  // an empty board already has a shape: A, B and D level on four matches and two
  // misses each, C last on three and three. That is the hidden profile stated as
  // a sentence, and it is the inversion `docs/adr/0009` is about.
  const emptyBoard = board([]);
  assert.match(
    alexPreferenceNote(emptyBoard)!,
    /puts Candidate A, Candidate B and Candidate D together first, and Candidate C last/,
    "before anybody speaks, Alex's own card ranks the pooled answer last",
  );

  // Two misses only the humans hold, and A separates from B and D. Every
  // human-only trait for A, B and D is a miss and every one for C is a match, so
  // the board can only ever move in that direction — which is the design.
  const leaning = board(["B_n1", "D_n1"]);
  const note = alexPreferenceNote(leaning)!;
  assert.match(note, /puts Candidate A first/);
  assert.match(note, /Candidate C last/);
  assert.doesNotMatch(note, /\d/, "the read carries no number");
  assert.doesNotMatch(note, /ratio|score|match(es)?\b|miss(es)?\b/i, "nor the arithmetic in words");

  // The whole order, not the top of it. A group that narrows to two candidates
  // Alex does not lead with has to be answerable from this sentence alone —
  // T-C2-051 seq 27 narrowed to A and B.
  assert.match(note, /Candidate B and Candidate D together/, "every compared candidate is placed");

  // Ties are grouped rather than broken, because breaking one here would be the
  // server choosing a candidate. Three of C's four human-only matches bring it
  // level with the other three.
  assert.match(
    alexPreferenceNote(board(["C_p2", "C_p3", "C_p4"]))!,
    /leaves Candidate A, Candidate B, Candidate C and Candidate D together level/,
  );

  // The pooled answer reaching the front is the state the whole task is built to
  // produce, and the read says so plainly when it arrives.
  assert.match(
    alexPreferenceNote(board(["C_p2", "C_p3", "C_p4", "C_p5", "A_n1", "B_n1", "D_n1"]))!,
    /puts Candidate C first/,
  );

  // Condition-blind. Holding a view of the candidates is not owning the
  // discussion procedure; the role goal decides whether Alex offers it unasked.
  // Contrast `leaderCoverageNote` directly above, which is the leader's alone.
  const prompts = (["C1", "C2", "C3", "C4"] as const).map((conditionCode) =>
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode,
      revealStats: leaning,
    }),
  );
  for (const prompt of prompts) {
    assert.match(prompt, /- Your read: Weighing every requirement the same/);
  }
  assert.equal(
    new Set(prompts.map((prompt) => prompt.match(/- Your read: [^\n]+/)![0])).size,
    1,
    "all four conditions receive the identical read",
  );
  // No board, no sentence — the same rule the other two follow. "Nothing
  // separates them" is a claim about a board, and the replay eval has none.
  assert.doesNotMatch(
    buildLedgerJudgeUserMessage({
      messages: [{ seq: 2, senderRole: "humanY" as const, speaker: "Participant Y", content: "m2" }],
      state: twoRequests,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: [],
      conditionCode: "C2",
    }),
    /- Your read:/,
    "a Judge with no board is told nothing about the read, not told it is level",
  );
  // And the rule that tells the Judge what it may do with the line.
  assert.match(LEDGER_JUDGE_SYSTEM, /your own read of the candidates/);
  assert.match(LEDGER_JUDGE_SYSTEM, /answer inside that set/);
  assert.match(LEDGER_JUDGE_SYSTEM, /never put a count, a ratio or a score in the brief/);
}

// ── A candidate Alex has nothing further on is named, not left blank ────────
// [T-C2-050 seq 19] All six of Alex's Candidate A traits were on the board by
// seq 17. The group came back to A, the Judge focused A, and for the trait ids
// it emitted `["A"]` — the bare candidate letter. No A id was left to emit and
// nothing said so; the decision was rejected and the turn broadcast nothing.
{
  const spentOnC = exhaustedCandidateNote(
    ["A_p1", "A_n5", "B_p3", "D_p1", "D_n6"],
    ["C", "A", "B", "D"],
  );
  assert.match(spentOnC!, /card about Candidate C is already on the board/);
  assert.match(spentOnC!, /still hold is about Candidate A, Candidate B, Candidate D/);
  assert.doesNotMatch(spentOnC!, /\d/, "the card note carries no count");
  // Nothing left anywhere in scope is its own reading. Going quiet here is what
  // produced the invented trait: the Judge had no sentence telling it the shelf
  // was empty, only fifteen ids that happened to start with other letters.
  assert.match(
    exhaustedCandidateNote([], ["C"])!,
    /this thread covers nothing else\. You hold no unsurfaced fact to add here/,
  );
  // A full card says nothing at all — the note reports an absence, and inventing
  // one where there is none would make it noise on most turns.
  assert.equal(exhaustedCandidateNote(["C_p1"], ["C"]), null);
  assert.equal(exhaustedCandidateNote(["A_p1"], []), null);

  // Condition-blind, and it must stay so. This is Alex's own card, which every
  // condition already receives in full; `leaderCoverageNote` reports the group's
  // coverage and is the leader's alone.
  // A board has to be present for either board-derived sentence to be emitted;
  // what is in it does not matter for the card note, which reads the eligible
  // list. Absence means "board unknown", not "board empty".
  const anyBoard = { byCandidate: { A: { revealedIds: ["A_p1"] } }, aiSurfacedIds: [] };
  // The fixture's thread is scoped to A and B; the note reports the thread's
  // scope, so widen it to the whole board the way a comparison phase is.
  const wholeBoardThread: ConversationLedgerState = {
    ...twoRequests,
    threads: twoRequests.threads.map((thread) => ({
      ...thread,
      candidates: ["A", "B", "C", "D"],
      scopeCandidates: ["A", "B", "C", "D"],
    })),
  };
  const cardPromptFor = (conditionCode: "C1" | "C2" | "C3" | "C4") =>
    buildLedgerJudgeUserMessage({
      messages: [16, 17, 20, 21].map((seq) => ({
        seq,
        senderRole: "humanY" as const,
        speaker: "Participant Y",
        content: `m${seq}`,
      })),
      state: wholeBoardThread,
      cooldownAvailable: true,
      backchannelAvailable: true,
      eligibleTraitIds: ["A_p1", "B_p3", "D_p1"],
      conditionCode,
      // The card note describes the board, so it needs one present. What is in
      // it does not matter here — the spent candidate is read from the eligible
      // list — but its absence means "no board", which suppresses both notes.
      revealStats: anyBoard,
    });
  for (const conditionCode of ["C1", "C2", "C3", "C4"] as const) {
    assert.match(
      cardPromptFor(conditionCode),
      /- Your card: Everything on your card about Candidate C is already on the board/,
      `${conditionCode}: the Judge is told which candidate Alex has spent`,
    );
  }

  // An empty eligible list has two causes, and only one of them is "Alex has
  // nothing left to say". `eligibleTraitIdsForLedgerState` also returns nothing
  // when the foreground thread has been resolved or superseded — a turn the
  // observer is instructed to produce whenever the group finishes with a
  // candidate. Reading that emptiness as exhaustion told the Judge, in plain
  // words, that every candidate was spent while Alex still held its whole card.
  // Found by review before it reached a session; both readers take the liveness
  // test from `liveForegroundThread` now.
  for (const status of ["resolved", "superseded"] as const) {
    const closed: ConversationLedgerState = {
      ...wholeBoardThread,
      threads: wholeBoardThread.threads.map((thread) => ({ ...thread, status })),
    };
    assert.deepEqual(
      eligibleTraitIdsForLedgerState(closed, new Set()),
      [],
      `fixture check: a ${status} foreground thread makes nothing eligible`,
    );
    assert.doesNotMatch(
      buildLedgerJudgeUserMessage({
        messages: [{ seq: 21, senderRole: "humanY", speaker: "Participant Y", content: "m21" }],
        state: closed,
        cooldownAvailable: true,
        backchannelAvailable: true,
        eligibleTraitIds: [],
        conditionCode: "C1",
        revealStats: anyBoard,
      }),
      /- Your card:/,
      `a ${status} thread empties the list for a reason that is not Alex's card, and says nothing`,
    );
  }
}

// ── A rejected trait choice is told which ids it may name ───────────────────
// [T-C2-050 seq 14] Two C traits were still eligible. The first attempt named
// one of them next to `C_p1`, already on the board since seq 11, and was
// rejected for the spent id. The retry was handed the rule code and nothing
// else, and answered with `C_p1` again plus `C_p2` — a trait on no card Alex
// holds. The turn was lost to `ledger_judge_failure`.
//
// Asserted against the message the model actually receives. The first version of
// this block asserted only that a string was a member of a constant, and passed
// with the whole retry expression deleted — the sixth vacuous first attempt in
// this repair.
{
  const retry = (over: Partial<Parameters<typeof ledgerJudgeRetryMessage>[0]>) =>
    ledgerJudgeRetryMessage({
      user: "USER-BODY",
      priorDecisionJson: '{"decision":"speak"}',
      priorRuleCodes: [],
      priorDiscloseTraitIds: [],
      requiredOpportunityIds: [],
      eligibleTraitIds: [],
      ...over,
    });

  // (a) The ids reach the model, by name.
  const named = retry({
    priorRuleCodes: ["disclose_trait_not_eligible"],
    priorDiscloseTraitIds: ["C_p1", "C_p2"],
    eligibleTraitIds: ["C_n2", "C_n3"],
  });
  assert.match(named, /only ids you may put in discloseTraitIds are: C_n2, C_n3/);
  assert.match(named, /USER-BODY/, "the retry carries the whole turn, not only the correction");

  // (b) Nothing left: the prohibition alone is not enough. An ordered-empty list
  // under `relevant_unsurfaced_information` trips `relevant_fact_trait_invalid`
  // on the second and last attempt, which loses the turn to the same failure the
  // retry was sent to repair. So the way out is named too.
  const nothingLeft = retry({
    priorRuleCodes: ["disclose_trait_not_eligible"],
    priorDiscloseTraitIds: ["A_p1"],
    eligibleTraitIds: [],
  });
  assert.match(nothingLeft, /discloseTraitIds must be empty/);
  assert.match(nothingLeft, /choose different evidence, or stay silent/);

  // (c) An unrelated rejection leaves the trait sentence out entirely.
  const unrelated = retry({ priorRuleCodes: ["brief_too_long"] });
  assert.doesNotMatch(unrelated, /discloseTraitIds/);

  // (d) `relevant_fact_trait_invalid` fires for two different reasons. With a
  // non-empty list the ids were legal and the act was not, so pointing at the
  // ids would send the model back to the field it got right.
  const wrongAct = retry({
    priorRuleCodes: ["relevant_fact_trait_invalid"],
    priorDiscloseTraitIds: ["A_p1"],
    eligibleTraitIds: ["A_p1", "B_p3"],
  });
  assert.match(wrongAct, /goes with act "contribute"/);
  assert.doesNotMatch(wrongAct, /only ids you may put/);
  const emptyList = retry({
    priorRuleCodes: ["relevant_fact_trait_invalid"],
    priorDiscloseTraitIds: [],
    eligibleTraitIds: ["A_p1", "B_p3"],
  });
  assert.match(emptyList, /only ids you may put in discloseTraitIds are: A_p1, B_p3/);

  // (e) A duplicate is not fixed by being shown the list it was already drawn
  // from, so it gets its own sentence.
  assert.match(
    retry({ priorRuleCodes: ["disclose_trait_repeated"], eligibleTraitIds: ["A_p1"] }),
    /Name each id at most once/,
  );

  // (f) The required-opportunity hint still composes with the trait hint.
  const both = retry({
    priorRuleCodes: ["current_required_opportunity_not_selected", "disclose_trait_not_eligible"],
    requiredOpportunityIds: ["opp:20:direct_question:alex"],
    eligibleTraitIds: ["A_p1"],
  });
  assert.match(both, /Set selectedOpportunityId to one of: opp:20:direct_question:alex/);
  assert.match(both, /only ids you may put in discloseTraitIds are: A_p1/);

  // (g) The tail no longer orders a field the schema does not have. It sat
  // directly after the sentence naming disclosable ids and said to name none.
  assert.doesNotMatch(retry({ priorRuleCodes: ["brief_missing"] }), /selectedTraitId/);

  // Two codes must stay OUT of the eligible-ids hint: on an acknowledgement and
  // on a silence the only legal list is the empty one, so naming what may be
  // disclosed says the opposite of the rule.
  for (const excluded of ["trait_present_on_acknowledgement", "trait_present_without_speech"]) {
    assert.ok(
      !LEDGER_JUDGE_TRAIT_RETRY_RULE_CODES.includes(excluded),
      `${excluded} must not receive the eligible-ids hint: its only legal list is empty`,
    );
  }
}

// ── The brief may not invent a way to decide ────────────────────────────────
// The rule the two sessions broke is stated to the Judge now, in the paragraph
// that defines the brief. Equal weighting is a control variable: a brief that
// proposes a cutoff or groups traits into kinds moves it.
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /Never write a brief that proposes a rule, a criterion, a threshold, a cutoff, or a way of grouping traits into kinds/,
);
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /never write one that assumes any trait outweighs, offsets, or disqualifies another/,
);
// Forbidding alone leaves the turn empty, which is how the invention started —
// every worked example was request-shaped and no example covered a turn nobody
// asked for. The replacement move is stated too.
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /Not every turn answers a request/,
);
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /nobody else has put anything of their own on A, so bring A back into the discussion/,
);
// The example has to say "of their own", because the sentence it answers does.
// Since `docs/adr/0011` a candidate stays on the list until a human pools
// something about it, so Alex can have emptied its whole card on a candidate the
// list still names — T-C2-051 said everything it held about A at seq 17 and A
// stayed live to seq 39. A brief reading "nobody has put anything on A yet"
// would be false on that turn, and a Judge acting on it would look for a trait
// to disclose and find none, which is the T-C2-050 seq 19 failure the card note
// exists for. So the rule says the turn is for the group's attention and names
// no trait.
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /even when your own card on that candidate is spent/,
);
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /a turn with nothing left to disclose names no trait/,
);
// And the wording tracks what the server actually sends. The coverage sentence
// says "Nobody has brought anything from their own notes about …"; a rule
// describing a different sentence is a rule about a build nobody ships.
{
  const boardWithOnePooled = {
    byCandidate: {
      A: { revealedIds: [] },
      B: { revealedIds: ["B_n1"] },
      C: { revealedIds: [] },
      D: { revealedIds: [] },
    },
    aiSurfacedIds: [] as string[],
  };
  const sentence = leaderCoverageNote("C2", boardWithOnePooled)!;
  assert.match(sentence, /Nobody has brought anything from their own notes about/);
  assert.match(
    LEDGER_JUDGE_SYSTEM,
    /nobody has brought anything of their own about some candidates/,
    "the rule names the reading the sentence gives",
  );
  assert.match(LEDGER_JUDGE_SYSTEM, /no coverage gap left to name/);
  assert.match(
    leaderCoverageNote("C2", {
      byCandidate: Object.fromEntries(
        (["A", "B", "C", "D"] as const).map((candidate) => [
          candidate,
          { revealedIds: [candidate === "C" ? "C_p2" : `${candidate}_n1`] },
        ]),
      ),
      aiSurfacedIds: [],
    })!,
    /There is no coverage gap to name/,
  );
}
assert.match(
  LEDGER_JUDGE_SYSTEM,
  /Do not fill the turn by proposing how to decide/,
);
// Forbidding a procedure must not turn into deflecting the question. "How should
// we decide?" gets an answer — a position, not a method — because how the group
// proceeds is itself observed, and an Alex that refuses to engage removes the
// thing being measured.
assert.match(LEDGER_JUDGE_SYSTEM, /that is a real question and the brief must not duck it/);
assert.match(LEDGER_JUDGE_SYSTEM, /worth looking at the candidates properly before choosing/);
assert.match(LEDGER_JUDGE_SYSTEM, /how the group goes about it is up to them/);
// And the position stays a position: no bar, no count, no definition of "properly".
assert.match(LEDGER_JUDGE_SYSTEM, /no instruction to lay everything out or to count anything/);

// [T-C4-023] The validator above is only half of it. The rule was enforced and
// never stated: the same prompt that rejects an older request also listed the
// backlog "oldest first" and named no required id, so on seq 13, 46 and 48 the
// Judge reached back, was rejected, guessed again from the same list, and the
// turn was lost. Two of the three were "Alex can you give us a summary?", and
// each loss added another unanswered question to the backlog that caused it.
//
// The prompt must name the id the validator will demand. This asserts the two
// agree on this exact state — the one where they can disagree.
{
  const requiredNowPrompt = buildLedgerJudgeUserMessage({
    messages: [16, 17, 21].map((seq) => ({
      seq,
      senderRole: "humanY" as const,
      speaker: "Participant Y",
      content: `m${seq}`,
    })),
    state: requiredNowWithOlderRequest,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
  });
  assert.match(
    requiredNowPrompt,
    /You must select one of these, opened by the message you are judging: opp:21:direct_question:alex/,
    "the Judge is told which opportunity this turn requires, not only rejected for missing it",
  );
  assert.match(
    requiredNowPrompt,
    /taking one of them instead is rejected/,
    "and told that the older list below it is context, since that list is what it reached for",
  );
  // The required ids in the prompt are the ids the validator demands, from one
  // function, so a future edit cannot move one without the other.
  assert.deepEqual(
    currentRequiredOpportunityIdsFor(requiredNowWithOlderRequest),
    ["opp:21:direct_question:alex"],
  );
  // A turn that requires nothing must not grow a phantom requirement.
  const nothingRequiredPrompt = buildLedgerJudgeUserMessage({
    messages: [16, 17].map((seq) => ({
      seq,
      senderRole: "humanY" as const,
      speaker: "Participant Y",
      content: `m${seq}`,
    })),
    state: twoRequests,
    cooldownAvailable: true,
    backchannelAvailable: true,
    eligibleTraitIds: [],
  });
  assert.match(nothingRequiredPrompt, /No opportunity is required this turn\./);
  assert.doesNotMatch(nothingRequiredPrompt, /You must select one of these/);
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
  "a persistent thread still creates one stable opportunity",
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
    discloseTraitIds: [],
    focusCandidate: null,
    brief: "answer what they just asked",
    evidenceSeqs: [1, 12],
  },
  state: standingReduced.state,
  eligibleTraitIds: [],
  transcriptSeqs: new Set([1, 4, 9, 12]),
});
assert.equal(requiredStandingSelection.ok, true);
// The opportunity stands and is selectable. What it is not is an obligation.
// `alexParticipation: "required"` used to make this one, and with it came the
// strongest powers in the ledger: bypass the cooldown unconditionally, never
// expire, never be swept, and the Judge may not stay silent on it. The field is
// a coin flip — the same script gave "invited" against "required" 8:19 in
// T-C2-050, 19:9 in T-C2-051 and 2:27 in T-C2-052 — and this branch mints from a
// thread being open rather than from anybody asking. An obligation to answer
// comes from somebody asking Alex, which the speech act and the addressee
// settle. Staying silent here is now a choice the Judge is allowed to make.
assert.equal(
  standingReduced.state.opportunities.find((item) => item.id === standingId)!.expectation,
  "invited",
  "a thread does not oblige Alex to speak, however involved a model thinks Alex is",
);
assert.equal(
  validateConversationLedgerJudgeDecision({
    decision: {
      decision: "silent",
      act: null,
      selectedOpportunityId: null,
      evidence: "no_useful_move",
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "",
      evidenceSeqs: [12],
    },
    state: standingReduced.state,
    eligibleTraitIds: [],
    transcriptSeqs: new Set([1, 4, 9, 12]),
  }).ruleCodes.includes("current_required_opportunity_not_selected"),
  false,
);
// And it no longer speaks through the cooldown. A request put to the room waits
// its turn, which is what the group-request assertions above already said for
// the branch that reads an explicit address.
assert.equal(
  opportunityMayBypassCooldown(
    { ...standingReduced.state, foregroundThreadId: "candidate-comparison" },
    standingReduced.state.opportunities.find((item) => item.id === standingId)!,
  ),
  false,
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
    discloseTraitIds: [],
    focusCandidate: null,
    brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
  discloseTraitIds: [],
  focusCandidate: null,
  brief: "",
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
      discloseTraitIds: ["A_p1"],
      focusCandidate: null,
      brief: "answer what they just asked",
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
        discloseTraitIds: [],
        focusCandidate: null,
        brief: "",
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
    discloseTraitIds: [],
    focusCandidate: null,
    brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
      discloseTraitIds: [],
      focusCandidate: null,
      brief: "answer what they just asked",
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
  discloseTraitIds: ["A_p2"],
  focusCandidate: null,
  brief: "answer what they just asked",
  evidenceSeqs: [18],
});
// The clearing this block used to assert is gone with `docs/adr/0010`. Naming a
// fact was coupled to one evidence value, so a fact named under any other was
// inert and got emptied; now the Judge decides what the turn may disclose on
// every act, so the same list is a real instruction and is kept. What was a
// repair is a validation question instead: the list must be Alex's to name.
assert.deepEqual(
  strayTrait.decision.discloseTraitIds,
  ["A_p2"],
  "a fact named under another evidence value is no longer emptied",
);
assert.equal(strayTrait.decision.act, "follow", "the decision itself is untouched");
assert.deepEqual(
  strayTrait.repairCodes,
  [],
  "and nothing is repaired, because nothing about it is a shape error",
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
  discloseTraitIds: ["C_n1"],
  focusCandidate: null,
  brief: "answer what they just asked",
  evidenceSeqs: [10],
});
assert.deepEqual(
  carriedTrait.decision.discloseTraitIds,
  ["C_n1"],
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
      discloseTraitIds: ["Z_z9"],
      focusCandidate: null,
      brief: "answer what they just asked",
      evidenceSeqs: [10],
    }).decision,
    state: gate3State,
    eligibleTraitIds: ["C_n1"],
    transcriptSeqs: new Set([10, 21]),
    cooldownAvailable: true,
  }).ruleCodes.includes("disclose_trait_not_eligible"),
  // Same rejection, renamed reason. Eligibility used to be checked only under
  // one evidence value, folded into `relevant_fact_trait_invalid`; it is now
  // checked on every act, because every act may name a fact.
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

// The floor is checked twice — once here, before the Judge is called, and once
// after it has decided — so the flag has to reach both. T-C2-050 ran with
// `HAIT_GUARD_HUMAN_FLOOR=off` and still lost three turns to the second check:
// the Judge was consulted, decided to speak, and the decision was thrown away
// by a guard the run had switched off. A flag that silences one of a check's
// two sites measures half a check.
{
  process.env.HAIT_GUARD_HUMAN_FLOOR = "off";
  try {
    assert.equal(
      humanFloorHeld(floorHeld),
      true,
      "the floor itself is unchanged; only whether it vetoes is flagged",
    );
    assert.equal(
      deterministicVetoBeforeJudge(floorHeld, { cooldownAvailable: true }),
      null,
      "with the guard off the turn reaches the Judge",
    );
    assert.equal(
      ledgerSpeechBlockedByHumanFloor(floorHeld),
      false,
      "and the Judge's decision is not thrown away after it is made",
    );
    // Review found two more readers after the first two were flagged. The
    // cooldown bypass ended in `!humanFloorHeld(state)`, so a floor-held turn
    // whose only option was an invited uptake was still killed — and the row
    // was written with silenceReason "cooldown", attributing the loss to the
    // wrong check. The required-request validator read it too, relaxing the
    // rule that forces Alex to answer a direct question.
    assert.equal(
      floorHeldForDecisions(floorHeld),
      false,
      "every decision site reads one predicate, and it is off",
    );
  } finally {
    forceGuardsOnForTest();
  }
}
assert.equal(
  ledgerSpeechBlockedByHumanFloor(floorHeld),
  true,
  "guard back on: a held human floor still blocks the decided turn",
);
assert.equal(
  floorHeldForDecisions(floorHeld),
  true,
  "guard back on: the shared predicate reports the floor again",
);
// Four sites, one predicate. The unflagged reading stays inside the file that
// defines it; every other module asks the flagged question. A fifth reader added
// later must do the same, or a comparison run measures a check it asked to
// switch off — which is what T-C2-050 did, losing three turns (seqs 26, 27, 41)
// with `HAIT_GUARD_HUMAN_FLOOR=off` recorded on every row.
{
  const libDir = new URL("../lib/", import.meta.url);
  const unflagged = readdirSync(libDir)
    .filter((name) => name.endsWith(".ts") && name !== "conversationLedger.ts")
    .filter((name) =>
      /\b(?:humanFloorHeld|floorReadingIsHumanHeld)\s*\(/.test(
        readFileSync(new URL(name, libDir), "utf8"),
      ),
    );
  assert.deepEqual(
    unflagged,
    [],
    `these modules read the floor without the guard flag: ${unflagged.join(", ")}`,
  );
}

// The cooldown had the same shape and nobody had checked it. `guardEnabled` was
// imported into `interventionEngine.ts` and never called, so the flag reached the
// veto before the Judge and not the one after it: a run with
// `HAIT_GUARD_COOLDOWN=off` would have lost turns to a check its own record said
// was disabled. An import with no call is the tell.
{
  const libDir = new URL("../lib/", import.meta.url);
  const engine = readFileSync(new URL("interventionEngine.ts", libDir), "utf8");
  assert.match(
    engine,
    /guardEnabled\("cooldown"\)/,
    "interventionEngine reads the cooldown flag rather than only importing it",
  );
  // Every module that vetoes on the cooldown asks the flagged question. The
  // check is the pairing: a file that tests `!cooldownAvailable` must also name
  // the flag.
  const unflagged = readdirSync(libDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const body = readFileSync(new URL(name, libDir), "utf8");
      return /!\s*cooldownAvailable/.test(body) && !/guardEnabled\("cooldown"\)/.test(body);
    });
  assert.deepEqual(
    unflagged,
    [],
    `these modules veto on the cooldown without the guard flag: ${unflagged.join(", ")}`,
  );
}

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
    discloseTraitIds: ["A_p1"],
    focusCandidate: null,
    brief: "answer what they just asked",
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
      discloseTraitIds: ["A_p1"],
      focusCandidate: null,
      brief: "answer what they just asked",
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
