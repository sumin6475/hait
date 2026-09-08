# 02: Compute the live candidate list, and let it reach nothing but the log

**What to build:** A deterministic per-turn derivation of which candidates are
still live, written to the turn record and to nothing else.

**Blocked by:** None. It is shadow-only, so it can land before issue 01's
sessions — and should, because those sessions are what validates its thresholds.

**Status:** ready-for-agent

## What it computes

Every turn, from the board only:

- `coverage(X)` — distinct traits on the board for candidate X, matches and
  misses together. `surfacedByCandidate` in `poolingTally.ts:126` already returns
  exactly this, over human `revealedIds` ∪ `aiSurfacedIds`.
- `score(X)` — matches minus misses on the board. Every trait weighs the same;
  `CONTEXT.md` says treating one as decisive is an error the group can make, and
  it is not one Alex may make on the group's behalf.
- X leaves the live list when **all three** hold: `coverage(X) >= 4`;
  `coverage(X) >= max(coverage of other live candidates) - 2`;
  `max(score of live candidates) - score(X) >= 2`.

Recomputed from scratch each turn. Nothing is carried, so a candidate re-enters
the moment new information puts it back — no separate reopening path exists,
because there is no stored state to reopen.

## Why the board and not everything Alex knows

Alex holds profile Z. If the list were computed over Z as well, Alex would
converge on the pooled answer ahead of the group in every condition, and in the
leader conditions would then steer toward it. The decision-accuracy DV would be
measuring Alex's private card. Computing over the board means Alex's own
information counts only once Alex has said it — where the pooling DV records it.

`poolingTally.ts:125` already notes that unspoken Z appears in neither source
set, so this property is inherited rather than built.

## Why it may not reach speech yet

`4` and `2` were chosen, not derived. The 39-session export is a different
architecture and cannot be replayed against them. Letting an unvalidated
threshold drive live speech, and then reading the session as evidence about the
design, is the mistake `CONVERSATION-REPAIR-CHECKPOINT.md` §6 names as letting a
plausible causal story outrun the data.

## What must not regress

- No model call is added. The derivation is arithmetic over state already computed
- No route, cadence, floor, or veto reads it
- The Observer and the extractor do not see it and do not change
- Both conditions compute it identically; issue 03 is what makes it condition-dependent

- [ ] `coverage`, `score` and the live list are on the turn record every turn
- [ ] Reverting the derivation fails a test that drives it from a real transcript
- [ ] A candidate with high `score` and low `coverage` stays live — the hidden-profile case
- [ ] A shadow-only assertion: no live routing, cadence or generation input differs with the field present or absent
