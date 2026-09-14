# 10: Split the Observer into a fast decision call and a full one behind it

**What to build:** The turn stops waiting for the whole observation. A small call
returns only what this turn's routing needs and gates the decision; the full call
runs off the decision path and merges into the ledger before the next turn.

**Blocked by:** 01 — this is the second of the two decided steps, and it must not
be designed against a latency budget nobody has re-measured.

**Status:** wontfix

**Closed, 2026-09-14 (decided 2026-09-09).** The alternative recorded below as
rejected is the one taken: the Observer and the Judge moved to `gpt-5-mini`. A
measurement first found the research-only fields were 7.7% of the Observer's output,
so a split would have saved under half a second, and T-C4-023 and T-C2-050 ran at a
median of 1.6 s and 2.1 s a turn. `docs/adr/0005` is superseded.

## Why the split exists

The Observer produces two kinds of output, and only one of them gates the current
turn.

| output | who needs it | when |
| --- | --- | --- |
| addressees, Alex's relation to the message, the speech act, how explicit the request was, the floor, and the proposed opportunities | this turn's routing decision | **now** |
| the thread revision, candidates, salience, conversation phase, request detail, thread bookkeeping | the ledger, for later turns | before the *next* decision |

The whole call is awaited for the first row alone.

## The latency claim, and why it is a measurement rather than an extrapolation

The Judge is the existence proof. It is the same model, in the same sessions, on
comparable input of 1.1–1.9 k tokens, emitting 36–46 output tokens — and it runs
in **1.0–1.7 s**. That is a measurement of a small call. It matters that this is
not an extrapolation from a large one, because payload size was already shown not
to predict Observer latency inside the Observer's own range.

Expected: critical path ~6.5 s → ~1.5–2 s, median turn ~9.4 s → ~5 s. **This is
the only step that helps *spoken* turns**, which is what participants experience
as slow — one T-C1-025 turn took 13.6 s.

Cost: two Observer calls per turn instead of one. The added call is small and the
large one is unchanged and no longer blocks.

## What must not regress

- **The fast call is authoritative for the decision it gated; the full call is
  authoritative for state.** Never a retroactive re-decision. A successful
  broadcast is the only thing that consumes an opportunity, and a late
  observation must not undo one.
- **A stale ledger must be bounded, not merely unlikely.** If the humans type
  faster than the full call returns, the next decision runs on a ledger one turn
  behind. Burst supersession already handles the analogous case, and the
  opportunity TTL bounds how long a missed opportunity lingers — say which of
  the two covers each way this can happen.
- Neither call may read the condition.
- Silence stays attributable: the split must not introduce a reason that is not
  already one of the distinct ones.

## Scope

**This is a gate, not a patch**: a new schema, a new prompt, a version bump, a
reconciliation rule between the two calls, and regressions for each. Do not start
it before issue 01 has been measured — its whole justification is that the
Observer is the entire remaining budget, and that claim is currently a year-old
inference from a build that has since changed twice.

Rejected alternative, recorded so it is not proposed again: swapping in a faster
Observer model. See `docs/adr/0005-no-model-swap-for-latency.md`.

- [ ] The decision path awaits only the small call
- [ ] The full observation still persists and still reaches the ledger before the
      next decision
- [ ] A disagreement between the two resolves by the rule above, with a
      regression in both directions
- [ ] No turn is re-decided after the fact
- [ ] Spoken turns measure ≤ 6 s by the existing per-turn arithmetic, with no
      rise in wrong-candidate turns and no new ledger conflict codes


## Comments

### Not started, and why

The blocker is unmet. Issue 01 is `done` but its own closing line says **"Not yet
measured live — and the server must be restarted before it can be."** No session
has run since; nine issues' worth of changes have landed on top, verified by
build and suites only.

This issue's entire justification is that the Observer is the whole remaining
latency budget, and its own scope note says so in as many words: *"Do not start
it before issue 01 has been measured — its whole justification is that the
Observer is the entire remaining budget, and that claim is currently a year-old
inference from a build that has since changed twice."* It has now changed rather
more than twice. Designing a two-call split, a new schema, a new prompt, a
version bump and a reconciliation rule against an unmeasured budget is exactly
what that sentence forbids.

Two things also make the current numbers less predictive than they were, both
from work done since:

- Issue 01 takes the Observer **and** the Judge off every deterministically
  vetoed turn. In T-C1-024 that was every non-greeting silence; in T-C1-025,
  three turns of five. The Observer's share of a silent turn is now zero, and the
  split only ever helped spoken turns anyway — so the measurement needs to
  separate the two populations, which no run has yet done.
- Issue 03 set `verbosity: "low"` on the generator, which moves generation
  latency. The critical-path arithmetic this issue quotes predates it.

`needs-info` rather than `ready-for-agent`: what is missing is a measurement, and
that is the maintainer's to supply. Restart the server, run a session, record it
in `docs/measurements.md` with spoken and silent turns separated, and this
becomes actionable — or stops being worth doing, which is also an answer the
measurement can give.
