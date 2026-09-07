import assert from "node:assert/strict";
import { mock } from "node:test";
import { Responses } from "openai/resources/responses/responses";
import { config } from "../config.js";
import { ConversationObservation } from "../models/ConversationObservation.js";
import { Message } from "../models/Message.js";
import { Participant } from "../models/Participant.js";
import {
  enqueueConversationObservation, normalizeConversationObservation,
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
const held = normalizeConversationObservation({ ...observation, addressees: ["alex", "humanY"], expectedHumanResponder: "humanY", floor: { holder: "humanY", expectedNext: ["humanY"], transition: "held" } }, false);
assert.equal(held.floor.holder, "humanY", "addressing Alex cannot cancel the observed human floor");
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
console.log("[conversation-recovery] semantic authority, lifecycle, generation and observer failure recovery passed");
