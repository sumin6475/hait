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
