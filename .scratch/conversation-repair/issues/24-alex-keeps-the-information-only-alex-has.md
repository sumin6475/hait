# 24: Alex says it has nothing left while holding cards

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
and treats the result as fact — see issue 25 for what that costs on the human
side of the same mechanism.

## What must not regress

- No condition may receive a different reveal budget from another
- Alex may not state or imply which profile a trait came from — a participant
  cannot know that about their own card
- No new model call on the path between generation and broadcast
- The pooling DV counts first surfacing, so a change that raises restatement
  instead of disclosure is not an improvement

- [x] Nothing is counted as disclosed on a turn that was never broadcast
- [x] Alex is told which of its own notes are still unsaid, so the claim stops being a guess
- [ ] With the record accurate, a message still asserting Alex has nothing further is refused
- [ ] The record states the trait ids Alex disclosed from what the turn permitted, not from a keyword pass over its own prose
- [ ] Per session, on the record: traits held, traits disclosed, and how many of each were unique
- [ ] Traits per message and message length do not differ by condition after the change

## Comments

### Landed: a turn is counted where it becomes real, 2026-09-08

`updateAiSurfaced` ran between `Message.create` and the socket emit, so a
broadcast that threw left the traits recorded as surfaced — on the board, in the
message's `sharedInfoIds`, and in the pooling DV — for a message nobody saw.
Nothing rolled them back. An opportunity already had this right: it is consumed
in `onBroadcastSuccess`, after the emit, which is what `CONTEXT.md` says a
successful broadcast is for. Pooling now settles in the same place, just before
the opportunity does.

The other lost-turn paths were already safe and stay untouched: a guard death, a
supersession and a lifecycle cancel all return before the message is created, so
they never reached the write. T-C2-047 turn 9 is the worked example — a turn lost
to `selected_trait_missing` that correctly recorded no disclosure.

There is no runtime harness for `executeRouteTurn`, so the invariant is asserted
on the order of the file itself in `test-intervention-v2`: the pooling write must
appear after the emit and after the `broadcast_failed` return, and before the
ledger commit. Moving it back above the emit fails that assertion.

This does not touch what Alex chooses to say or how much. It makes the count
true, which the remaining items need before their numbers mean anything.

### Landed: Alex is told what it still holds, 2026-09-08

The first plan here was a post-condition — refuse a message claiming exhaustion
while a note is unsaid. That was the wrong shape. Alex was not misreporting a
list it had; **it never had the list.** Its card is in the frozen prompt every
turn, and which of those notes had already been said was left for it to
reconstruct from a thirty-six message transcript.

`previouslySurfacedTraitIds` existed and went only to the output post-condition.
The Judge got the same information as `eligibleTraitIds`. The generator, which is
what actually answers "do you hold anything else", got neither.

Every route that can disclose a trait now carries a plain record: how many of the
notes on Alex's card have not been said by anyone, and which. On the board as it
stood at T-C2-047 seq 36 — the turn where Alex said those were the only new facts
it had — the block reads `13 of the 24 notes on your card have not been said
yet`, and lists them.

Three things it deliberately does not do. It gives no instruction to share
anything and says so, because the reveal budget is what governs that and is
unchanged. It never marks which notes only Alex holds — a participant cannot know
that about their own card, and `docs/adr/0008`'s reasoning applies to speech as
much as to the list. And it is identical in every condition: this is Alex's own
card, not its status.

It also makes the true answer sayable. When every note is on the board the block
says so outright, which is the one case where "I have nothing further" is correct
and Alex should be able to say it.

The post-condition is not ruled out, only deferred to where it belongs: if Alex
still claims exhaustion with an accurate record in front of it, that is a
behaviour worth guarding. It has not been observed under those conditions,
because those conditions did not exist until now.

Runtime context only — no route prompt changed, so the prompt version and the
30-key snapshot are untouched by this.
