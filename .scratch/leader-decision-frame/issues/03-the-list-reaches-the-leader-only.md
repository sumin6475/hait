# 03: The candidate list reaches the leader, and the frame reaches the Judge

**What to build:** Give the live candidate list to the leader conditions as an
input to the decision, and to the peer conditions not at all.

**Blocked by:** 01, 02.

**Status:** needs-triage

## The manipulation this realises

Status is ownership of the decision procedure. The board is raw shared context
and both conditions get it; the live list is the procedure's output, and only the
leader gets it. Giving the peer the list and asking it not to act on the list is
the kind of rule this repository has already learned is not a rule.

That is the whole asymmetry. The peer is not made ignorant — it answers board
questions accurately when asked, and an occasional peer tally is accepted rather
than guarded. The peer is made **passive**.

## Where each piece goes

- The deterministic block — board, coverage, score, and for the leader the live
  list — is injected identically into the Judge and into generation.
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
