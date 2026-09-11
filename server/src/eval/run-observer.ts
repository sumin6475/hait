import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  observeConversationStructure,
  pendingAlexQuestion,
  type ConversationObserverResult,
  type ObserverTranscriptMessage,
} from "../lib/conversationObserver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS = 3;

interface ObserverCase {
  id: string;
  desc: string;
  anchorSeq: number;
  context: Array<{
    seq: number;
    senderRole: string;
    speaker: string;
    text: string;
  }>;
  expect: {
    speechAct?: ConversationObserverResult["speechAct"];
    addresseeIncludes?: ConversationObserverResult["addressees"][number];
    activeCandidates?: Array<"A" | "B" | "C" | "D">;
    threadGoal?: ConversationObserverResult["threadGoal"];
    requestedScope?: ConversationObserverResult["requestedScope"];
    requestExplicitness?: ConversationObserverResult["requestExplicitness"];
    transitionState?: ConversationObserverResult["transitionState"];
    relationToPendingAlexQuestion?: ConversationObserverResult["relationToPendingAlexQuestion"];
    expectedHumanResponder?: ConversationObserverResult["expectedHumanResponder"];
    alexRelation?: ConversationObserverResult["alexRelation"];
    activeThreadGoal?: NonNullable<ConversationObserverResult["activeThread"]>["goal"];
    alexParticipation?: NonNullable<ConversationObserverResult["activeThread"]>["alexParticipation"];
  };
}

const file = yaml.load(readFileSync(resolve(__dirname, "observer_cases.yaml"), "utf8")) as {
  cases: ObserverCase[];
};

function matches(actual: ConversationObserverResult, expected: ObserverCase["expect"]): boolean {
  if (expected.speechAct && actual.speechAct !== expected.speechAct) return false;
  if (expected.addresseeIncludes && !actual.addressees.includes(expected.addresseeIncludes)) {
    return false;
  }
  if (expected.transitionState && actual.transitionState !== expected.transitionState) return false;
  if (expected.threadGoal && actual.threadGoal !== expected.threadGoal) return false;
  if (expected.requestedScope && actual.requestedScope !== expected.requestedScope) return false;
  if (
    expected.requestExplicitness &&
    actual.requestExplicitness !== expected.requestExplicitness
  ) {
    return false;
  }
  if (
    expected.relationToPendingAlexQuestion &&
    actual.relationToPendingAlexQuestion !== expected.relationToPendingAlexQuestion
  ) {
    return false;
  }
  if (
    expected.expectedHumanResponder !== undefined &&
    actual.expectedHumanResponder !== expected.expectedHumanResponder
  ) {
    return false;
  }
  if (expected.alexRelation && actual.alexRelation !== expected.alexRelation) return false;
  if (expected.activeThreadGoal && actual.activeThread?.goal !== expected.activeThreadGoal) {
    return false;
  }
  if (
    expected.alexParticipation &&
    actual.activeThread?.alexParticipation !== expected.alexParticipation
  ) {
    return false;
  }
  if (expected.activeCandidates) {
    const actualSorted = [...actual.activeCandidates].sort().join(",");
    const expectedSorted = [...expected.activeCandidates].sort().join(",");
    if (actualSorted !== expectedSorted) return false;
  }
  return true;
}

let passed = 0;
console.log(`\n[observer] ${file.cases.length} cases × ${RUNS}\n`);
for (const testCase of file.cases) {
  const messages: ObserverTranscriptMessage[] = testCase.context.map((message) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: message.speaker,
    content: message.text,
  }));
  const pendingQuestion = pendingAlexQuestion(messages, testCase.anchorSeq);
  const results = [];
  for (let run = 0; run < RUNS; run += 1) {
    results.push(
      await observeConversationStructure({
        messages,
        anchorSeq: testCase.anchorSeq,
        pendingQuestion,
      }),
    );
  }
  const matchesCount = results.filter(
    (result) => result.ok && matches(result.observation, testCase.expect),
  ).length;
  const pass = matchesCount >= 2;
  if (pass) passed += 1;
  console.log(
    `  ${pass ? "PASS" : "FAIL"} ${testCase.id} ${testCase.desc} (${matchesCount}/${RUNS})`,
  );
  for (const result of results) {
    console.log(
      result.ok
        ? `       addressee=${result.observation.addressees.join(",") || "none"} active=${result.observation.activeCandidates.join(",") || "none"} act=${result.observation.speechAct} goal=${result.observation.threadGoal} scope=${result.observation.requestedScope}:${result.observation.requestExplicitness} transition=${result.observation.transitionState} relation=${result.observation.relationToPendingAlexQuestion} alex=${result.observation.alexRelation} thread=${result.observation.activeThread?.threadId ?? "none"}:${result.observation.activeThread?.alexParticipation ?? "none"} expected=${result.observation.expectedHumanResponder ?? "none"}`
        : `       error=${result.error}`,
    );
  }
}

console.log(`\n[observer] ${passed}/${file.cases.length} passed.\n`);
if (passed < file.cases.length) process.exit(1);
