---
status: accepted
date: 2026-09-13
---

# The Chair's board recap is an act the Judge takes, not a turn a timer schedules

The Chair may put the board back in front of the group exactly as it stands. It
is a communicative act, `recap`, chosen by the Judge alongside every other move.
It replaces a route that five thresholds used to schedule.

## What was there, and why it had to go

`armSummaryIfEligible` set `summaryStatus: "pending"` once a session, when ten
minutes had elapsed, twelve human messages had been sent, eight traits were on
the board, two candidates were covered, and five minutes still remained. A later
gate turned that state into a reserved `summary` turn.

**Two things were wrong, and they are separate.**

The gate was unreachable. Every branch of the shipped controller returns before
it. A Chair session could log `summary armed` and never summarise; T-C2-052 did,
at seq 46. The session record then carried a state nothing could consume — an
armed summary that never came, indistinguishable from one suppressed.

And the arming was arithmetic about **when** Alex speaks, decided outside the
Judge and only in leader conditions. `docs/adr/0001` draws exactly that line: a
role may reach *which act on what grounds*, never *when*. A route that fires
because ten minutes elapsed puts a condition-dependent timer back on a path
deliberately cleared of them.

Restoring the gate would have fixed the first and kept the second.

## The act

`recap` is in the leader schema and not in the member schema, so a Member cannot
express it — the same construction as `mediate`, for the same reason
(`docs/adr/0001`): orthogonality belongs in the action space, not in a prompt
rule a model can be talked out of. The routing seam locks it a second time.

It is offered as a move on the turns it is Alex's to take:

- the condition is a leader's,
- the board is not empty,
- the Chair has not already recapped,
- and the cooldown is available, because a recap is a voluntary act.

**No clock and no message count.** Every threshold the old arming used is gone.
Once a session is a bound on repetition rather than on timing, of the same kind
as the leader frame's "raise it once at narrowing and once at closing".

The Judge decides *when it is worth taking* from the turn facts it already has,
which is the whole of `docs/adr/0010`: the stage that reads the conversation is
the stage that decides what the turn is for.

## The message is assembled, never written

The recap recites `revealStats` — every trait on the board, per candidate, as
matches and misses — with no model call. That property is older than this ADR and
is the reason the route exists at all. T-C2-051 seq 48 is what the alternative
costs: a summary the model wrote from the transcript, missing `A_n4`, which had
been on the board since seq 39.

So a `recap` names no trait. `discloseTraitIds` must be empty and the validator
rejects it otherwise: a recap that also carried a fact would not contain it.

## What this does not change

- **Pacing stays condition-invariant.** The recap costs a voluntary act on a turn
  the cooldown already permits, exactly like `contribute` and `follow`. A Chair
  does not speak sooner or more often for having it.
- **Peers keep no recap.** The registry's leader/peer asymmetry is the
  manipulation and is untouched; `C2.summary.v1` and `C4.summary.v1` stay live
  keys and the 30-key check holds.
- **`aiState.summaryStatus` can no longer reach a state nothing consumes.**
  `not_eligible` now means "the Chair has not recapped", `generating` means in
  flight, `done` means spent. `pending` is written by nothing; a session recorded
  before this ADR that carries it is read as `not_eligible`.

## What to watch

The recap's wording still ends with a next step ("the next step is to resolve the
most relevant differences in these visible profiles"). That is coverage
management rather than a decision rule, so it stands — but it is the nearest
thing in the deterministic text to the procedure-proposing the brief rules
forbid, and it is worth reading on the first session where a Chair takes it.

Whether the Judge takes it at a useful moment is the open question. Nothing in
the turn facts says "the discussion is late"; the Judge has the transcript, the
coverage sentence and its own read, and decides from those.
