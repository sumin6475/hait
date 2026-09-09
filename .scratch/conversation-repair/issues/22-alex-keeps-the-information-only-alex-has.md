# 22: Alex says it has nothing left while holding cards

**What to fix:** Twice in T-C2-047, once in direct answer to the pooling question
itself, Alex told the group it had no further information while unsurfaced
traits were still in its notes. And the record of what Alex disclosed is
recovered by running a keyword extractor over Alex's own text, so the system
cannot say accurately what it contributed.

**Status:** needs-triage

## The two statements

T-C2-047, Chair + explanatory, verified build 1.9.0.

At seq 15, asked for new insight: *"I have no new facts beyond what's already on
the table."* Sixteen of Alex's twenty-four traits were unsurfaced at that moment.

At seq 36, asked directly whether it held information the others did not:
*"...they match being very well organized. For Candidate B I have one more: they
match assessing weather conditions very well. Those are the only new facts I
have."* Thirteen traits were unsurfaced, seven of them held by no other
participant.

The second is the worst case this task can produce: a participant asked the
pooling question in plain words and was told no by a participant holding the
answer.

## What this issue is not, and the count that settles it

The first version of this issue read the session as a **selection** failure —
seven of Alex's nine disclosures were traits every participant already had, so
Alex looked like it was systematically spending its turns on shared information.
That reading does not survive counting.

At each of Alex's six new disclosures, the share of its unsurfaced notes that
were unique to it was:

| seq | notes still in hand | of those, unique | unique share | disclosed |
| ---: | ---: | ---: | ---: | --- |
| 7 | 22 | 8 | 36% | `C_p1` shared |
| 11 | 19 | 8 | 42% | `C_p7` **unique** |
| 21 | 17 | 7 | 41% | `D_p1` shared |
| 27 | 16 | 7 | 44% | `A_p2` shared |
| 30 | 14 | 7 | 50% | `A_p3` shared |
| 36 | 13 | 7 | 54% | `B_p3` shared |

One unique disclosure out of six, against 2.7 expected from the composition of
the hand. At n=6 that is inside chance, and **no selection bias is demonstrated.**

It is also not clear a participant could do better. Nothing on the board
distinguishes `A_p2` from `A_n5` for whoever holds both: they are equally "mine,
and not yet said". What a participant can infer is exactly what the code already
computes — `ALEX_Z_IDS` minus what is surfaced — and that estimate sharpens on
its own as others surface the shared traits, which the last column of the table
shows happening: 36% to 54% over the session.

**So this issue does not change what Alex chooses to disclose.** Adding a
"prefer unique" ranking would enforce a behaviour whose absence has not been
demonstrated, against the checkpoint's sixth method rule. The rate is worth
watching — six new traits from a hand of twenty-four across thirteen messages,
with `maxTraitIds: 1` on every trait-bearing turn — but the accounting has to be
trustworthy before that number means anything.

## The two things to fix

**A message may not claim exhaustion while the hand is not empty.** This is
deterministic and needs no model call: `ALEX_Z_IDS` minus the board is either
empty or it is not. It belongs beside the existing output post-conditions, which
already refuse a leader message containing a question and a message leaking
internal metadata. What replaces the claim is a question for issue 04's wording —
"that's what I have on the table so far" is true; "those are the only new facts I
have" is not.

**Alex's own contribution must not be recovered by text extraction.** The turn
already knows what it permitted: the guard carries `allowedTraitIds` and
sometimes `requiredTraitId`, and the Judge carries `selectedTraitId`. Generation
is already structured output, so the model can return the trait ids it disclosed
as a field, checked against what it was permitted, with keyword extraction kept
as a cross-check rather than as the source of truth. Today
`routeScopedGeneration.ts:156` runs the keyword extractor over Alex's own text
and treats the result as fact — see issue 23 for what that costs on the human
side of the same mechanism.

## What must not regress

- No condition may receive a different reveal budget from another
- Alex may not state or imply which profile a trait came from — a participant
  cannot know that about their own card
- No new model call on the path between generation and broadcast
- The pooling DV counts first surfacing, so a change that raises restatement
  instead of disclosure is not an improvement

- [ ] A message asserting Alex has nothing further is refused while an unsurfaced trait remains in `ALEX_Z_IDS`
- [ ] The record states the trait ids Alex disclosed from what the turn permitted, not from a keyword pass over its own prose
- [ ] Per session, on the record: traits held, traits disclosed, and how many of each were unique
- [ ] Traits per message and message length do not differ by condition after the change
