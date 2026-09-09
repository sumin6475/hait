# 26: The Chair summary is armed and can never fire

**What to build:** A decision first. The summary route is unreachable on the live
controller, and whether that is a loss depends on whether the Chair's mid-discussion
recap is part of the manipulation or a leftover. Only after that is settled is
there code to write.

**Status:** needs-triage

## The defect, as observed

Found by reading, not by a session. `armSummaryIfEligible` still runs on the live
path and still flips the session to `summaryStatus: "pending"`, but **nothing on
the live path ever consumes that state.** A Chair session can log
`[intervention-v2] summary armed` and then never summarise.

The two consumers of `summaryStatus === "pending"` both sit on paths that
`ledger_active` returns before reaching:

| consumer | file | reachable in `ledger_active`? |
| --- | --- | --- |
| legacy fallback route gate | `interventionEngine.ts:546` | no — inside `runLegacyObserverFallback`, whose only call site is line 2080 |
| post-ledger route gate | `interventionEngine.ts:2247` | no — every branch of the `controllerMode === "ledger_active"` block (1900–2050) returns |

The arming call is at line 1832, *before* that block, so it keeps running.

There is no third trigger. The Judge cannot produce one either: `summary` is not
in the act enum, and `ledgerRouteKindForAct` returns only `address`, `followup`,
`build_on`, `backchannel` and `mediation`. `RouteKind` still has nine members;
the live controller can reach seven of them.

`CONVERSATION_CONTROLLER_MODE` has defaulted to `ledger_active` since the ledger
work landed (362416b, 2026-09-06), so every session recorded on this build is
affected. Sessions before it — T-C2-043 is the one that ran to completion — were
on the pre-repair build, where the route did fire.

### Two separate consequences

**The Chair loses a route.** `C2.summary.v1` and `C4.summary.v1` remain in the
30-entry registry and are now dead keys. Their content is deterministic —
`formatDeterministicSummary` builds the recap from `revealStats` and no model is
called — so what is lost is a scheduled board recap, not a generated turn.

**The session record lies.** `aiState.summaryStatus` reaches `pending` and stays
there. Anyone auditing a Chair export will read an armed summary that never came,
and there is nothing in the record to distinguish "armed and suppressed" from
"armed and structurally impossible". That is the more expensive half: it is a
false state in the data, not only a missing behaviour.

## What has to be decided before anything is built

**Is the Chair summary part of the leader manipulation, or an artefact?**

It is not obviously either. The argument for restoring it: summary, mediation and
closing are the three Chair-only routes, and the registry's asymmetry (nine leader
routes against six peer routes) is the manipulation written down. Dropping one of
the three thins what "Alex chairs this group" means in practice, and it does so
silently, only on the live build, which is exactly the kind of difference that
must not vary by accident between conditions.

The argument against: the summary was a scheduled interrupt on a timer and a
coverage threshold — arithmetic about *when* Alex speaks, decided outside the
Judge. The ledger controller exists to put speaking decisions on one path, and
`ADR-0001` draws the line the role goal must not cross: a Chair may differ in
*which act* and *on what grounds*, never in *when*. A route that fires because ten
minutes elapsed and eight traits are on the board is the second kind. If it
returns as-is it puts a condition-dependent timer back on a path deliberately
cleared of them.

Both readings are live. This issue exists to force the choice rather than let the
current state stand as one by default.

## The three shapes a fix could take

1. **Restore the gate.** Re-check `summaryStatus === "pending"` inside the
   `ledger_active` block, ahead of the Judge call, and reserve the summary turn.
   Cheapest, and re-introduces the condition-dependent timer above.
2. **Make it an act.** Give the Judge a `summarise` act for leader conditions
   only, gated on the same coverage state, so the recap competes with every other
   move on the one path. Keeps the single decision seam; costs a schema version,
   a prompt version, and a re-run of the golden set.
3. **Retire it.** Delete the arming, drop the two registry keys, and record in
   `docs/adr/` that the Chair no longer summarises and why. Cheapest to reason
   about, and the only option that makes the session record honest without new
   behaviour.

Option 3 is the one to take if the answer to the question above is "artefact".
Do not leave the arming in place under any option — a state that cannot be
consumed is the defect regardless of which behaviour wins.

## What must not regress

- Pacing stays condition-invariant. Whatever restores the recap must not make a
  Chair speak sooner or more often than a Member for a reason the Member has no
  equivalent of (`ADR-0001`)
- The peer conditions keep no summary route. The registry's 6/9 asymmetry is the
  manipulation and must not be flattened to fix an audit problem
- Silence and non-events stay attributable. If the summary is retired, the
  session record must stop claiming it was armed
- No new model call: the recap is deterministic today and must stay so
- The 30-key registry check at startup holds — dropping keys means dropping the
  count assertion in `routePromptRegistry.ts` in the same change

## Acceptance

- [ ] The question above is answered and recorded — an ADR if the answer is
      "retire", a line in this issue if it is "restore"
- [ ] `aiState.summaryStatus` can no longer reach a state nothing consumes
- [ ] A Chair session on the live controller either produces the recap, or
      records no summary state at all
- [ ] `npm run test:intervention-v2` covers whichever outcome was chosen,
      including that peer conditions are unaffected

## Comments

### How this was found

While redrawing `ai-intervention-flow.mmd`, which had gone stale against the
legacy controller. Tracing every reachable route from `onHumanMessage` left
`summary` with no inbound edge on the live path. No session evidence was used and
none is needed — the unreachability is static, and reading the two call sites
above is the whole proof.

It does mean the frequency question that governs most issues here does not apply.
The behaviour does not occur rarely; it cannot occur at all.
