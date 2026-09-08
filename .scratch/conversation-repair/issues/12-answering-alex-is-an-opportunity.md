# 12: A reply to Alex's own question is an opportunity, deterministically

**What to build:** When Alex asks a question and the next human message answers
it, Alex answers back. Today that depends on the Observer classifying the reply
correctly, and when it does not, the turn is lost outright.

**Blocked by:** None (can start immediately).

**Status:** done

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

- [x] Alex's question answered by the next human message produces an opportunity
      without the Observer having to classify the reply
- [x] The T-C2-043 seq 16–17 shape now mints an opportunity — whether it becomes
      a spoken turn is issue 13's half, and it is not this issue's to claim
- [x] The Observer-driven path is untouched, so the shape that already worked
      still works
- [x] A reply directed at another human mints nothing
- [x] `floor.expectedNext` naming Alex and an empty addressee list — see below
- [x] No new bypass of the floor or the cooldown

## Comments

### What shipped

`alexQuestionAwaitingReply(messages, anchorSeq)` returns the seq of Alex's own
question when **the message directly before the anchor** is Alex's and is
question-like. Strictly immediate, so it says "Alex asked and this is the turn
that followed", never "Alex asked at some point" — a human who has already
answered closes it, and there is a regression for that.

The ledger's uptake branch gains it as an alternative to the Observer's reading,
not a replacement. A stronger branch above still wins, and the Observer can still
mint the same opportunity on its own. The opportunity is `uptake` / `invited` —
the weakest kind there is, and exactly what that branch already produced — so the
risk profile is unchanged from the opportunities minted there today.

### The one guard on it

A turn that names other humans and not Alex mints nothing, however well
positioned. Position says the turn followed Alex's question; it does not say the
turn was for Alex.

### The floor contradiction, and why it stays

The issue asked which of `floor.expectedNext: ["alex"]` and `addressees: []` the
ledger keeps. **Neither is overruled, and that is deliberate.** The contradiction
was evidence that the addressee reading was wrong, not something to resolve by
picking a winner: normalization already owns the floor and would have to be
changed to make an empty addressee list close it, and B9's fix went the other way
— it opened the floor rather than closing an opportunity. What this issue adds is
a second, deterministic route to the opportunity, which removes the contradiction
by making the ledger agree with the floor instead of arbitrating between them.

### Not sufficient, and known to be

T-C2-045 ran the same shape with the Observer reading every field correctly, and
the turn was still lost — cooldown vetoed it and three later turns chose
voluntary acts with the request open. **This fix would not have saved either
session on its own.** Issue 13 is the other half; neither blocks the other.

### Verification

Three breaks confirmed the assertions fail: removing the deterministic branch,
dropping the addressee guard, and ignoring whether Alex's message was a question.

Build, all five suites and `docs:check` green. **Not measured live.**


## Comments

### T-C2-045: the Observer got it right, and the turn was lost anyway

The same shape ran again two hours later on the new build — Alex offered a choice
at seq 16, a participant answered at seq 17 — and **this time the Observer read
every field correctly**: `addressees: ["alex"]`, `explicit_addressee`,
`requestExplicitness: explicit`, `relationToPendingAlexQuestion:
related_addition`, floor expecting Alex, confidence 0.9. An opportunity was
minted.

The comparison still never arrived. Cooldown vetoed the turn, and the three later
turns that spoke each chose a voluntary act with the opportunity still open. →
**issue 13**, which is this failure one layer further down.

That is worth recording here for two reasons. It confirms the reliability
distribution this issue describes — two instances of one pattern, read two ways.
And it shows the fix is **necessary but not sufficient**: minting the opportunity
deterministically would not have saved either session on its own. Issue 13 does
not block this one, and this one does not block issue 13.
