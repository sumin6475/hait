# 08: Compact the carried state — not doing this

**What to build:** Nothing. This records a decision rather than work.

**Blocked by:** None.

**Status:** wontfix

## What it was

Pass the previous ledger to the Observer as a compact delta rather than a full
JSON dump, keeping the transcript whole so the prefix stays cache-friendly. It
was filed as an Observer latency item.

## Why it is not being done

Its premise was disconfirmed by measurement. Across nine Observer calls the cost
per output token ranged 8.6–21.6 ms, a 2.5× spread: two calls emitting 488 tokens
took 7.3 s and 7.7 s while a 481-token call took 4.2 s and a 384-token call took
6.1 s. Caching made no difference either — cached calls averaged 6.8 s against
6.3 s uncached. Mean 6.5 s with a 2.1 s standard deviation is consistent with the
variance sitting in upstream API latency, not in the payload.

The same measurement already retired the larger schema-cut item's latency claim.
Payload size does not predict Observer latency in the range this system operates
in, so a payload change bought as a latency fix buys nothing.

This is recorded rather than deleted because the item is still listed in the
repair checkpoint's gate table and is absent from its status table — it was
dropped silently, and a silent drop is the thing the migration is meant to stop.

## If it comes back

It would have to come back as a **cost** item — fewer input tokens per call — with
a cost measurement attached, not a latency one. Do not re-file it against a
latency target.
