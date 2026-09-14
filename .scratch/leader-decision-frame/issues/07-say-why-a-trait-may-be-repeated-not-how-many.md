# 07: Tell the generator why a trait may be repeated, not how many it may repeat

**What to build:** One sentence in the generation instruction. The bound itself
does not move.

**Blocked by:** None.

**Status:** ready-for-agent

**Premise correction, 2026-09-14.** The bound this issue protects no longer exists:
`docs/adr/0010` removed `maxRestatedTraitIds` and the reveal budget, and
`withRouteRevealBudget` is gone. The property-shaped sentence it asks for is already
in `formatAlreadyStatedByYou`, but that block lists only Alex's own disclosures, so
the T-C3-003 seq 47 case — traits a *human* said, offered as Alex's notes — is still
uncovered. The fix is a sentence about information already on the board from anyone,
not a change to a bound. The "What must not regress" items about the bound are void.

## The defect, as observed

**T-C3-003, seq 47–48.** A participant asked, "Alex, what **other** negatives do
you have for C". Alex answered: "**My notes show** three misses for Candidate C
— not verbally skillful, egocentric, reluctant to take part in training."

All three had been stated by a human ten turns earlier. New traits: zero.
Restated: three. The participant replied "yes perfect" and nobody noticed.

The claim was not false — those traits are plausibly held by every profile. The
failure is the framing: information already on the board was offered as
Alex's own fresh contribution, on a turn that explicitly asked for something
further.

## Why the count is the wrong lever

The generation instruction today says: *"Refer back to at most N already-surfaced
traits; do not recite the board."* It is arithmetic, and the distinction that
matters is not arithmetic. Repeating a trait as agreement — "my note on that one
matches what you just said" — is good conversation and should not be rationed.
Repeating it as news is the failure, at any count.

The bound also did not fire here: `withRouteRevealBudget` applies it only on
`address` and `followup` turns carrying **no** request, and this turn carried
one.

## The change

Replace the sentence with the property: **already-surfaced information may be
cited as agreement or as grounding, and may not be presented as something Alex
is adding.** The numeric bound stays exactly where it is, doing the job it was
built for — refusing a terse recital on a turn with nothing to enumerate, which
`maxSentences` and `maxWords` demonstrably do not catch.

## What was considered and not done

**Extending the numeric bound to request-carrying turns.** That is a new way for
a turn to die, on a class observed once, and guards are already the largest
source of lost turns. Issue 17 of the repair records two previous wrong fixes at
this exact bound.

**Giving the generator the list of traits already on the board for the candidate
in question.** This is the better fix and it is not this issue — it changes an
input rather than adding a check, which is the order `CONVERSATION-REPAIR-CHECKPOINT.md`
§6 prescribes. Left open deliberately: the observed harm is one turn in one
session, and issue 01's sessions decide whether it recurs.

## What must not regress

- The numeric bound, its threshold, and the turns it applies to are unchanged
- The pairing test between prompt text and post-condition still holds
- No new post-condition, no new repair path

- [ ] The instruction states the property; the bound is untouched
- [ ] The 40-word two-sentence six-trait recital that gate D2 refuses is still refused
- [ ] A message citing one already-surfaced trait as agreement still passes
