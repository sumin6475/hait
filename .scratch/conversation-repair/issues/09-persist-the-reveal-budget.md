# 09: Record the reveal budget in the turn, so it can be audited afterwards

**What to build:** A session export says what Alex was allowed to reveal on each
turn, and what it actually revealed. Today it says neither, so nobody can tell
from the record whether a guard held.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

**T-C2-041** seq 4 is a 59-word Alex message that names all four candidates on
Alex's second turn of the session. That is the exact shape the per-turn reveal
budget exists to prevent.

It cannot be checked. The intervention record carries `outputScopeRepaired`,
`outputScopeCandidate` and the focus fields, and carries **no guard fields at
all** — not the new-trait bound, not the restated bound, not the trait ids that
were extracted from the message. So there are three possibilities and the export
distinguishes none of them: the guard was set and the message passed it; the
guard was set and was violated; or no guard was set for that route.

The suspicion is therefore recorded as unverified and must stay unverified.

## Why this matters more than one message

The guards were already found to be passing vacuously once. In **T-C1-027**,
three messages shipped six to eight traits each on turns whose guard was
correctly set to one, and recorded no violation, because the extractor's failure
was indistinguishable from a message that revealed nothing. **That defect was
found by rebuilding the turn's context by hand, not by reading the record** — and
it went undetected across several sessions in the meantime.

An enforcement mechanism that cannot be audited from its own output will fail
silently again.

## The change

Persist, on each spoken turn: the guard that was in force (the new-trait bound
and the restated bound), the trait ids the deterministic matcher extracted from
the broadcast message, and which bound was violated when one was.

## What must not regress

- Trait ids are pool identifiers, not participant text. **Nothing here may write
  message content into a record that leaves the database.** The existing rule
  against copying participant text into any tracked artifact is unchanged
- Recording must not move a model call back onto the broadcast path. The matcher
  is deterministic and network-free, and that is why it can run here
- A turn with no guard records that it had none, rather than recording nothing —
  the absent case is the one that hid the earlier defect

- [x] A spoken turn's record names the reveal budget it was held to
- [x] It names the traits the matcher found in the broadcast message
- [x] A turn with no guard is distinguishable from a turn whose guard passed
- [x] The T-C2-041 seq 4 question is answerable from a fresh export of an
      equivalent turn
- [x] No participant text is added to any record

## Comments

### The suspicion, answered on the way past

The issue named three possibilities and said the export distinguishes none: the
guard was set and passed, the guard was set and was violated, or no guard was set
for that route.

**It was the third.** Issue 03 found it while checking its own premise:
`withRouteRevealBudget` computes the budget for `address` and `followup`, and
`routeGenerationGuard` then dropped the guard for exactly those two routes.
T-C2-041 seq 4 is an ordinary direct-answer turn, so it had no guard at all. The
budget is now passed through, which is the fix; this issue is why the question
had to be answered by hand rather than by reading a row.

That is the argument for this work, not a reason to skip it. The defect was found
because someone rebuilt the turn's context by hand, and the next one will not be.

### What a spoken turn now records

`outputGuard` on the intervention row:

| field | what it says |
| --- | --- |
| `inForce` | whether any guard was in force at generation |
| `reason`, `candidate`, `revealBudget` | which guard it was |
| `maxTraitIds`, `maxRestatedTraitIds`, `maxSentences`, `maxWords` | the bounds it was held to |
| `traitIds` | what the deterministic matcher found in the broadcast message |
| `violation` | the bound that was violated, when one was |

`inForce: false` is the point of the design. A turn with no guard and a turn
whose guard passed used to leave the same empty record, and that is the case the
earlier defect hid in. The regression asserts the two are not deep-equal.

The repair audit's `guard` was also recording only `maxTraitIds` while the
restated and length bounds were being enforced — an attempt rejected for either
read as unexplained. It now carries all four.

### Cost, and what it did not cost

The matcher already ran on every spoken turn, after the intervention row was
written, for the ledger update. It is now run once before the row and the result
is reused, so the audit costs nothing and the ledger update lost nothing. No
model call moved onto the broadcast path — the matcher is deterministic and
network-free, which is the reason it is allowed there.

### Participant text

Trait ids are pool identifiers from a fixed closed set of 40. The regression
walks every value in the audit and fails on anything that is not an identifier or
a guard reason, so a future field carrying message content fails the suite rather
than reaching an export.

### Verification

Two breaks confirmed the assertions fail: hard-coding `inForce: true`, and
recording an empty trait list. The mongoose subdocument round-trips both the
guarded and unguarded shapes.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live.**
