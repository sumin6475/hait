# 09: Record the reveal budget in the turn, so it can be audited afterwards

**What to build:** A session export says what Alex was allowed to reveal on each
turn, and what it actually revealed. Today it says neither, so nobody can tell
from the record whether a guard held.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] A spoken turn's record names the reveal budget it was held to
- [ ] It names the traits the matcher found in the broadcast message
- [ ] A turn with no guard is distinguishable from a turn whose guard passed
- [ ] The T-C2-041 seq 4 question is answerable from a fresh export of an
      equivalent turn
- [ ] No participant text is added to any record
