# 16: Alex states a next step and nothing holds it to it

**What to build:** When Alex tells the group what it will do next, the group can
expect it to happen — or to hear why it did not. Today the statement leaves no
trace anywhere in the system.

**Blocked by:** None (can start immediately).

**Status:** needs-triage

## The defect, as observed

**T-C2-045 seq 22.** Alex said it would present its notes on Candidate D. It
never did, and the group never heard why.

Nothing was broken. There is simply nothing to break: **an opportunity is minted
only from a human source message.** Every branch in `observerDeltaFromTurn` is
built off the human turn being observed, and `reduceConversationLedger` rejects
any proposal whose `sourceRole` is not on the human roster
(`opportunity:<seq>:<kind>:invalid`). So Alex's own sentence produced no ledger
object of any kind — not an open one, not an expired one, not an audit line.

Issue 13 half B made an unanswered *request* survive the turn it was made on.
This is the same shape from the other direction and half B cannot be extended to
reach it, because there is no object for a selectability rule to keep alive.

## Why it is worth its own ticket

The failure the operator keeps naming is Alex behaving like a notes reader
rather than a participant. Announcing a contribution and not making it is a
sharper version of that than any wording problem: the group adjusts its own
turn-taking around the announcement.

It is also the one case where the obligation is *Alex's*. Every other object in
this ledger records what the group is owed by Alex because a human asked. This
one would record what Alex owes because Alex offered — a different lifecycle,
with a discharge condition ("Alex said the thing") that no human message closes.

## What must be decided before building

- **Is a commitment an opportunity, or a new object?** Reusing
  `ResponseOpportunity` means relaxing the human-source rule that currently
  keeps the reducer's provenance clean. That rule is load-bearing; weigh a
  second object type against weakening it.
- **What discharges it, deterministically?** "Alex presented its notes on D" is
  a semantic judgement, and the reducer must not make one. A trait-id test over
  `revealStats` may be enough for the pooling case and nothing else.
- **What happens when it is not discharged?** Prompting Alex to keep its word is
  a change to *when* Alex speaks, which is held constant across conditions. It
  may be that the honest fix is to stop Alex announcing future steps at all,
  which is an output-contract change and cheaper.

## What must not regress

- The cadence stays condition-invariant arithmetic. A commitment must not become
  a reason to speak sooner or more often
- Opportunity provenance stays auditable. If a non-human source can mint one,
  the audit must say so on every line
- No new model call on the accept path
- Silence stays attributable
