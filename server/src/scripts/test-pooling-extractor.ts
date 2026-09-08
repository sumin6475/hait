import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock } from "node:test";
import { load } from "js-yaml";
import { Responses } from "openai/resources/responses/responses";
import {
  extractHumanTraitsFast,
  validateExtractedTraitMentions,
  verifyHumanTraitCandidates,
} from "../lib/poolingExtractor.js";
import { TRAIT_KEYWORD_REGISTRY } from "../lib/traitKeywordRegistry.js";
import { TRAIT_BY_ID } from "../lib/traitData.js";

const ids = (messageText: string, assignedProfile?: "X" | "Y" | "Z") =>
  extractHumanTraitsFast({ messageText, assignedProfile }).acceptedIds;

assert.deepEqual(ids("Candidate B keeps a cool head in crisis situations.", "X"), ["B_p1"]);
assert.deepEqual(ids("Candidate A is well organised.", "Y"), ["A_p4"]);
assert.deepEqual(ids("Candidate C is stress resistant.", "Y"), []);
assert.deepEqual(ids("I think Candidate B has a cool head?", "X"), []);
assert.deepEqual(ids("If Candidate B had a cool head, that would help.", "X"), []);
assert.deepEqual(ids('They said Candidate B is "considered arrogant".', "Z"), []);
assert.deepEqual(ids("Candidate D is very responsible for passengers.", "X"), []);
assert.deepEqual(ids("Being responsible is important for this job.", "X"), []);
assert.deepEqual(ids("Candidate A and Candidate D are considered arrogant.", "Z"), []);
assert.deepEqual(ids("Candidate B has a below-average memory for numbers.", "Y"), ["B_n3"]);
assert.deepEqual(ids("The pilot is a very conscientious person.", "Y"), ["C_p4"]);
assert.deepEqual(ids("A very conscientious person would be useful.", "Y"), []);
assert.deepEqual(ids("We need a well organized person for this job.", "Y"), []);
assert.deepEqual(ids("The crew was very well organized during the drill.", "Y"), []);
assert.deepEqual(ids("Candidate A does not tolerate criticism.", "X"), ["A_n1"]);
assert.deepEqual(ids("Candidate B is not very cooperative.", "X"), ["B_n2"]);
assert.deepEqual(ids("Candidate A is very  well organized.", "Y"), ["A_p4"]);
assert.deepEqual(ids("Candidate C isn't verbally skillful.", "Y"), ["C_n1"]);
assert.deepEqual(ids("Candidate C is verbally skillfull.", "Y"), []);
assert.deepEqual(
  ids("For this role we need teamwork, but Candidate A is very well organized.", "Y"),
  ["A_p4"],
);
assert.deepEqual(ids("I prefer B. The same point is 'considered arrogant'.", "X"), []);
assert.deepEqual(
  ids("Candidate A cannot assess weather conditions, but Candidate B can assess weather conditions very well.", "X"),
  ["B_p3"],
);
assert.deepEqual(ids("Candidate B cannot assess weather conditions very well.", "X"), []);
assert.deepEqual(ids("Candidate D is not arrogant.", "X"), []);
const quotedNote = extractHumanTraitsFast({
  messageText: 'My note says: "Candidate A is very well organized."',
  assignedProfile: "Y",
});
assert.deepEqual(quotedNote.acceptedIds, []);
assert.deepEqual(quotedNote.verificationCandidates.map((candidate) => candidate.traitId), ["A_p4"]);
assert.deepEqual(ids('"Candidate A is very well organized."', "Y"), ["A_p4"]);
assert.deepEqual(ids("I heard Candidate B is good at multitasking.", "X"), []);
const typoCandidate = extractHumanTraitsFast({ messageText: "Candidate D is arogant.", assignedProfile: "X" });
assert.deepEqual(typoCandidate.acceptedIds, []);
assert.deepEqual(typoCandidate.verificationCandidates, [
  { traitId: "D_n1", evidenceQuote: "is arogant", reason: "lexical_near_match" },
]);
assert.deepEqual(
  extractHumanTraitsFast({
    messageText: "Candidate D can react adequately to unforseen events.",
    assignedProfile: "Y",
  }).verificationCandidates,
  [{ traitId: "D_p1", evidenceQuote: "react adequately to unforseen events", reason: "lexical_near_match" }],
);
assert.deepEqual(
  extractHumanTraitsFast({ messageText: "Candidate B is arogant.", assignedProfile: "X" }),
  { acceptedIds: [], verificationCandidates: [] },
);
assert.deepEqual(
  ids("If we're doing completeness — I've got this: Candidate C is stress-resistant.", "X"),
  ["C_p2"],
);
assert.deepEqual(
  ids("If Candidate B had a cool head, that would help. Candidate B keeps a cool head in crisis situations.", "X"),
  ["B_p1"],
);
assert.deepEqual(
  ids("Candidate D is responsible for passengers. Candidate D is very responsible.", "X"),
  ["D_p4"],
);
assert.deepEqual(ids("I have A, which has a good overview of complex context.", "Y"), ["A_p2"]);
assert.deepEqual(ids("I have B. You can rely on him 100%.", "Y"), ["B_p2"]);
assert.deepEqual(ids("I have B, which is considered to be nagging.", "X"), ["B_n1"]);
assert.deepEqual(ids("Candidate B gossips about his co-workers.", "Y"), ["B_n4"]);
assert.deepEqual(ids("I have C, can make the right decision very quickly.", "X"), ["C_p1"]);
assert.deepEqual(ids("Candidate D is not very well suited for leading a team.", "X"), ["D_n2"]);
assert.deepEqual(ids("Candidate C is having 2 misses only.", "X"), []);
assert.deepEqual(ids("I choose Candidate A because his positive points seem more vital.", "X"), []);
assert.deepEqual(
  ids("The pilot's place should be very organized and tidy, so Candidate A can get distracted.", "X"),
  [],
);
assert.deepEqual(ids("No, Candidate D is not moody according to me.", "Z"), []);
assert.deepEqual(ids("Gossiping doesn't mean Candidate B will not cooperate.", "X"), []);
assert.deepEqual(ids("Candidate B is both nagging and not cooperative.", "X"), ["B_n1", "B_n2"]);
assert.deepEqual(ids("Candidate B is cooperative.", "X"), []);
assert.deepEqual(ids("Candidate A is open to new ideas.", "Y"), []);
assert.deepEqual(ids("Candidate D is suited to lead a team.", "X"), []);
const positiveMemory = extractHumanTraitsFast({
  messageText: "Candidate B has a good memory for numbers.",
  assignedProfile: "Y",
});
assert.deepEqual(positiveMemory.acceptedIds, []);
assert.deepEqual(positiveMemory.verificationCandidates.map((candidate) => candidate.traitId), ["B_n3"]);

/**
 * The registry phrases that reach only bounded verification, never acceptance.
 *
 * Reachability alone is too weak a property now that the matcher also carries
 * Alex's own output. The reveal guard reads `acceptedIds` and nothing else, so
 * a phrase that falls to `verificationCandidates` is a trait the guard cannot
 * count — and the guard's failure mode is precisely an empty extraction reading
 * as "this message revealed nothing". Pinning the set means a change that pushes
 * more phrases into it has to say so.
 *
 * All four here are correct: each is a bare noun phrase carrying no assertion of
 * the negative the trait states. "memory for numbers" is not "below-average
 * memory for numbers"; "verbally skillful" is not "not verbally skillful".
 * `hasRequiredTraitSemantics` withholds them on that ground, and the fuller
 * phrasings of both traits are accepted.
 */
const VERIFICATION_ONLY_PHRASES = new Set([
  "B_n3|memory for numbers",
  "C_n1|verbally skillful",
  "C_n1|verbally skilful",
  "C_n1|verbally skillfull",
]);

for (const entry of TRAIT_KEYWORD_REGISTRY) {
  const profile = entry.profiles[0];
  const phrase = entry.corePhrases[0]!;
  for (const registeredPhrase of [...entry.corePhrases, ...entry.acceptedVariants]) {
    const direct = extractHumanTraitsFast({
      messageText: `Candidate ${entry.candidate} ${registeredPhrase}.`,
      assignedProfile: profile,
    });
    assert.ok(
      direct.acceptedIds.includes(entry.traitId) ||
        direct.verificationCandidates.some((candidate) => candidate.traitId === entry.traitId),
      `${entry.traitId} must remain reachable from registered phrase: ${registeredPhrase}`,
    );
    assert.equal(
      direct.acceptedIds.includes(entry.traitId),
      !VERIFICATION_ONLY_PHRASES.has(`${entry.traitId}|${registeredPhrase}`),
      `${entry.traitId} changed whether the matcher accepts "${registeredPhrase}" outright; ` +
        "a phrase the matcher only defers is invisible to the reveal guard",
    );
  }
  assert.ok(
    !extractHumanTraitsFast({
      messageText: `If Candidate ${entry.candidate} ${phrase}, would that help?`,
      assignedProfile: profile,
    }).acceptedIds.includes(entry.traitId),
    `${entry.traitId} hypothetical must not enter the fast ledger`,
  );
  assert.ok(
    !extractHumanTraitsFast({
      messageText: `I heard Candidate ${entry.candidate} ${phrase}.`,
      assignedProfile: profile,
    }).acceptedIds.includes(entry.traitId),
    `${entry.traitId} reported claim must not enter the fast ledger`,
  );
  const ineligibleProfile = (["X", "Y", "Z"] as const).find((candidate) => !entry.profiles.includes(candidate));
  if (ineligibleProfile) {
    const ineligible = extractHumanTraitsFast({
      messageText: `Candidate ${entry.candidate} ${phrase}.`,
      assignedProfile: ineligibleProfile,
    });
    assert.ok(!ineligible.acceptedIds.includes(entry.traitId));
    assert.ok(!ineligible.verificationCandidates.some((candidate) => candidate.traitId === entry.traitId));
  }
}

const c2037Seq3 = extractHumanTraitsFast({
  messageText: "I also liked Candidate B because you can rely on him/her 100%. Gossiping about co-workers is one of Candidate B's negative traits, but I don't think that is as negative as some of the other candidates' negative traits.",
  assignedProfile: "Y",
});
assert.deepEqual(c2037Seq3.acceptedIds, ["B_p2", "B_n4"]);
assert.deepEqual(c2037Seq3.verificationCandidates, []);

const c2037Seq18 = extractHumanTraitsFast({
  messageText: "I agree that he does have positive points. I eliminated Candidate C easily, but then it was kind of a toss-up for the other 3. I chose B because a cool head is very important for a pilot and I like his reliability. I feel that Candidate A's \"recognizing dangerous situations\" is almost like Candidate B's cool head, so they're equal on that point.",
  assignedProfile: "Y",
});
assert.deepEqual(c2037Seq18.acceptedIds, ["B_p1", "B_p2"]);
assert.deepEqual(
  c2037Seq18.verificationCandidates.map((candidate) => candidate.traitId),
  ["A_p1"],
);

const c2037Seq26 = extractHumanTraitsFast({
  messageText: "I feel that not being open to new ideas (Candidate A) is a very negative quality, while gossiping is not that bad (and everyone does it), so I'm still leaning towards Candidate B. His/her other negative quality \"has a below-average memory for numbers\" is the only thing that I think would make him/her a bad candidate at this point.",
  assignedProfile: "Y",
});
assert.deepEqual(c2037Seq26.acceptedIds, ["A_n4"]);
assert.deepEqual(
  c2037Seq26.verificationCandidates.map((candidate) => candidate.traitId),
  ["B_n3"],
);

const c2037Seq19 = extractHumanTraitsFast({
  messageText: "I feel that Candidate D's positive qualities are kind of generic and not specific to a pilot, while his negative traits would not be good for a pilot (quick-tempered).",
  assignedProfile: "Y",
});
assert.deepEqual(c2037Seq19.acceptedIds, []);
assert.deepEqual(
  c2037Seq19.verificationCandidates.map((candidate) => candidate.traitId),
  ["D_n4"],
);

assert.deepEqual(
  ids("being moody in that situation when he is responsible for people's lives is not something that you can neglect it easy", "X"),
  [],
);
assert.deepEqual(
  ids("from the other hand, the pilot's place should be very organized and tidy, so candidate A can have some distraction during the flight and may cause danger", "X"),
  [],
);

const cN1Lexical = extractHumanTraitsFast({ messageText: "Candidate C is verbally skillfull.", assignedProfile: "Y" });
assert.equal(cN1Lexical.verificationCandidates[0]?.traitId, "C_n1");

assert.deepEqual(
  validateExtractedTraitMentions("I chose Candidate A because his positive points seem vital.", [
    { traitId: "A_p1", evidenceQuote: "his positive points seem vital", assertionType: "asserted", confidence: 0.99 },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("I heard Candidate B is good at multitasking.", [
    { traitId: "B_p4", evidenceQuote: "good at multitasking", assertionType: "asserted", confidence: 0.99 },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("Candidate B cannot assess weather conditions very well.", [
    { traitId: "B_p3", evidenceQuote: "assess weather conditions very well", assertionType: "asserted", confidence: 0.99 },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions("Candidate B has a good memory for numbers.", [
    { traitId: "B_n3", evidenceQuote: "memory for numbers", assertionType: "asserted", confidence: 0.99 },
  ]),
  [],
);
assert.deepEqual(
  validateExtractedTraitMentions(
    "If Candidate B had a cool head, that would help. Candidate B keeps a cool head in crisis situations.",
    [{ traitId: "B_p1", evidenceQuote: "cool head", assertionType: "asserted", confidence: 0.99 }],
  ),
  ["B_p1"],
);

assert.deepEqual(
  validateExtractedTraitMentions(
    "Also, if A does a technical mistake and the co-worker reminded him and he does not tolerate criticism?! what's going to happen?",
    [{ traitId: "A_n1", evidenceQuote: "he does not tolerate criticism", assertionType: "asserted", confidence: 0.99 }],
  ),
  [],
);

const parseMock = mock.method(Responses.prototype, "parse", async () => ({
  output_parsed: {
    mentions: [
      { traitId: "A_n4", evidenceQuote: "not open to new ideas", assertionType: "asserted", confidence: 0.99 },
      { traitId: "B_n3", evidenceQuote: "below-average memory for numbers", assertionType: "asserted", confidence: 0.99 },
    ],
  },
}) as any);
try {
  const bounded = await verifyHumanTraitCandidates({
    messageText: "Candidate A is not open to new ideas, and Candidate B has a below-average memory for numbers.",
    candidates: [{ traitId: "B_n3", evidenceQuote: "below-average memory for numbers", reason: "assertion_context" }],
  });
  assert.deepEqual(bounded.ids, ["B_n3"]);
  assert.equal(bounded.status, "verified");
} finally {
  parseMock.mock.restore();
}
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate D's negative traits would not be good for a pilot (quick-tempered).",
    [{ traitId: "D_n4", evidenceQuote: "quick-tempered", assertionType: "asserted", confidence: 0.99 }],
  ),
  ["D_n4"],
);
assert.deepEqual(
  validateExtractedTraitMentions(
    "Candidate A does not tolerate criticism.",
    [{ traitId: "A_n1", evidenceQuote: "does not tolerate criticism", assertionType: "asserted", confidence: 0.99 }],
    new Set(["B_p1"]),
  ),
  [],
);

// The approved registry, compared entry by entry against the runtime copy.
//
// The draft is the only statement of what the registry was supposed to contain,
// which is why it is kept rather than deleted once superseded. The comparison
// covers ownership and trait text as well as the keyword lists: `traitData.ts`
// is the source of truth for those, and a draft that disagrees with it is a
// draft that was approved against a different pool.
type DraftRegistry = {
  traits: Array<{
    trait_id: string;
    candidate: string;
    valence: string;
    profiles: string[];
    canonical_text: string;
    core_phrases: string[];
    accepted_variants: string[];
    fuzzy_policy: string;
    review_status: string;
  }>;
};
const draft = load(readFileSync(new URL("../eval/trait_keyword_registry.draft.yaml", import.meta.url), "utf8")) as DraftRegistry;
const approvedDraft = draft.traits.filter((entry) => entry.review_status === "approved");
assert.equal(approvedDraft.length, TRAIT_KEYWORD_REGISTRY.length);
for (const runtimeEntry of TRAIT_KEYWORD_REGISTRY) {
  const approved = approvedDraft.find((entry) => entry.trait_id === runtimeEntry.traitId);
  assert.ok(approved, `missing approved registry entry ${runtimeEntry.traitId}`);
  assert.deepEqual(runtimeEntry.corePhrases, approved.core_phrases, `${runtimeEntry.traitId} core phrases drifted`);
  assert.deepEqual(runtimeEntry.acceptedVariants, approved.accepted_variants, `${runtimeEntry.traitId} variants drifted`);
  assert.equal(runtimeEntry.candidate, approved.candidate, `${runtimeEntry.traitId} candidate drifted`);
  assert.equal(runtimeEntry.valence, approved.valence, `${runtimeEntry.traitId} valence drifted`);
  assert.deepEqual([...runtimeEntry.profiles].sort(), [...approved.profiles].sort(), `${runtimeEntry.traitId} profiles drifted`);
  assert.equal(runtimeEntry.fuzzyPolicy, approved.fuzzy_policy, `${runtimeEntry.traitId} fuzzy policy drifted`);
  assert.equal(
    TRAIT_BY_ID.get(runtimeEntry.traitId)?.text,
    approved.canonical_text,
    `${runtimeEntry.traitId} was approved against different trait text than the pool now holds`,
  );
}

const ambiguous = extractHumanTraitsFast({ messageText: "Should we trust Candidate B's reliability?", assignedProfile: "X" });
assert.deepEqual(ambiguous.acceptedIds, []);
assert.equal(ambiguous.verificationCandidates[0]?.traitId, "B_p2");
// --- Gate A7: the matcher also carries Alex's own output ---------------------
//
// The pre-broadcast extraction on Alex's messages was a model call sitting
// between the message being saved and being emitted — 2.5-3.5 s of every spoken
// turn in T-C1-023, and 3.5 s of a turn whose message was generated
// deterministically in 0 ms. It now runs through this matcher instead, which is
// a better fit here than on human text: the output contract requires Alex to
// "preserve the key wording of a trait", so its phrasing stays close to the
// pool. No profile filter is applied, because Alex may restate a trait a human
// put on the table.
//
// These are verbatim Alex messages from the observed sessions.
const alexDisclosure = extractHumanTraitsFast({
  messageText:
    "You already shared that Candidate C is considered egocentric and is reluctant to take part in training. From my notes, Candidate C can make the right decisions very quickly, puts the safety of people in their care above everything else, and performs very well in terms of sustained attention. I also have that Candidate C is not verbally skillful.",
});
assert.deepEqual(
  [...alexDisclosure.acceptedIds].sort(),
  ["C_n1", "C_n2", "C_n3", "C_p1", "C_p6", "C_p7"],
  "every trait Alex names in its own message is recorded without a model call",
);

// T-C2-039 seq 19 and 29. The model extractor recorded only D_p1-D_p4 both
// times and dropped the two misses Alex had just disclosed, so `revealStats`
// under-counted Alex's own reveals — which is exactly what the anti-repeat work
// depends on. The matcher catches them.
const alexMisses = extractHumanTraitsFast({
  messageText:
    "From my notes, Candidate D matches on reacting adequately to unforeseen events, concentrating very well, being very resilient, and being very responsible, and misses on being considered moody and having strong prejudices.",
});
assert.ok(
  alexMisses.acceptedIds.includes("D_n5") && alexMisses.acceptedIds.includes("D_n6"),
  "misses Alex discloses are recorded, which the model extractor was dropping",
);

console.log("pooling extractor fast-path tests passed");
