---
status: accepted
date: 2026-09-07
---

# Trait extraction is deterministic, not a model call

Alex's own messages are scanned for which traits they disclosed, both to update
the board after a broadcast and to check a message against its reveal budget
before one. That scan used a model call. It now uses a deterministic matcher over
the closed set of forty traits, because the model call's failure mode was
indistinguishable from success.

## Why the failure mode decided it

The extractor ended in a catch that returned an empty list, and an empty list is
exactly what "this message revealed nothing" looks like. So every reveal budget
passed whenever extraction failed, silently. In one measured session three
messages shipped six to eight traits each on turns whose budget was one, and no
violation was recorded. The guards were not weak; they were not running.

A deterministic matcher over a closed set cannot time out, cannot be rate
limited, and has no failure mode that reads as absence. It also removes a
synchronous model call from both the broadcast path and generation.

## What we gave up

Recall on phrasings the matcher does not anticipate. A model extractor could catch
a trait stated in words nobody wrote a pattern for; the matcher cannot. We accept
under-counting a disclosure over a guard that cannot tell "nothing was said" from
"the check did not run" — an unfair comparison only if the model call were
reliable, and it was not.
