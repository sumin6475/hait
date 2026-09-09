# 25: The reveal budget and the board are read from different extractors

**What to fix:** The output guard is checked against the fast keyword extractor
at broadcast time, while the board is written by the verified extractor
afterwards. They disagree, and the disagreement runs both ways: a message can
exceed its budget without the guard noticing, and a trait a human plainly stated
can be dropped from the board.

**Status:** done

## What was observed

T-C2-047, verified build 1.9.0.

**The record of a turn was the guard's guess, not what the message carried.**
Turn 35 recorded `outputGuard: { inForce: false, traitIds: ["A_p4"] }`. Its
message named `A_p4` in the pool's own words and `B_p3` in near ones, and the
broadcast message's `sharedInfoIds` are both, written 2 seconds later by the
bounded verifier. The turn's own record says one; the board says two.

That turn happened to carry no guard, which is the only reason the board got it
right: a guarded turn reused the guard's id list and discarded the near matches
entirely, so the verifier never ran on it. The same message under the reveal
budget it was nearly given would have passed a budget of one while carrying two,
and the board would have recorded one, with nothing left to correct it. Guarded
turns are exactly the turns Alex discloses on.

*Corrected 2026-09-08.* This section first read that turn 35 recorded
`route_reveal_budget` with `traitIds: []`, and that turns 12 and 32 showed the
same. The export says otherwise: turn 35's guard was not in force, and turns 12
and 32 did have empty `traitIds` under a budget of one but their messages carried
no trait, so those two were right rather than evidence.

**The board dropped a trait a human stated in plain words.** At seq 31 humanX
wrote that Candidate A *does not tolerate criticism* — the exact text of `A_n1` —
and the record shows `declinedTraitIds: ["A_n1"]`. The verifier declined it, so
it never reached the board.

*Amended 2026-09-08.* Re-read on the current build, that sentence puts the trait
inside a conditional — "if A does X and he does not tolerate criticism, what
happens?" — and declining a premise inside an "if" is what the ambiguity check is
for, not a failure of it. The same trait stated plainly is now accepted outright
by the matcher, which it was not before the canonical wording became matchable
(issue 24). Both readings are locked in `test-intervention-v2`.

## Why this matters beyond tidiness

The budget is the mechanism that keeps Alex's disclosure rate comparable across
conditions. A guard that under-counts does not enforce a comparable rate; it
enforces one on the turns where the fast extractor happens to work.

And every derived quantity reads the board: coverage, the candidate list
(`docs/adr/0009`), the summary gates, the depth gate, `floorMet`. A board that
under-counts makes all of them conservative — the candidate list stays live
longer than it should, which is the safe direction, but the summary and floor
gates are held closed by the same error, which is not obviously safe.

## The shape of the fix, and the thing to decide first

The two extractors exist for a reason: the fast one is synchronous because the
guard has to decide before broadcast, and the verified one costs a model call.
Making the guard wait for the verified extractor puts a model call inside the
pre-broadcast path, which is where latency was cut from 2.5–3.5 s to 0.2–1.5 s
in T-C1-024.

So the decision is whether the budget should be enforced on the fast extractor at
all, or whether an over-budget message should be corrected *after* the async
extraction disagrees — by recording the violation rather than by blocking the
turn. The second costs no latency and no turns, and it makes the record true,
which is what the analysis needs. It does not stop the oversized message going
out.

## What must not regress

- The pre-broadcast tail stays inside the T-C1-024 band
- No new model call on the path between generation and broadcast
- A guard that fires must still cost the turn rather than broadcast oversized

- [x] A trait's own wording is matchable at all
- [x] Alex's own message is read as the closed question it is
- [x] The record of a turn states the traits the message actually carried, not the fast extractor's guess
- [x] Budget violations are counted per session and per condition
- [x] `A_n1` at T-C2-047 seq 31, or an equivalent plain statement, reaches the board

## Comments

### The cause was upstream of both extractors, 2026-09-08

Reading T-C2-047 turn 9 found something worse than a guess that disagreed with a
verifier. Alex was told to contribute `C_p6` — its only unique note about the
pooled answer — wrote its own card's wording twice, and the turn died as
`selected_trait_missing` both times.

**The same sentence lived in four places and had drifted in three of them.** The
cards the participants read, the card in Alex's system prompt, `TRAIT_DB` (what
everything is matched and counted against), and this directory's approval record
disagreed on 11 of 40 traits. `C_p6` was one: participants and Alex read *"Puts
the safety of people in his/her care above everything else"*, while the matcher
held *"puts the safety of people above everything"*. Alex quoted its card and the
matcher was looking for a sentence nobody had ever been shown.

The four are now one string, generated from `TRAIT_DB` and locked by tests: the
participants' cards and Alex's card are compared to it entry by entry, and the
approval record already had its own check. The prompt snapshot was recompiled and
the prompt version is **1.10.0**, so sessions before and after are on different
cards and are not directly comparable.

**And a trait's own wording was not necessarily matchable.** An entry with
explicit core phrases dropped the trait text entirely, so quoting the card
verbatim — the most likely way a trait reaches the board — could match nothing.
Every entry's phrase list now begins with its own canonical text. No phrase was
removed.

**Alex's own message is a closed question.** Even matchable, `C_p6` came back as
a verification candidate: a near match the human path refers to the bounded
verifier, because a participant's sentence could be about any trait or none.
Alex's could not — the turn named what it was permitted to say, so a near match
on one of those ids has no rival reading. Those now count as disclosed. The open
pass is untouched, and still counts a restatement of a human's trait, which is
outside Alex's notes by definition.

The two lost drafts from turn 9 are in `test-intervention-v2` verbatim, and both
now resolve to `C_p6`.

What is still open is the disagreement this issue was opened for: the guard reads
the fast extractor before broadcast and the board is written by the verified one
afterwards, so the record of what a message carried can still be wrong in the
other direction.

### Two questions, two fields, 2026-09-08

The guard and the record were asking different questions of one number.

The guard's question is *may this go out?*, and it is asked before the
broadcast, where only the network-free matcher may run — the bounded verifier is
a model call and T-C1-024 cut 2.5-3.5 s off that path. So the guard's evidence
is the matcher's accepted ids and cannot be more than that. The record's question
is *what did this message carry?*, and it is answered after the broadcast, where
the verifier costs nothing anybody waits for. One field held both answers, so on
the turns where they differ the analysis was reading the guess.

**The near matches are no longer thrown away.** A guarded turn reused the guard's
id list and dropped everything the matcher had referred, so the verifier ran on
unguarded Alex turns and on human messages and never on the turns Alex actually
discloses on. `disclosedTraitIds` now returns those leftovers and the broadcast
path hands them to the same late verification the other paths had. The guard is
unchanged: a near match still cannot cost a turn.

**`surfacedTraitIds` is the record.** Written once the verifier has settled,
alongside — not over — `outputGuard.traitIds`, so a turn's record now says both
what the guard decided on and what went out. When the delivered set breaks a
bound, the same `outputScopeViolation` is re-run against it and the result is
stored as `postBroadcastViolation`. Recorded and nothing more: the message is
already out, and buying it back would put a model call back in front of the
broadcast.

**And they are counted.** `npm run report:budget` groups spoken turns by session
and by condition: guarded, blocked before the broadcast, broken after it, and
how many records the verifier corrected. Ids and counts only, no message text.

One thing this does not do is stop an oversized message. It cannot, at the price
the pre-broadcast path is allowed to pay. What it does is make the breach
countable, which the comparability claim needs and did not have.
