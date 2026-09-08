---
status: accepted
date: 2026-09-08
---

# The candidate list is computed from the board, never from what Alex has not said

The live candidate list (`0007`) is derived from `coverage` and `score` over the
**board** — traits a human has surfaced, plus traits Alex has actually said. Alex's
unspoken profile Z does not enter it.

## Why the obvious alternative poisons the measurement

Alex holds a full profile the humans do not. Computing the list over everything
Alex knows would converge Alex on the pooled answer ahead of the group in every
condition — and in the leader conditions Alex would then steer the discussion
toward it. Decision accuracy would be measuring how good Alex's card is, in a task
whose entire point is whether the *group* assembles the picture.

Computing over the board means Alex's own information counts toward the list only
once Alex has said it, which is also the moment the pooling DV records it. Alex
may push a candidate up, but only by paying for it in a measurable disclosure.

This property was already present in the code and is now depended on:
`surfacedByCandidate` reads human `revealedIds` ∪ `aiSurfacedIds`, and
`poolingTally.ts:125` notes that unspoken Z is in neither.

## The removal rule, and the clause that matters

A candidate leaves the list only when its coverage is at least 4, its coverage is
within 2 of the best-covered live candidate, and its score trails the best live
score by at least 2.

The middle clause is the load-bearing one. Without it a candidate falls out for
having been *ignored* rather than for being weak — which is precisely the shape a
hidden profile produces, and precisely the error the group is at risk of. In
T-C3-003 the group tried to eliminate a candidate at seq 4, before any trait for
any candidate was on the board; that candidate was the one they eventually chose.

Score is matches minus misses, every trait weighing the same. `CONTEXT.md` records
that treating one trait as decisive is an error available to the group; it is not
one Alex may commit on the group's behalf, which is also why no count, ratio or
score is ever spoken.

## The thresholds are chosen, not derived

4 and 2 have no empirical basis. The only large corpus is a different
architecture and cannot be replayed against them. The list is therefore computed
and logged without reaching speech until a session has been read against those
numbers — see `.scratch/leader-decision-frame/issues/02`.
