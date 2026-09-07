import assert from "node:assert/strict";
import fixture from "../eval/conversation_gold_synthetic.json" with { type: "json" };
import {
  GoldExpectationSchema,
  GoldSemanticOutcomeSchema,
  deployedActionAgainstGold,
  semanticOutcomeMatchesGold,
  turnAttribution,
} from "../eval/conversationGold.js";

const actual = GoldSemanticOutcomeSchema.parse(fixture.actual);
const expectation = GoldExpectationSchema.parse(fixture.singleExpectation);

assert.equal(semanticOutcomeMatchesGold(actual, expectation), "match");
const mismatch = GoldSemanticOutcomeSchema.parse({
  ...fixture.actual,
  judge: { decision: "silent", reason: "no_useful_move", evidenceSeqs: [2] },
});
assert.equal(semanticOutcomeMatchesGold(mismatch, expectation), "mismatch");

const deployedMatch = deployedActionAgainstGold(
  {
    observationStatus: "observed_records",
    interventionLinkage: { status: "unique" },
    records: [{ decision: "speak" }],
  },
  expectation,
);
assert.equal(deployedMatch, "match");
assert.equal(
  deployedActionAgainstGold(
    {
      observationStatus: "not_observed",
      interventionLinkage: { status: "no_record" },
      records: [],
    },
    expectation,
  ),
  "unknown",
);
assert.equal(
  turnAttribution({ deployed: deployedMatch, candidate: "mismatch" }),
  "regression",
);
assert.equal(
  turnAttribution({ deployed: "mismatch", candidate: "match" }),
  "fixed",
);

console.log("[conversation-gold] schema and attribution tests passed");

