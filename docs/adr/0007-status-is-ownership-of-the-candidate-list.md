---
status: accepted
date: 2026-09-08
---

# Status is ownership of the candidate list, not the right to speak more

Alex's status was manipulated through role framing, through condition prompts,
and — since `0001` — through the Judge's role goal. What it was never given was
an observable decision procedure. A Chair and a Member could be told they were
different and then make structurally similar moves, so "leaderness" showed up as
tone, as volume, and as who spoke last.

The manipulation is now: a leader owns the list of candidates the group is still
working on, and a peer does not have one.

## What a list is, and what owning it licenses

The list is derived every turn from the board. Owning it means the leader may
name a candidate the group has skipped, announce that one is being set aside,
raise a coverage shortfall once when the group moves to close, and re-argue the
weakest candidate once before the end. A peer does none of those. It answers
what it is asked, contributes its own information, and follows the group.

Leaving the list means only that Alex stops steering toward a candidate and stops
volunteering new information about it. Alex still answers questions about it, and
the candidate is removed from nobody's choice.

**Amendment, 2026-09-08.** What makes a candidate leave has changed, and with it
what the second move says. `0009` withdraws the score-based removal rule — over a
shared-dominated board score ranks the candidates backwards — so a candidate now
leaves on coverage alone, and "announce that one is being set aside" is now
"say the group has pooled something about this one, and nothing yet about that
one". The move is still the leader's and still absent from the peer; it can no
longer carry a verdict.

**Amendment, 2026-09-13.** Coverage is withdrawn too: `0011` has a candidate leave
once a human has pooled something of their own about it.

## Three things this decision refuses

**It does not mint turns.** The originating proposal had the leader speak on
state transitions. Intervention triggers and timing are held constant across
conditions, and `0001` states the property precisely: no rule about *when* Alex
may speak reads the condition. A transition that creates a turn breaks it. The
frame changes what Alex does on a turn it already qualifies for.

**It adds no route.** The nine in `RouteKind` are the whole set. Route-mix
comparisons between conditions — which the study reports as a confound control —
lose their baseline the moment the set differs by condition beyond the three
Chair-only routes that already differ.

**It does not make the peer ignorant.** Both conditions see the same board. The
peer was going to be blocked from reading it; that would have made Alex's held
information differ by condition, contradicting the fixed term of the design and
`CONTEXT.md`'s condition-invariant definition of **Known**, and it would have made
the peer answer board questions wrongly. The peer is passive, not uninformed. An
occasional peer tally is accepted and recorded rather than guarded, because a
guard that fires in one condition only is itself a confound.

## The one boundary that needed a sharper line

A peer that is told to take up what was just said will take up a procedural
proposal, because that is what the previous message was. T-C3-003 seq 5 is the
worked example: a peer answered a proposal to eliminate a candidate with "I see
your point, **but** I have an additional note", which is a leader's move.

So uptake is not what differs. What the uptake may attach to is: a peer takes up
content, a leader may also take up the group's procedural move. The same
information goes out in both conditions — restricting what a peer may share would
make the conditions differ in how much reaches the pool, on the very measure the
study is about.

## Considered and rejected

**A four-stage state machine with declared stages and a stage-transition speech
trigger.** It required the turn-minting above, and its stage would have been a
carried state that a group re-widening its options could not reverse. Recomputing
the list every turn gives the same convergence tendency without either problem.

**A server-rendered generator with condition slots.** The measured improvement
between T-C2-043 and T-C2-045 came from post-conditions on model output, not
from templating, and server-side checks are by 2026-09-08 the largest single
source of lost turns.

## Consequence to watch

Leader turns carry procedural speech that peer turns do not, so leader token
volume rises for a reason unrelated to content. Message length and count go into
the analysis as covariates, and the route mix is reported per condition.
