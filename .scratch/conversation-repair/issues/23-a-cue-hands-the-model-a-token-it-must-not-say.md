# 23: A cue hands the model a token it must not say

**What to build:** Alex cannot repeat back a label that exists only for the
server. Today the prompt supplies the label and asks, in prose, that it not be
repeated.

**Blocked by:** A recurrence. See "why the rename is not being done yet".

**Status:** needs-info — the detector gap is closed; the rename is not.

**Premise correction, 2026-09-14.** The cost estimate below is stale:
`route-prompts.source.json` no longer exists (the source is
`server/src/prompts/blocks/`), and the snapshot is at 1.11.0. Check where the cue
tokens are emitted today before sizing the rename.

## The defect, as observed

**T-C1-023 seq 23.** A repaired draft read:

> "I'll follow that. For the remaining candidates I can share one additional
> trait: Candidate B keeps a cool head in crisis situations, which is a match to
> our crisis-management requirement. **My current read is NO_CURRENT_PREFERENCE.**"

The model reported the cue's own label as the value it had been told to state.
`internalMetadataLeak` caught it and the turn was refused, so nothing reached the
participants — the cost was one lost turn.

The rest of that sentence is fine. "I can share one additional trait" passes the
detector on its own; the sentinel is the only thing that fired.

## Where the token comes from

Two places, and both hand it to the model:

- `formatPreferenceDecision` writes `State: NO_CURRENT_PREFERENCE — …` into the
  turn's user prompt, under a header saying "never expose this label".
- **All thirty static route prompts** name the tokens in their instructions:
  *"If the cue is NO_CURRENT_PREFERENCE, do not name any candidate as Alex's
  choice. If it is CURRENT_PREFERENCE, name only the supplied candidate…"*

That is deliberate. The tokens are a contract between the static prompt and the
runtime cue, which is why they are ALL-CAPS and why they cannot simply be renamed
on one side.

The instruction not to repeat them is prose. A rule that lives only in a prompt
is not a rule — §6, and this is a clean instance of it.

## What was done

**The detector's list is now complete.** It knew the three `CURRENT_*` states
`formatPreferenceDecision` emits and **none** of the three `SCOPED_*` states
`formatScopedPreferenceDecision` emits — two lists that must agree, and only one
of them updated when the second cue was added. Half the cues could have been
repeated back with nothing to catch it, and the one that leaked was caught only
because it happened to be on the list.

- [x] Every token either cue can emit is detected
- [ ] No cue hands the model a token at all — see below

## Why the rename is not being done yet

Removing the tokens means rewriting the contract in prose on both sides: eleven
places in `route-prompts.source.json` (one shared section plus ten route
sections), recompiling all thirty prompts, new hashes, and a prompt version bump
from 1.9.0. The repo has **nothing offline that exercises the live route prompts
against the model**, so that change would ship unmeasured.

Against that: **one occurrence in three sessions**, and the existing detector
handled it correctly.

That does not clear the bar this repair set for itself two commits ago —
enforcement and prompt changes need a demonstrated recurrence, not a single
observation. Renaming thirty live prompts on n=1 is the same trade issue 16 was
declined for, in the other direction.

## What would change the answer

A second leak. `internalMetadataLeak` now covers all six tokens, so a recurrence
will show up as `output_violation_after_repair: internal_metadata_leak` in the
silence record rather than having to be found by hand.

## What must not regress if the rename is ever done

- The static prompt and the runtime cue must keep meaning the same thing; the
  contract is what the tokens are for
- No new model call
- The detector stays as the backstop even with nothing left to detect

## Comments

### A correction to the T-C1-023 measurement entry

That entry recorded a suspicion that issue 21 — which began stating every bound
in the repair correction — had caused this leak. **It had not.** The sentinel
predates it by the whole life of the prompt, and the phrase the suspicion pointed
at ("I can share one additional trait") is not what the detector fired on. The
suspicion was formed from a log line truncated at ninety characters, before the
detector was actually run on the text.
