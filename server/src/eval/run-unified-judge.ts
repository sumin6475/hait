import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import {
  observeConversationStructure,
  pendingAlexQuestion,
  reduceConversationStateAfter,
  type ObserverTranscriptMessage,
} from "../lib/conversationObserver.js";
import { judgeConversationTurn } from "../lib/interventionJudge.js";

interface UnifiedJudgeCase {
  id: string;
  desc: string;
  msgs_since_alex: number;
  cooldown_available: boolean;
  context: Array<{
    seq: number;
    senderRole: string;
    speaker: string;
    text: string;
  }>;
  eligible_trait_ids: string[];
  expect: {
    decision: "speak" | "silent" | "reobserve";
    act?: "answer" | "participate" | "follow" | "contribute" | "acknowledge" | "mediate";
    evidence?: string;
    selectedTraitId?: string | null;
  };
}

if (!process.env.OPENAI_API_KEY) {
  console.error("[unified-judge] OPENAI_API_KEY not set — check server/.env");
  process.exit(1);
}

const loadedFixture = yaml.load(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "unified_judge_cases.yaml"), "utf8"),
) as { cases: UnifiedJudgeCase[] };
const fixture = {
  cases: process.env.UNIFIED_CASE_ID
    ? loadedFixture.cases.filter((testCase) => testCase.id === process.env.UNIFIED_CASE_ID)
    : loadedFixture.cases,
};
const RUNS = 3;
let passed = 0;
console.log(`\n[unified-judge] ${fixture.cases.length} cases × ${RUNS}\n`);

for (const testCase of fixture.cases) {
  const messages: ObserverTranscriptMessage[] = testCase.context.map((message) => ({
    seq: message.seq,
    senderRole: message.senderRole,
    speaker: message.speaker,
    content: message.text,
  }));
  const anchorSeq = messages.at(-1)!.seq;
  let matches = 0;
  const outputs: string[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const pendingQuestion = pendingAlexQuestion(messages, anchorSeq);
    const observed = await observeConversationStructure({ messages, anchorSeq, pendingQuestion });
    if (!observed.ok) {
      outputs.push(`observer_error=${observed.error}`);
      continue;
    }
    const snapshot = {
      anchorSeq,
      conversationEpoch: anchorSeq,
      observation: observed.observation,
      stateAfter: reduceConversationStateAfter({
        anchorSeq,
        conversationEpoch: anchorSeq,
        observation: observed.observation,
      }),
      questionThreadAfter: null,
    };
    const judged = await judgeConversationTurn({
      messages,
      snapshot,
      messagesSinceAlex: testCase.msgs_since_alex,
      cooldownAvailable: testCase.cooldown_available,
      backchannelAvailable: true,
      postGenerationReevaluation: false,
      interactionAlreadyServed: false,
      eligibleTraitIds: testCase.eligible_trait_ids,
    });
    if (!judged) {
      outputs.push("judge_error");
      continue;
    }
    outputs.push(
      `${judged.decision}/${judged.act ?? "none"}/${judged.evidence}/${judged.selectedTraitId ?? "none"}` +
        ` observer=${snapshot.stateAfter.alexRelation}/${snapshot.stateAfter.alexRelevance}` +
        ` floor=${snapshot.stateAfter.expectedHumanResponder ?? "none"}/${snapshot.stateAfter.transitionState}` +
        ` active=${snapshot.observation.activeCandidates.join(",") || "none"}`,
    );
    const expected = testCase.expect;
    if (
      judged.decision === expected.decision &&
      (expected.act === undefined || judged.act === expected.act) &&
      (expected.evidence === undefined || judged.evidence === expected.evidence) &&
      (expected.selectedTraitId === undefined ||
        judged.selectedTraitId === expected.selectedTraitId)
    ) {
      matches += 1;
    }
  }
  const ok = matches >= 2;
  if (ok) passed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${testCase.id} ${testCase.desc}`);
  console.log(`       ${outputs.join(" | ")}`);
}

console.log(`\n[unified-judge] ${passed}/${fixture.cases.length} passed.\n`);
if (passed < fixture.cases.length) process.exit(1);
