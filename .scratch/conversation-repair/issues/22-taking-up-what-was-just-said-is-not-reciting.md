# 22: Taking up what was just said is counted as reciting the board

**What to build:** Alex can repeat a participant's own point back to them without
that counting against how much Alex may put on the table.

**Blocked by:** None.

**Status:** done

## The defect, as observed

**T-C1-023 seq 22.** A participant wrote that Candidate D's misses are being "a
know it all" and "quick tempered". Alex replied taking that up and adding the two
D misses it holds:

| | traits |
| --- | --- |
| the participant's message | `D_n3`, `D_n4` |
| Alex's reply | `D_n3`, `D_n4`, `D_n5`, `D_n6` |

Four counted against `maxRestatedTraitIds: 2`, so the turn was dropped. The
rewrite said the same thing in other words and was dropped again.

**Alex put two traits on the table, not four.** The other two were the
participant's own words, in the reply to that participant.

## Why the count was wrong, not the bound

Every route prompt asks for exactly this: *"Every build_on turn briefly takes up
the latest human point and then gives the supplied contribution directly."* The
restated bound was penalising the behaviour the prompt requires, and there is no
reading on which echoing someone's own sentence back to them is reciting the
board at them.

This is the counting, not the cap. The cap on what Alex may **contribute** is
untouched, and it is the one that matters — `maxTraitIds` bounds new disclosure,
which is the study's dependent variable.

## The change

`outputScopeViolation` takes the traits already present in the message Alex is
replying to, and excludes them from both counts — restated *and* new. A trait the
participant introduced is theirs; Alex repeating it is neither a recital nor a
disclosure.

Both sides are measured with the same extractor, from `evaluateDraft`, so the
comparison cannot drift. The participant's own `sharedInfoIds` could not be used
for this: the seq 22 message recorded `[]`, because it wrote "know it all" in
quotes where the registry holds "know-all". Reading its text with the extractor
that reads Alex's output gives `D_n3, D_n4` from both sides.

## What must not regress

- **The disclosure cap is untouched.** What Alex contributes is still bounded;
  only what it repeats back is exempt
- The exemption is exactly the echo — echoing one trait must not licence
  reciting others
- The echo is read from the message being replied to, never from the draft:
  derived from the draft it would exempt everything Alex said
- No new model call; the same deterministic extractor, on one more string

- [x] The real seq 22 draft passes
- [x] Four restated traits with nothing echoed is still a violation
- [x] Echoing one trait does not licence reciting four others
- [x] An echoed trait does not consume the turn's one new trait
- [x] The echo comes from the participant's message, not Alex's draft

## Comments

### Verified against the session that found it

Both drafts T-C1-023 seq 22 actually produced — the initial and the rewrite —
were replayed:

| draft | before | after |
| --- | --- | --- |
| initial | `too_many_restated_traits` | **ok** |
| repair | `too_many_restated_traits` | **ok** |

The initial draft now passes, so the turn ships without a repair call at all.

### Five breaks, two of which the first assertions did not catch

Not excluding the echo returns the defect. The two that slipped through on the
first attempt are the more useful record:

- **excluding the echo from the restated count but not the disclosure count** —
  every assertion happened to give the same answer either way, until one was
  added where a single echoed trait would otherwise consume the turn's one new
  trait.
- **deriving the echo set from the draft instead of from the message being
  replied to** — which switches every bound off at once, and was invisible
  because nothing exercised `evaluateDraft` with `repliedToContent`. The
  predicate was tested and the wiring was not, again.

Build, all six `test:*` suites and `docs:check` green. **Not measured live.**
