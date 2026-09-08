# 08: Read Alex's pooling contribution from who said it first

**What to build:** Nothing in the server. An analysis decision, and the function
it needs already exists.

**Blocked by:** None.

**Status:** ready-for-human

## The question

`computePoolingDV` derives `byProfile.Z` — "how much of its own profile Alex put
into the pool" — from the whole of `revealStats.aiSurfacedIds`. That set includes
traits a human surfaced first and Alex later repeated. T-C3-003 seq 48 put three
such traits into it in one message.

So the headline figure for Alex's contribution counts restatement as
contribution, and the leader conditions — which summarise and close — have more
opportunity to restate than the peer conditions do. The inflation is not evenly
distributed across the design.

## What already exists

`revealStats.firstBy` records, per trait, who surfaced it first and at which seq.
`splitAiContribution` (`poolingDV.ts:108`) reads it and returns `firstCount` and
`restatedCount`. Neither is stored; both are derived on demand.

Sessions before that field existed have no `firstBy` entries, and
`splitAiContribution` skips those ids rather than guessing. Those sessions can
report the total only, and must say so.

## The decision

Report `byProfile.Z` on `firstCount`, with the total alongside it. "How much of
its own information Alex put into the pool" is a claim about first surfacing, and
that is the number the DV's own definition asks for.

- [ ] Analysis reads `firstCount`; the total is reported beside it, not instead
- [ ] Sessions predating `firstBy` are marked as total-only wherever they appear
- [ ] `docs/measurements.md` says which figure each entry is
