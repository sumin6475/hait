# 12: A reply to Alex's own question is an opportunity, deterministically

**What to build:** When Alex asks a question and the next human message answers
it, Alex answers back. Today that depends on the Observer classifying the reply
correctly, and when it does not, the turn is lost outright.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## The defect, as observed

**T-C2-043 seq 16–17.** Alex asked an either/or question. The next human message
answered it by naming both options. Alex said nothing, and the turn was recorded
as `ledger_judge_failure`.

Three things went wrong in sequence, and only the first is a mistake:

1. **The Observer misread the reply target.** It set `replyToSeq` to the human's
   own earlier message rather than to Alex's question, and
   `relationToPendingAlexQuestion: "unrelated"`, with `addressees: []`. It
   reported confidence 0.85.
2. **No opportunity was minted**, because an opportunity requires a human message
   that targets Alex. The turn's open-opportunity list was empty.
3. **The Judge chose an interaction act regardless.** Twice it answered
   `speak / participate` with `evidence: selected_open_opportunity` and
   `selectedOpportunityId: null`, on a turn whose available-moves block said
   there were none. The validator rejected both attempts — correctly, with
   `interaction_act_missing_opportunity` and `voluntary_act_evidence_invalid` —
   and the turn was spent.

Step 3 is the validator doing its job. The turn is still lost, and the shape it
is lost in is the worst one available: **Alex asked, was answered, and ignored
the answer.**

## The same observation contradicted itself

`floor.expectedNext` was `["alex"]` on that very turn. The Observer knew Alex was
next to speak while reporting that nothing in the message was for Alex. A ledger
that holds both at once is the **B9 shape** again, on a different pair of fields:
B9 unified the opportunity derivation and the floor check after three consecutive
turns were lost to the same contradiction.

## Why this is not "the Observer needs a better prompt"

Thirty messages later the identical pattern **succeeded**: Alex asked the same
kind of either/or clarification, the human answered, and this time the Observer
set `replyToSeq` to Alex's message, `direct_answer`, `addressees: ["alex"]`. An
opportunity was minted and Alex answered.

One field, read two ways, on two instances of one pattern. That is a reliability
distribution, not a missing instruction, and the fix for a reliability
distribution on a fact that is deterministically available is to stop asking.

## The evidence that was available and unused

`pendingAlexQuestion` already computes, without a model, whether Alex's last
message was question-like — it is what gates `relationToPendingAlexQuestion`
during normalization. On this turn it was true, and seq 17 was the very next
human message.

## The change

Mint the uptake opportunity from that deterministic pair — Alex's immediately
preceding message is question-like, and this is the next human message — rather
than from the Observer's classification of the reply. The Observer's reading may
still upgrade or retarget it; it may not be the only thing that can create it.

This is the same move as issue 01: a fact that pure arithmetic over the
transcript already settles should not be re-derived by a model that is sometimes
wrong about it.

## What must not regress

- **A minted opportunity still obeys the floor and the cooldown.** This adds a
  reason Alex *may* speak, never a bypass of the rules that decide whether it
  does. `opportunityMayBypassCooldown` is unchanged
- The ledger stays the authority. The Observer proposes; this proposes too, and
  the reducer still decides
- An opportunity minted this way must be consumable and expirable like any other
  — the same id shape, the same TTL, the same terminal statuses
- A human message that answers *another human* while an Alex question happens to
  be open must not mint one. The pair is "Alex asked" **and** "this is the reply
  to it", not "Alex asked at some point"
- Silence stays attributable. If the turn still ends silent, it must not be for
  `ledger_judge_failure`

- [ ] Alex's question answered by the next human message produces an opportunity
      without the Observer having to classify the reply
- [ ] The T-C2-043 seq 16–17 shape resolves to a spoken turn
- [ ] The T-C2-043 seq 46–47 shape, which already worked, still works
- [ ] A reply directed at another human mints nothing
- [ ] `floor.expectedNext` naming Alex and an empty addressee list cannot both
      stand — say which one the ledger keeps, and why
- [ ] No new bypass of the floor or the cooldown
