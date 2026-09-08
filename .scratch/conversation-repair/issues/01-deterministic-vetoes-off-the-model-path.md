# 01: Record the cooldown veto before paying for the model

**What to build:** On a turn where the cooldown already makes speech impossible,
Alex's silence is recorded immediately instead of after two model calls. Today
every such turn pays a full Observer and a full Judge to arrive at a decision
that pure arithmetic over the transcript had already made.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] A turn blocked by the cooldown and provably incapable of a bypass records
      its silence without an Observer call or a Judge call
- [ ] A turn that is not provably exempt still runs the Observer, and skips only
      the Judge, and only when the ledger shows no takeable act
- [ ] The observation still runs and still persists on skipped turns
- [ ] A `required` opportunity arriving during the cooldown still reaches
      broadcast; regression covers both directions
- [ ] The `silenceReason` distribution is unchanged apart from the turns that
      got faster
- [ ] Silent turns measure ≤ 1 s, by the per-turn arithmetic already used
      (`observer + judge + max(floor, generation)` against measured elapsed)
- [ ] No code on this path reads the condition
