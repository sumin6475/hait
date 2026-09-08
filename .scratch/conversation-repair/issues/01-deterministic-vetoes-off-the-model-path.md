# 01: Record the cooldown veto before paying for the model

**What to build:** On a turn where the cooldown already makes speech impossible,
Alex's silence is recorded immediately instead of after two model calls. Today
every such turn pays a full Observer and a full Judge to arrive at a decision
that pure arithmetic over the transcript had already made.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

The cooldown is `messagesSinceLastAI(docs) >= COOLDOWN_MIN_MSGS`, computed from
documents already loaded before either model call runs, and applied as a router
veto after both have finished. In **T-C1-024** every non-greeting silence was
that veto, and in **T-C1-025** it was three of five turns. Silent turns cost
6.3–10.3 s to produce nothing.

## The two skips

The same decision can be proved at two points, at different precision, so it is
made twice rather than once badly.

**Before the Observer — conservative.** Skip only when it is provable that no
opportunity capable of bypassing the cooldown could be minted this turn: the
message names no participant, asks nothing, and is not the first message after
an Alex turn (an `uptake` cannot exist otherwise). Anything not provably exempt
takes the normal path. The test is arithmetic and string matching; it needs no
model call.

**After the Ledger, before the Judge — exact.** By this point the opportunities
exist, so the bypass rule is evaluated against real opportunities rather than
guessed at. A turn on which no act is takeable does not reach the Judge at all.

The Observer still runs on the skipped turns, off the decision path, so the
ledger stays current for the next turn. The work still happens; it stops
blocking a decision that does not depend on it.

## What must not regress

- **Silence stays attributable.** A turn skipped here records `cooldown` and
  never `no_useful_move`. Generation failure, the floor, lifecycle and the
  cooldown are required to remain distinct reasons.
- **The bypass survives.** An opportunity with a `required` expectation, and an
  `uptake` invitation on the foreground thread, must still speak through the
  cooldown. Turning a direct question during cooldown into silence is exactly
  the conflation the invariants forbid, and it is the whole risk of this change.
- **The cooldown stays condition-invariant.** Neither the constant nor the
  arithmetic may learn the condition. Chair and Member must be blocked and
  released on identical turns; only what Alex decides to say may differ. See
  `docs/adr/0001-condition-reaches-the-judge.md`.
- **The ledger must not fall behind.** The off-path observation still persists,
  and a missed turn stays recoverable by the path the conversation-recovery
  suite already covers.

## Scope

Only the first of the two decided steps for the Observer is in scope. The second
— splitting the Observer into a small call that gates the decision and a full
call behind it — is deliberately held back until this one has been measured. It
is a new schema, a new prompt, a version bump and a reconciliation rule, and it
should not be designed against a budget nobody has measured yet. This step is
small, reversible, and confined to one predicate; the next one is not.

- [~] A turn blocked by the cooldown and provably incapable of a bypass records
      its silence without an Observer call or a Judge call — **not built; the
      test can never fire, see below**
- [x] A turn that is not provably exempt still runs the Observer, and skips only
      the Judge, and only when the ledger shows no takeable act
- [x] The observation still runs and still persists on skipped turns
- [x] A `required` opportunity arriving during the cooldown still reaches
      broadcast; regression covers both directions
- [~] The `silenceReason` distribution is unchanged apart from the turns that
      got faster — **one reason shifts**, see below
- [ ] Silent turns measure ≤ 1 s, by the per-turn arithmetic already used
      (`observer + judge + max(floor, generation)` against measured elapsed) —
      **unreachable: the Observer cannot be skipped. Expect ~20% off a blocked
      turn, not ~97%.** Needs a live run to confirm
- [x] No code on this path reads the condition

## Comments

Landed 2026-09-08. **One of the two skips was built. The other cannot fire, and
the measurement says so.**

### The pre-Observer skip was not built, because it is dead code

The design gated the fast path on a conservative test: the message names no
participant, asks nothing, and **is not the first message after an Alex turn** —
that last clause because an uptake, which speaks through the cooldown, cannot
exist otherwise.

But the cooldown blocks only when there are fewer than two human messages since
Alex, and a decision turn always has at least one. **So the only turns the
cooldown blocks are exactly the turns the test excludes.**

Checked rather than argued. In T-C1-027, all **15 of 15** cooldown-staged
decisions had exactly one message since Alex. In T-C2-041, both of two. The fast
path would have fired **0 times in 17**.

This repository has a precedent for what to do here, from B8: two of three review
triggers turned out to be unable to fire and were deleted rather than kept. Dead
code that looks like an optimisation is worse than no code — the next reader has
to work out that it never runs. **Not built; recorded instead.**

The consequence is that the gate's headline number does not survive. A blocked
turn was predicted at 6.3–10.3 s → ~0.2 s. What is actually removable is the
Judge: on those same 15 turns it cost 20.2 s in total, mean 1.34 s, against
80.5 s of Observer that still has to be paid. **About 20% off a blocked turn, and
15 fewer model calls per session.** Real, and an order of magnitude short of the
estimate.

This also changes what issue 10 is worth. Overlapping the Observer was already
the only option that helps spoken turns; it is now the only option that
meaningfully helps silent ones either.

### What was built

`deterministicVetoBeforeJudge(state, { cooldownAvailable })` returns the veto the
router would apply, or null. The Judge is called only when it returns null.

Three things about its construction are deliberate.

**It is built from the decision projection**, not from a second reading of the
same rules. The projection already filters out opportunities the cooldown
forbids, and its own comment records why: the prose summary and the serialized
ledger were built separately once and disagreed. A private copy of "what can Alex
take this turn" would have been the same mistake a third time.

**It covers both deterministic vetoes, not just the cooldown.** A held human
floor is the same defect — a pure function of settled state, applied after two
model calls. The issue's title is plural and this is the other one.

**The floor is reported before the cooldown**, matching the order the router
applies them, because the invariants require those two silences to stay distinct.

**One reason genuinely shifts.** A floor-held turn used to be able to record
either `ledger_human_floor_held` (the Judge saw the floor) or
`ledger_router_human_floor_held` (it did not and the router caught it). With the
Judge skipped, a turn whose *state* holds the floor always records the router
reason, which is what actually happened. The Judge reason stays reachable for a
turn where the Judge reads a floor the state does not hold. No test asserted on
either string.

**Shadow mode still calls the Judge on every turn.** Skipping there would thin out
the comparison the mode exists to produce, and the invariant says shadow mode
must not alter cadence.

**A skipped turn is distinguishable in the record**: reason `cooldown` with an
empty Judge-attempt list. A paid one has attempts. That distinction is the whole
of what replaces the measurement we chose to give up, and it is worth knowing it
is there — the same observability point issue 09 makes at larger scale.

### One thing fixed on the way

`interventionJudge.ts` held a second, inline copy of the reducer's human-floor
rule — four lines duplicating the exported `humanFloorHeld`. That is the exact
shape B9 had to unify between the opportunity derivation and the floor check,
which cost three consecutive turns before anyone noticed. Replaced with the
shared function.

### The test, and its first attempt

Tested at the existing deterministic-reducer seam as a pure predicate; no new
seam. Three breaks confirmed the assertions fail: ignoring the bypass rule,
dropping the "targets Alex" filter, and inverting the veto order.

**The ordering assertion was vacuous on its first attempt** — the fifth in this
repair. Its fixture held a required opportunity, so the correct order and the
reverse both returned the floor and the test passed with the order inverted.
Replaced with a fixture where the two vetoes disagree. Recorded in the
checkpoint's method note.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
yet measured live** — and the server must be restarted before it can be.
