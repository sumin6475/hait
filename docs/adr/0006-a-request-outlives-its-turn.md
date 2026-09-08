---
status: accepted
date: 2026-09-08
---

# A request outlives its turn; a licence to follow does not

An opportunity marked `invited` used to be selectable only on a turn whose seq
appeared in its own evidence — in practice, exactly one turn. That rule now
applies to `uptake` alone. A request somebody made of Alex stays selectable
until it is answered or the reducer retires it.

## What the single rule was hiding

Two different objects shared the `invited` expectation.

An **uptake** is minted because a human replied to Alex. Nobody asked Alex for
anything; the opportunity is a licence to carry that reply one step further, and
the licence *is* the reply being fresh. For an uptake the current-trigger
requirement is not staleness bookkeeping — it is what the opportunity means.

An **invitation** or **group_request** is somebody asking Alex for something.
That is an obligation, and an obligation does not stop existing because the next
message was somebody else's. Under the single rule it did: from the turn after
it was made, the projection filtered it out of the Judge's view while
`state.opportunities` went on reporting it open.

One measured session shows the shape at its worst. A request addressed to Alex,
read correctly by the Observer at every field, was **never selectable on any
turn**: the cooldown filtered it on the seq it was current, and the invited rule
filtered it on every seq after. Alex spoke three times with it open and answered
something else each time — not by preferring a voluntary act over it, but
because it was never among the options.

## What bounds an unanswered request now

Its own seq no longer does, so the reducer's three retirement paths do, and all
three are seq arithmetic that was already there:

- the thread closes, and its opportunities close with it;
- Alex answers on the thread, and strictly older non-required opportunities on
  that thread are superseded;
- the [B4] TTL expires it eight seqs after it was opened.

## Consequence, and what it deliberately does not change

The cadence is untouched. `opportunityMayBypassCooldown` still requires
current-trigger evidence, so an older request never speaks through the cooldown
— it becomes an option only on a turn where Alex could already have spoken
voluntarily. `deterministicVetoBeforeJudge` returns exactly what it did before.

The ranking — an unanswered request outranks a voluntary act — is stated in the
Judge's prompt and listed beside the ids on every turn, and nothing rewrites the
Judge's answer afterwards. Enforcing it by rejection was the alternative and was
rejected: the retry's cheapest always-valid output is `silent`, so a ranking
enforced that way buys silences rather than answers.

The ranking stops at voluntary acts and deliberately says nothing about the
order *among* requests. `current_required_opportunity_not_selected` already
decides that, and a prompt that argued with its own validator would buy the
retry's cheapest answer by another route. A first draft of this change did
exactly that, and the constraint it broke is the one this projection exists to
uphold.

The predicate is one exported function that the Judge's prompt, its validation
and the pre-Judge veto all read. It had been written out twice, in the
projection and in the validator, which is how a prompt could once offer a choice
its own validator rejected.

## What this does not reach

Alex's own stated next steps. A commitment Alex makes — "I will present my notes
on D" — creates no ledger object at all, because every opportunity is minted
from a human source message and the reducer rejects any proposal that is not.
Tracking what Alex owes the group is a different object with a different
lifecycle. See the tracker.
