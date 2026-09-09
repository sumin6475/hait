# 23: The reveal budget and the board are read from different extractors

**What to fix:** The output guard is checked against the fast keyword extractor
at broadcast time, while the board is written by the verified extractor
afterwards. They disagree, and the disagreement runs both ways: a message can
exceed its budget without the guard noticing, and a trait a human plainly stated
can be dropped from the board.

**Status:** needs-triage

## What was observed

T-C2-047, verified build 1.9.0.

**The guard passed a message carrying twice its budget.** Turn 35 recorded
`outputGuard: { reason: route_reveal_budget, maxTraitIds: 1, traitIds: [] }` —
the fast extractor found no traits, so nothing could exceed one. The broadcast
message's `sharedInfoIds` are `A_p4` and `B_p3`, written 2 seconds later by the
async extractor. Two traits went out under a budget of one, and the record says
zero.

Turns 12 and 32 have the same empty `traitIds` under the same budget, so this is
not a one-off.

**The board dropped a trait a human stated in plain words.** At seq 31 humanX
wrote that Candidate A *does not tolerate criticism* — the exact text of `A_n1` —
and the record shows `declinedTraitIds: ["A_n1"]`. The verifier declined it, so
it never reached the board.

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
- [ ] The record of a turn states the traits the message actually carried, not the fast extractor's guess
- [ ] Budget violations are counted per session and per condition
- [ ] `A_n1` at T-C2-047 seq 31, or an equivalent plain statement, reaches the board

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
