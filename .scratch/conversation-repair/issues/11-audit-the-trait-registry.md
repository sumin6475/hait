# 11: Audit the trait keyword registry against the approved draft

**What to build:** Confidence that the deterministic trait matcher recognises the
traits it is supposed to recognise. The registry it matches against has never
been checked against the draft that was approved, and it is now load-bearing on
two paths instead of one.

**Blocked by:** None (can start immediately).

**Status:** done

## Why this is no longer cosmetic

The registry began as a keyword list for extracting traits from **human**
messages. Two changes since then put Alex's own output through it as well: the
pre-broadcast model call was replaced by the deterministic matcher (A7), and the
reveal guard's extractor was replaced by the same matcher (D2). So a trait the
registry does not recognise is now, at once, a trait the ledger does not record,
a reveal the anti-repeat work cannot see, and a reveal the guard does not count.

The guard's failure mode is exactly this shape: an empty extraction reads as "the
message revealed nothing", which is why three oversized messages once shipped
against a one-trait guard and recorded no violation.

## The change

Check the TypeScript registry against the approved draft, entry by entry, and
record what differs. Then settle the draft file, which is stale: either delete it
or mark it superseded. **Do not delete it before the audit** — it is the only
statement of what the registry was supposed to contain.

The matcher is known to be *better* than the model extractor on Alex's text,
because the output contract requires Alex to keep a trait's key wording, so its
phrasing stays close to the pool. That is an argument for the approach, not
evidence that the list is complete.

## What must not regress

- The pool is a fixed, closed set of 40 traits and never grows. An audit finding
  must be a correction to the keyword list, never a new trait
- Matching stays deterministic and network-free. That property is why it can run
  on the broadcast path at all
- No participant text enters any tracked artifact

- [x] Every registry entry is compared against the approved draft and the
      differences are listed — 40 of 40, zero differences
- [x] Any trait the matcher cannot recognise is named — none; four phrases that
      reach only bounded verification are named and pinned
- [x] The stale draft file is deleted or marked superseded, after the audit —
      marked superseded, kept as the approved record
- [x] The pooling-extractor suite still passes

## Comments

### The audit, and its result

Every entry of `TRAIT_KEYWORD_REGISTRY` was compared against
`trait_keyword_registry.draft.yaml` on candidate, valence, profiles, canonical
trait text, core phrases, accepted variants and fuzzy policy. **40 of 40 entries
are marked approved in the draft, and nothing differs on any of the seven
fields.** The list the matcher runs is the list that was reviewed.

That is a weaker result than it sounds, and the issue said why: agreement with
the draft is not evidence that the draft is complete. So the audit ran the
second, harder check as well.

### What the matcher can actually recognise

All 203 registered phrases were put through `extractHumanTraitsFast` in their
plainest attributed form. Every one is reachable. **Four reach only bounded
verification rather than outright acceptance**, and all four are correct:

| trait | phrase |
| --- | --- |
| B_n3 | `memory for numbers` |
| C_n1 | `verbally skillful`, `verbally skilful`, `verbally skillfull` |

Each is a bare noun phrase that carries no assertion of the negative the trait
states — "memory for numbers" is not "below-average memory for numbers".
`hasRequiredTraitSemantics` withholds them on exactly that ground, and the fuller
phrasings of both traits are accepted. No keyword-list correction was needed, and
none was made: the pool stays 40 traits.

### Why the four are worth pinning

The distinction between accepted and deferred is not cosmetic on Alex's path.
`disclosedTraitIds` — the reveal guard's evidence — reads `acceptedIds` and
discards `verificationCandidates`. A phrase the matcher only defers is therefore
a reveal the guard cannot count, which is the same shape as the failure that let
three oversized messages ship against a one-trait guard.

The suite already asserted *reachability*, which is satisfied by deferral, so it
would have passed while phrases drifted out of acceptance one at a time. The set
of four is now pinned exactly; adding a fifth has to be stated.

### What changed

Nothing in the runtime registry, because nothing needed to. The changes are the
audit made repeatable and the draft settled:

- `test-pooling-extractor.ts` compares candidate, valence, profiles, fuzzy policy
  and canonical trait text against the draft, not only the two keyword lists. The
  trait-text comparison reads `TRAIT_DB`, so a draft approved against different
  wording than the pool now holds fails.
- The same suite pins the four verification-only phrases.
- The draft is marked `status: superseded`, names the file that replaced it, and
  records the audit result. It is kept rather than deleted, because the suite now
  reads it as the approved record — which is the answer to "the only statement of
  what the registry was supposed to contain".

### Verification

Two breaks confirmed the new assertions fail: dropping one phrase from the
verification-only set, and drifting an accepted variant away from the draft.
Both were caught with the intended message.

`test:pooling-extractor` green.
