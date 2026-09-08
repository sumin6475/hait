# 11: Audit the trait keyword registry against the approved draft

**What to build:** Confidence that the deterministic trait matcher recognises the
traits it is supposed to recognise. The registry it matches against has never
been checked against the draft that was approved, and it is now load-bearing on
two paths instead of one.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] Every registry entry is compared against the approved draft and the
      differences are listed
- [ ] Any trait the matcher cannot recognise is named
- [ ] The stale draft file is deleted or marked superseded, after the audit
- [ ] The pooling-extractor suite still passes
