# 03: The candidate list reaches the leader, and the frame reaches the Judge

**What to build:** Give the live candidate list to the leader conditions as an
input to the decision, and to the peer conditions not at all.

**Blocked by:** 01, 02.

**Status:** ready-for-human — the Judge half is built (2026-09-10); the generator
half and issue 04's other two moves are not.

## What was built

`leaderCoverageNote` in `server/src/lib/interventionJudge.ts` turns the list into
one sentence and puts it in the Judge's per-turn facts, beside the other moves
available now. C2 and C4 receive it; **C1 and C3 receive `null`**, and both
directions are pinned in `test:conversation-ledger`. No number reaches the Judge:
it is handed the reading, not the arithmetic, because the brief rules forbid a
count reaching the writer and a Judge given integers can leak one.

Only issue 04's first move — naming a candidate the group has not covered — is
served. The list still says nothing about what the team has pooled, and raises no
shortfall at the close.

**Why the Judge and not the generator.** The leader's generator already receives
the whole board and the "Still to cover" line. The Judge did not, so it wrote the
turn's purpose blind to coverage: in T-C4-024, on a turn where A and D had
nothing on them, it told the writer to "propose a clear criterion to decide" and
Alex invented a rule that weighted trait categories. This moves an input one
stage earlier rather than adding a new one.

**Unvalidated.** Whether one sentence is enough to stop the invention is a
question only a session answers. Measure it on the next C2 or C4 run before
building issue 04's remaining moves.

## The manipulation this realises

Status is ownership of the decision procedure. The board is raw shared context
and both conditions get it; the live list is the procedure's output, and only the
leader gets it. Giving the peer the list and asking it not to act on the list is
the kind of rule this repository has already learned is not a rule.

That is the whole asymmetry. The peer is not made ignorant — it answers board
questions accurately when asked, and an occasional peer tally is accepted rather
than guarded. The peer is made **passive**.

## Where each piece goes

- The deterministic block — board, coverage, and for the leader the live list —
  is injected identically into the Judge and into generation. `score` is
  recorded but is not in the block: `docs/adr/0009` keeps it out of anything
  that decides what the group works on next.
- *What may be done with it* goes in the Judge's role goal.
- *How it is said* goes in the route prompts.

The peer's inputs stay what they are: the request in front of it and its own
profile, with the board available as grounding for an answer.

## What must not regress

- No new `RouteKind`. The nine are the whole set, and route-distribution
  comparisons across conditions depend on that
- The 30-key prompt snapshot, its startup hash check, and the orthogonality
  assertions in `test-intervention-v2` keep passing unchanged
- Nothing in the block changes cooldown, floor, route delay or lifecycle
- A Member still never gains mediation or task-standard correction

- [ ] The leader's Judge input contains the live list; the peer's does not
- [ ] Removing the list from the leader's input changes a leader decision in a fixture, and changes no peer decision
- [ ] The peer answers a direct board question correctly with the list absent
- [ ] Prompt-hash verification and the orthogonality assertions pass untouched

## Comments

### From issue 02: the removal rule has a gap before it reaches anyone

Issue 02 landed the shadow list and replayed the 39-session export against it.
In T-C1-016 the pooled answer is set aside while it is the best-covered candidate
on the board — coverage 4, score 0, against a leader on score 3. The coverage
clause only protects a candidate that is *behind* on coverage, and the pooled
answer is typically ahead of it early: its misses are shared across profiles and
surface first, its matches are distributed and surface last.

A leader steering by this list would steer away from the right answer in the one
session shape the study exists to produce. Whatever else 03 does, it does not
start by handing the leader the rule as written. The replay is a weak instrument
— pre-repair architecture, deterministic keyword extractor — so issue 01's
sessions are still the evidence; this says what to look for in them.

### Resolved: the rule was redesigned before this issue starts, 2026-09-08

`docs/adr/0009` replaces the score-based removal rule with coverage alone. What
reaches the leader here is therefore a list of candidates the group has not
pooled anything about — where attention is still owed — and not a ranking.

Two consequences for this issue. The list can no longer express a verdict, so
the risk this comment was opened about is gone at the source rather than guarded
against downstream. And the leader's move on it changes wording: not "let's set
C aside" but "nobody has said anything unshared about D yet", which is the
discussion management `0007` licensed in the first place.

`score` still reaches one place, and only one: the weakest-candidate defence in
issue 05, where the inversion runs in the protective direction.
