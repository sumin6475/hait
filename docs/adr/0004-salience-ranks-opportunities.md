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
