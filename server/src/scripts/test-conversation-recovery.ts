import assert from "node:assert/strict";
import { mock } from "node:test";
import { Responses } from "openai/resources/responses/responses";
import { config } from "../config.js";
import { ConversationObservation } from "../models/ConversationObservation.js";
import { Message } from "../models/Message.js";
import { Participant } from "../models/Participant.js";
import {
  enqueueConversationObservation, liveObservationAnchorSeq, normalizeConversationObservation,
  reduceConversationStateAfter, type ConversationObserverResult,
} from "../lib/conversationObserver.js";
import {
  observerDeltaFromTurn, reduceConversationLedger, withOpportunityTransition,
  type ConversationLedgerState,
} from "../lib/conversationLedger.js";
import { validateConversationLedgerJudgeDecision } from "../lib/interventionJudge.js";
import { buildRouteUserContext, type SelectedOpportunityGenerationContext } from "../lib/routeContext.js";

const roster = ["alex", "humanX", "humanY"] as const;
const observation: ConversationObserverResult = {
  addressees: ["alex"], replyToSeq: null, speechAct: "question",
  activeCandidates: ["A", "B"], mentionedCandidates: ["A", "B"], scopeCandidates: ["A", "B"],
  focusCandidate: "B", focusBasis: "carried_thread", threadGoal: "compare",
  requestedScope: "multiple_candidates", requestExplicitness: "explicit",
  transitionState: "transition_available", relationToPendingAlexQuestion: "unrelated",
  expectedHumanResponder: null, conversationPhase: "comparison", alexRelation: "explicit_addressee",
  alexRelevance: "required", activeThread: {
    threadId: "thread-1", rootSeq: 1, status: "open", goal: "compare_information",
    requestedAction: "compare A and B", requestedScope: "multiple_candidates", candidates: ["A", "B"],
    participants: [...roster], expectedResponders: ["alex"], alexParticipation: "required", evidenceSeqs: [1],
  },
  floor: { holder: "open", expectedNext: [], transition: "available" },
  fieldConfidence: { threading: 1, addressee: 1, floor: 1, alexRelation: 1 }, confidence: 1,
  requestIntent: { kind: "compare_request", candidate: null, candidates: ["A", "B"], source: "visible_board", countKind: "all" },
  opportunityTransitions: [],
};
function reduce(previous: ConversationLedgerState | null, seq: number, patch: Partial<ConversationObserverResult> = {}) {
  return reduceConversationLedger(previous, observerDeltaFromTurn({
    sessionKey: "recovery-test", observerVersion: "test", roster, sourceRole: "humanX",
    currentTriggerSeq: seq, contextThroughSeq: seq, observation: { ...observation, ...patch },
  })).state;
}
const initial = reduce(null, 1);
const id = initial.opportunities[0]!.id;
const quiet: Partial<ConversationObserverResult> = {
  speechAct: "other", addressees: [], requestExplicitness: "none", requestIntent: null,
  alexRelation: "unrelated", activeThread: null,
};
for (const content of ["Alex, thanks.", "Alex, Y부터 듣자.", "Don't let Y answer; Alex, please answer now."]) {
  const semantic = { ...observation, ...quiet };
  const normalized = normalizeConversationObservation(semantic, false, "humanX", content, 2, new Set([1, 2]));
  assert.equal(reduce(null, 2, normalized).opportunities.length, 0, "normalization cannot invent a question from wording");
}
// CHANGED 2026-09-07 (Gate B9). This previously asserted `floor.holder ===
// "humanY"` under the label "addressing Alex cannot cancel the observed human
// floor". That invariant cannot stand alongside Gate 1: the same signal
// (`alexRelation === "explicit_addressee"`) mints an Alex opportunity, so a
// floor that still excludes Alex makes the ledger contradict itself. T-C1-023
// turns 3-5 lost three consecutive turns to exactly that contradiction — an
// open invitation Alex was forbidden to answer.
//
// The invariant that survives is narrower and is the one actually worth having:
// a turn that addresses Alex makes the floor *shared*, not Alex's. The human
// keeps first position; Alex is merely allowed to answer the request addressed
// to it. The exclusive-floor case is asserted separately below on a turn that
// does not address Alex at all.
const shared = normalizeConversationObservation({ ...observation, addressees: ["alex", "humanY"], expectedHumanResponder: "humanY", floor: { holder: "humanY", expectedNext: ["humanY"], transition: "held" } }, false);
assert.equal(shared.floor.holder, "open", "a request addressed to Alex cannot leave a human holding an exclusive floor");
assert.deepEqual(
  shared.floor.expectedNext,
  ["humanY", "alex"],
  "the solicited human still goes first; Alex gets parity, not priority",
);

// T-C1-023 turns 3-5: the observer reported `addressees: ["humanY"]` while
// calling Alex the explicit addressee. Gate 1's derivation opens an Alex
// opportunity on that signal, so the floor must not simultaneously close.
const contradictoryAddress = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanY"],
    alexRelation: "explicit_addressee",
    speechAct: "proposal",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanY",
    floor: { holder: "humanY", expectedNext: ["humanY"], transition: "held" },
  },
  false,
  "humanX",
  "Hello! I think it would be best to just go through what information we have on each candidate",
  3,
  new Set([1, 2, 3]),
  null,
  roster,
);
assert.equal(
  contradictoryAddress.floor.holder,
  "open",
  "an explicit-addressee relation opens the floor for Alex just as it opens an opportunity",
);
assert.ok(
  contradictoryAddress.floor.expectedNext.includes("alex"),
  "Alex is expected next alongside the named human",
);

// T-C2-037 turns 28 and 30. Both were second-person plural invitations — the
// room is one speaker, one other human and Alex, so they addressed both — and
// the observer resolved each to the single human with 0.9 confidence. That
// produced no Alex opportunity and, through expectedHumanResponder, a floor the
// router treats as an absolute veto: an explicit invitation became a
// prohibition. Address resolution here is structural, not a reading of intent.
const pluralInvitation = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanX"],
    alexRelation: "group_participant",
    speechAct: "question",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanX",
    floor: { holder: "humanX", expectedNext: ["humanX"], transition: "held" },
  },
  false,
  "humanY",
  "Is this what the two of you are feeling also?",
  28,
  new Set([28]),
  null,
  roster,
);
assert.ok(
  pluralInvitation.addressees.includes("alex") && pluralInvitation.addressees.includes("humanX"),
  "a second-person plural address names every other participant",
);
assert.equal(
  pluralInvitation.floor.holder,
  "open",
  "a request that addresses Alex too cannot leave a human holding an exclusive floor",
);
assert.ok(
  pluralInvitation.floor.expectedNext.includes("alex"),
  "both addressed participants are expected next",
);
const singularQuestion = normalizeConversationObservation(
  {
    ...observation,
    addressees: ["humanX"],
    alexRelation: "group_participant",
    speechAct: "question",
    requestExplicitness: "explicit",
    expectedHumanResponder: "humanX",
    floor: { holder: "humanX", expectedNext: ["humanX"], transition: "held" },
  },
  false,
  "humanY",
  "humanX, do you agree with that?",
  28,
  new Set([28]),
  null,
  roster,
);
assert.equal(
  singularQuestion.floor.holder,
  "humanX",
  "an ordinary human-to-human question still reserves that human's turn",
);
assert.ok(
  !singularQuestion.addressees.includes("alex"),
  "the plural rule does not fire on a singular address",
);
let priorState = reduceConversationStateAfter({ anchorSeq: 1, conversationEpoch: 1, observation: { ...observation, focusCandidate: null } });
for (let seq = 2; seq <= 4; seq++) {
  const normalized = normalizeConversationObservation(observation, false, "humanX", "그 지원자 얘기 계속하자", seq, new Set([1, 2, 3, 4]), priorState, roster);
  assert.equal(normalized.focusCandidate, "B");
  priorState = reduceConversationStateAfter({ previous: priorState, anchorSeq: seq, conversationEpoch: seq, observation: normalized });
}
assert.equal(normalizeConversationObservation({ ...observation, focusCandidate: null }, false, "humanX", "B", 5, undefined, priorState).focusCandidate, null, "explicit semantic null clears focus");
assert.deepEqual(normalizeConversationObservation({ ...observation, mentionedCandidates: ["B"] }, false, "humanX", "A good point about B.").mentionedCandidates, ["B"]);
const normalizedAssertion = normalizeConversationObservation({
  ...observation,
  speechAct: "answer",
  addressees: ["alex"],
  alexRelation: "explicit_addressee",
  replyToSeq: null,
  mentionedCandidates: ["A", "B"],
  focusCandidate: "A",
  focusBasis: "current_explicit",
  requestExplicitness: "explicit",
  requestedScope: "multiple_candidates",
}, false, "humanX", "For me it is between A and B.");
assert.deepEqual(normalizedAssertion.addressees, [], "Alex is not an explicit addressee without a name or reply target");
assert.equal(normalizedAssertion.requestExplicitness, "none", "a preference assertion is not normalized into a request");
assert.equal(normalizedAssertion.requestIntent, null);
assert.equal(normalizedAssertion.focusCandidate, null, "a multi-candidate assertion has no single explicit focus");
assert.equal(normalizedAssertion.focusBasis, "none");
assert.deepEqual(normalizedAssertion.mentionedCandidates, ["A", "B"]);
const normalizedAvailableFloor = normalizeConversationObservation({
  ...observation,
  floor: { holder: "open", expectedNext: ["humanX", "alex"], transition: "available" },
}, false, "humanX", "Candidate B is stronger.");
assert.deepEqual(normalizedAvailableFloor.floor.expectedNext, ["alex"], "the completed speaker is removed from an available floor prediction");
const closed = reduce(initial, 2, { ...quiet, activeThread: { ...observation.activeThread!, status: "resolved", evidenceSeqs: [1, 2] } });
assert.equal(closed.opportunities[0]!.status, "resolved_by_human");
assert.equal(reduce(closed, 3, quiet).foregroundThreadId, null);
assert.equal(validateConversationLedgerJudgeDecision({ state: { ...closed, opportunities: initial.opportunities }, eligibleTraitIds: [], transcriptSeqs: new Set([1, 2]), decision: {
  decision: "speak", act: "answer", selectedOpportunityId: id, evidence: "selected_open_opportunity", evidenceSeqs: [1], selectedTraitId: null,
} }).ok, false, "legacy stale open opportunities on closed threads cannot be selected");
for (const status of ["resolved_by_human", "withdrawn", "superseded", "deferred"] as const) {
  const state = reduce(initial, 2, { ...quiet, opportunityTransitions: [{ opportunityId: id, toStatus: status, reason: "observed resolution", evidenceSeqs: [2], correctedThreadId: null }] });
  assert.equal(state.opportunities[0]!.status, status, "lifecycle is applied even with no foreground thread");
  const reopened = reduce(state, 3, { ...quiet, activeThread: observation.activeThread, opportunityTransitions: [{ opportunityId: id, toStatus: "open", reason: "corrected interpretation", evidenceSeqs: [3], correctedThreadId: null }] });
  assert.equal(reopened.opportunities[0]!.status, "open");
}
const corrected = reduce(initial, 1, { activeThread: { ...observation.activeThread!, threadId: "corrected" } });
assert.equal(corrected.opportunities[0]!.threadId, "corrected");
const relinked = reduce(initial, 2, { ...quiet, activeThread: { ...observation.activeThread!, threadId: "corrected" }, opportunityTransitions: [{ opportunityId: id, toStatus: "open", reason: "repair old association", evidenceSeqs: [2], correctedThreadId: "corrected" }] });
assert.equal(relinked.opportunities[0]!.threadId, "corrected");
const consumed = withOpportunityTransition(initial, { opportunityId: id, toStatus: "consumed_by_alex", reason: "sent", broadcastSucceeded: true, alexBroadcastSeq: 2 }).state;
assert.equal(reduce(consumed, 3, { ...quiet, opportunityTransitions: [{ opportunityId: id, toStatus: "open", reason: "bad reinterpretation", evidenceSeqs: [3], correctedThreadId: null }] }).opportunities[0]!.status, "consumed_by_alex");
const invalid = reduce(initial, 2, { ...quiet, opportunityTransitions: [{ opportunityId: id, toStatus: "withdrawn", reason: "future evidence", evidenceSeqs: [99], correctedThreadId: null }] });
assert.equal(invalid.opportunities[0]!.status, "open");

const context: SelectedOpportunityGenerationContext = {
  id, kind: "direct_question", expectation: "required", sourceSeq: 1, currentTriggerSeq: 1,
  threadId: "thread-1", targets: ["alex"], requestedAction: "compare A and B", sourceContent: "", evidenceSeqs: [1], requestIntent: initial.opportunities[0]!.requestIntent,
};
const intents = ["Alex, compare A and B.", "Alex, how do A and B stack up against each other?"].map((content) => buildRouteUserContext({
  routeKind: "address", conditionCode: "C2", messages: [{ seq: 1, senderRole: "humanX", speaker: "X", content }], revealStats: {}, language: "en", anchorSeq: 1,
  selectedOpportunity: { ...context, sourceContent: content },
}).requestIntent);
assert.deepEqual(intents[0], intents[1]);
assert.equal(intents[0]!.source, "visible_board");

// Exercise the actual queued DB/observer pipeline with deterministic transport and persistence doubles.
// No network or database access occurs. A failed observation is deliberately the latest record.
const records: any[] = [{ sessionId: "recovery-test", anchorSeq: 1, stateAfter: priorState, ledgerStateAfter: initial }];
const messages = [1, 3, 4].map((seq) => ({ seq, senderRole: "humanX", content: seq === 1 ? "Compare A and B" : "Never mind that request" }));
const query = (value: unknown) => ({ sort() { return this; }, select() { return this; }, lean: async () => value });
let parseCalls = 0;
const oldMode = config.conversationObserverMode;
const oldKey = config.openaiApiKey;
try {
  config.conversationObserverMode = "active";
  config.openaiApiKey = "test-no-network";
  mock.method(Message, "find", (filter: any) => query(messages.filter((message) => message.seq <= filter.seq.$lte)) as any);
  mock.method(Participant, "find", () => query([{ role: "humanX" }, { role: "humanY" }]) as any);
  mock.method(ConversationObservation, "findOne", (filter: any) => query([...records].reverse().find((record) => record.anchorSeq < filter.anchorSeq.$lt && (!filter.stateAfter || record.stateAfter) && (!filter.ledgerStateAfter || record.ledgerStateAfter))) as any);
  mock.method(ConversationObservation, "updateOne", async (filter: any, update: any) => {
    let record = records.find((item) => item.anchorSeq === filter.anchorSeq);
    if (!record) { record = { ...filter }; records.push(record); }
    Object.assign(record, update.$set);
    return {} as any;
  });
  mock.method(Responses.prototype, "parse", (async (request: any) => {
    parseCalls++;
    if (parseCalls === 1) throw new Error("injected transient observer failure");
    assert.match(request.input[1].content, /opp:1:direct_question:alex/, "last successful ledger reaches the recovering observer");
    assert.match(request.input[1].content, /\[3\]/, "missed turn remains in the transcript");
    // Gate A3: the append-only transcript leads so it can form a cacheable
    // prefix; the per-turn state dumps follow it. Leading with the volatile
    // state is why the judge reported `cachedInputTokens: 0` on every call.
    assert.ok(
      request.input[1].content.indexOf("Complete conversation transcript") <
        request.input[1].content.indexOf("Previous cumulative state"),
      "the transcript precedes the volatile state in the observer prompt",
    );
    return { model: "test", output_parsed: { ...observation, ...quiet, opportunityTransitions: [{ opportunityId: id, toStatus: "withdrawn", reason: "request withdrawn during missed turn", evidenceSeqs: [3, 4], correctedThreadId: null }] } };
  }) as any);
  assert.equal(await enqueueConversationObservation({ sessionId: "recovery-test", anchorSeq: 3, conversationEpoch: 3, explicitAlexDefer: false }), null);
  const recovered = await enqueueConversationObservation({ sessionId: "recovery-test", anchorSeq: 4, conversationEpoch: 4, explicitAlexDefer: false });
  assert.equal(recovered?.ledgerStateAfter?.opportunities[0]?.status, "withdrawn");
  assert.equal(recovered?.ledgerStateAfter?.foregroundThreadId, null);
  assert.equal(recovered?.ledgerStateAfter?.degradedMode, false);
  assert.equal(parseCalls, 2);
} finally {
  mock.restoreAll();
  config.conversationObserverMode = oldMode;
  config.openaiApiKey = oldKey;
}
// --- Gate A1/A2: one live observation per session -----------------------------
//
// Observations run on a strictly serial per-session queue, so a burst of human
// messages costs the *sum* of their observation latencies ahead of the only
// turn whose answer is still wanted. T-C1-020 discarded 20 of 51 turns as
// superseded and reached a 31 s turn that way, each discarded turn having paid
// a full ~7 s observation first. A newer human message must now cancel the
// older observation, whether it is still queued or already in flight.
{
  const burstRecords: any[] = [
    { sessionId: "burst-test", anchorSeq: 1, stateAfter: priorState, ledgerStateAfter: initial },
  ];
  const burstMessages = [1, 5, 6].map((seq) => ({
    seq,
    senderRole: "humanX",
    content: seq === 1 ? "Compare A and B" : `burst message ${seq}`,
  }));
  const bq = (value: unknown) => ({ sort() { return this; }, select() { return this; }, lean: async () => value });
  const anchorsParsed: number[] = [];
  const oldMode2 = config.conversationObserverMode;
  const oldKey2 = config.openaiApiKey;
  try {
    config.conversationObserverMode = "active";
    config.openaiApiKey = "test-no-network";
    mock.method(Message, "find", (filter: any) => bq(burstMessages.filter((m) => m.seq <= filter.seq.$lte)) as any);
    mock.method(Participant, "find", () => bq([{ role: "humanX" }, { role: "humanY" }]) as any);
    mock.method(ConversationObservation, "findOne", (filter: any) => bq([...burstRecords].reverse().find((r) => r.anchorSeq < filter.anchorSeq.$lt && (!filter.stateAfter || r.stateAfter) && (!filter.ledgerStateAfter || r.ledgerStateAfter))) as any);
    mock.method(ConversationObservation, "updateOne", async (filter: any, update: any) => {
      let record = burstRecords.find((item) => item.anchorSeq === filter.anchorSeq);
      if (!record) { record = { ...filter }; burstRecords.push(record); }
      Object.assign(record, update.$set);
      return {} as any;
    });
    mock.method(Responses.prototype, "parse", (async (request: any, options: any) => {
      const anchor = Number(/Current anchor: \[(\d+)\]/.exec(request.input[1].content)?.[1] ?? 0);
      anchorsParsed.push(anchor);
      if (anchor === 5) {
        // Stand in for a call that is still in flight when the next human
        // message lands: it settles only when the request is aborted.
        return await new Promise((_resolve, reject) => {
          // Match the SDK: an already-aborted signal rejects at once rather
          // than waiting for an abort event that has already fired.
          if (options.signal.aborted) { reject(new Error("aborted")); return; }
          options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return { model: "test", output_parsed: { ...observation, ...quiet } };
    }) as any);

    // Case 1 — superseded while still queued: the call is never made at all.
    const queued5 = enqueueConversationObservation({ sessionId: "burst-test", anchorSeq: 5, conversationEpoch: 5, explicitAlexDefer: false });
    const queued6 = enqueueConversationObservation({ sessionId: "burst-test", anchorSeq: 6, conversationEpoch: 6, explicitAlexDefer: false });
    assert.equal(await queued5, null, "an observation superseded before it starts resolves to nothing");
    assert.ok(await queued6, "the newest anchor is still observed");
    assert.deepEqual(anchorsParsed, [6], "a superseded queued observation costs no model call");
    assert.equal(
      burstRecords.some((record) => record.anchorSeq === 5),
      false,
      "a superseded turn leaves no error row in the audit",
    );

    // Case 2 — superseded while in flight: the request is aborted, which is
    // what returns the serial queue slot to the turn that matters.
    anchorsParsed.length = 0;
    const inflight5 = enqueueConversationObservation({ sessionId: "burst-test", anchorSeq: 5, conversationEpoch: 5, explicitAlexDefer: false });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(anchorsParsed, [5], "the first observation did start");
    const newer6 = enqueueConversationObservation({ sessionId: "burst-test", anchorSeq: 6, conversationEpoch: 6, explicitAlexDefer: false });
    assert.equal(await inflight5, null, "an in-flight observation is abandoned when a newer message arrives");
    assert.ok(await newer6, "the newer anchor completes behind it");
    assert.deepEqual(anchorsParsed, [5, 6], "the newer observation is not blocked by the abandoned one");
    assert.equal(
      burstRecords.some((record) => record.anchorSeq === 5),
      false,
      "an aborted observation still writes no row",
    );

    // A re-observation of the same anchor must never cancel the observation it
    // is refining, so the guard is strictly-newer only.
    assert.equal(liveObservationAnchorSeq("burst-test"), null, "the live handle is released when the queue drains");
  } finally {
    mock.restoreAll();
    config.conversationObserverMode = oldMode2;
    config.openaiApiKey = oldKey2;
  }
}

console.log("[conversation-recovery] semantic authority, lifecycle, generation, observer failure recovery and burst supersession passed");
