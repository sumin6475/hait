---
status: accepted
date: 2026-09-07
---

# Salience, not focus, decides which candidate Alex speaks about

Ranking used the Observer's focus field — its judgement of the one candidate the
conversation is about. Ranking now uses salience: the most recent message at which
each candidate was literally named, kept per thread. Focus remains as a hint.

## Why the obvious field was the wrong one

Focus is a single slot, and it is empty exactly on the turns where ranking matters
most. A comparison turn names two candidates, so "the" focus is undecidable; a
continuation names none. One measured session ran twelve of twenty-three decisions
with focus null, and on the one turn Alex spoke voluntarily from an unranked list
it surfaced a Candidate A note while the group was busy eliminating Candidate C.

Recency of literal mention is deterministic, needs no model call, and is defined
on every turn including the ones focus cannot express at all.

## Consequence

Salience is a cruder signal: it tracks what was *named*, not what is being
*discussed*, so a candidate mentioned in passing outranks one under sustained
discussion by implication. We prefer a cruder signal that is always present to a
sharper one that is absent when it counts.

## Amendment, 2026-09-08: which hint, and when

"Focus remains as a hint" was too loose. Focus arrives with a basis, and the two
that matter are not the same kind of claim.

`current_explicit` says the speaker named that candidate *on this turn*.
Normalization already drops the basis when the turn's literal mentions
contradict it, so what survives is the observer's reading of which named
candidate the turn is about — something recency cannot express, and worth
promoting above it.

Every other basis is an inference about an announcement further back. At
T-C2-039 seq 10 a focus carried from an earlier thread outranked the candidate a
participant had just named, which is the failure this ADR was written to stop,
reappearing through the hint it left in place.

So focus outranks salience on a `current_explicit` basis and on no other. The
consequence recorded above stands: a cruder signal that is always present beats a
sharper one that is absent when it counts — and a *stale* sharper one does not
get to overrule the transcript at all.
