---
status: accepted
date: 2026-09-08
---

# The candidate list measures attention, not merit

`0008` settled where the list is computed from: the board, never Alex's unspoken
profile. That still holds. What it also carried — a removal rule reading
`score` — is withdrawn here, and replaced.

A candidate now leaves the list on **coverage alone**. `score` is still computed
and recorded, and it is no longer an input to anything the group works on next.

## Why a score-based rule cannot work in this task

The dataset decides it. Every candidate carries exactly four traits that all
three profiles can see, and what those four traits *are* is the point of the
design:

| | shared four | score from them | pooled score |
| --- | --- | ---: | ---: |
| A | 4 matches, 0 misses | **+4** | **−2** |
| B | 4 matches, 0 misses | **+4** | **−2** |
| D | 4 matches, 0 misses | **+4** | **−2** |
| C | 1 match, 3 misses | **−2** | **+4** |

The sign is inverted for every candidate. While the board is dominated by shared
information, `score` ranks the candidates backwards — the pooled answer last and
the three wrong answers first. That a board starts shared-dominated is not a risk
this design took; it is the premise of the hidden-profile paradigm the study is
built on.

The withdrawn threshold made it worse by coincidence: `coverage >= 4` is exactly
the size of the shared set, so the rule was timed to fire at the moment the
ranking was most inverted. But no threshold rescues it. Any bar on board score
inherits the inversion, because the inversion is in the quantity, not in where
the line is drawn.

`.scratch/leader-decision-frame/issues/02` records the one observed instance,
T-C1-016, where the pooled answer was set aside. The argument here does not rest
on it: the replay's trait extractor over-detects one candidate's phrasings, so
the corpus cannot test the inversion either way. The dataset can, and does.

## The repair that is not available

The obvious correction is to let the list reason about what has *not* been said —
a candidate trailing by 3 with six traits unseen has not been beaten yet. Two
things forbid it, and neither is a preference.

The task prompt tells Alex: *do not invent traits or assume that an unmentioned
trait exists.* And participants are never told how many traits a candidate has —
the standard shown to them describes matches and misses and gives no counts. A
list reasoning from "ten minus coverage" would run Alex on an information
advantage the design does not grant, in a study whose entire measurement is what
each participant contributes.

## The bar below is superseded

**Amendment, 2026-09-12.** `0011` withdraws the coverage bar. Its derivation is
sound and its counter was not: coverage counts the whole board, and Alex holds
six traits per candidate, so Alex clears a bar of five alone. Across T-C2-050 and
T-C2-051 all eight removals were Alex's own disclosures and none was a human's,
which left the leader's sentence saying nothing a leader can act on. A candidate
now leaves the list when a **human** has pooled something about it that Alex does
not hold.

Everything else in this ADR stands, and `0011` argues from it: the list still
measures attention rather than merit, still reads no score, and still may not
reason about what has not been said.

## The rule

A candidate leaves the list when `coverage >= 5`, and for no other reason.

**Five is derived, not chosen.** Four traits per candidate are visible on every
card, so a candidate can reach coverage 4 on nothing the group did not already
share. Five is the first coverage at which something beyond the common pool must
have reached the board. Below the bar, nothing about that candidate has been
pooled; at or above it, something has.

This is the lowest bar that means anything, and a higher one would be chosen
again. That asymmetry is the point of moving axes: a bar set too low costs a
nudge not given, where the old rule's error cost the right answer.

**Leaving the list now means "the group has pooled something about this one",
not "this one is out".** The leader's move becomes *we have something on A;
nobody has said anything unshared about D yet* — discussion management, which is
what `0007` licensed. It cannot express a verdict, so it cannot express a wrong
one.

There is no relative test and no ordering, so the fixed-point question the old
rule raised — whether removals cascade — does not arise. Coverage never falls, so
the list only shrinks and nothing needs reopening. An **empty list is meaningful**:
every candidate has had something unshared said about it, and the group has
cleared the one bar Alex can hold it to before closing.

## What score is still for

Recorded on every turn, for two reasons.

It is the only way to re-read a session against a different bar afterwards, and
the bar is the thing sessions are being run to test.

And one licensed leader move legitimately needs it: the one-per-session defence
of the weakest candidate (`.scratch/leader-decision-frame/issues/05`). There the
inversion runs the right way — the candidate that looks weakest on a
shared-dominated board is the pooled answer — so arguing for it is the debiasing
step that issue declares itself to be. Defending the apparent loser is safe in a
way that eliminating it is not.

## Consequences to watch

`DEPTH_MIN_PER_CAND` (3) already holds discussion on a candidate that is thin,
and now does an adjacent job with a different number and a different source.
Whether they should be one thing is a live question, deliberately not settled
here: that gate is live behaviour and this list is shadow, and merging them would
change what Alex does before a session has read either.

The bar may prove too low — a candidate could clear it on one unshared trait and
be dropped from the leader's attention while nine remain unsaid. That is what
issue 01's sessions are for. It is a nudge not given, and it is recoverable.
