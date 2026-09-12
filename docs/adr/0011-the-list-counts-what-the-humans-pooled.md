---
status: accepted
date: 2026-09-12
---

# The candidate list counts what the humans pooled, not what is on the board

`0008` settled where the list is computed from: the board, never Alex's unspoken
profile. That still holds. `0009` replaced a score rule with a coverage bar of
five. The bar is withdrawn here and replaced.

A candidate now leaves the list when **a human has put something about it on the
board that Alex does not hold**. Coverage and score are still computed and
recorded, and neither is an input to anything the group works on next.

## Why the coverage bar could not do its job

`0009` derived five correctly from the dataset: four traits per candidate are on
every card, so five is the first coverage at which something beyond the common
pool must have reached the board. The derivation is sound. What it does not say
is **whose** card that something came off.

Alex holds six traits per candidate — the shared four plus two of its own. One
message clears a bar of five by itself.

That is not a corner case; it is what both completed Chair sessions did.

| | B leaves | C leaves | A leaves | D leaves |
| --- | --- | --- | --- | --- |
| T-C2-051 | seq 9, Alex | seq 12, Alex | seq 17, Alex | seq 17, Alex |
| T-C2-050 | seq 29, Alex | seq 12, Alex | seq 18, Alex | seq 23, Alex |

Eight removals across two sessions, every one of them Alex's own disclosure. Not
once did a human's contribution retire a candidate. In T-C2-051 a single message
at seq 17 took A and D from nothing to covered together.

The leader was then told there was no coverage gap to name — at seq 23 of
T-C2-051, while fifteen human-held traits were unsaid, including all four of the
pooled answer's. Alex passed that reading on to the group: *"We've now covered
every candidate's listed matches and misses; coverage is complete."* Those four C
traits were still unsaid when the session ended.

So the sentence was not wrong about the board. It was answering a question the
leader has no use for. **What a leader can act on is whether the group still has
something to pull out, and Alex's own disclosures say nothing about that.**

## The rule

A candidate leaves the list when the board holds at least one trait about it that
a human surfaced and Alex does not hold (`POOLED_ENOUGH`, `humanPooledIds`).

**One is the largest claim the board can support.** Below it, nothing any
participant holds privately about that candidate has reached the group; at or
above it, something has. Two is not available: participants are never told how
many traits a candidate has, and a bar that reasons about what is still missing
runs Alex on an information advantage the design does not grant — `0009`, "The
repair that is not available", and the task prompt's *do not assume that an
unmentioned trait exists*.

**It falls identically on all four candidates.** Each carries exactly four traits
Alex does not hold, derived in `candidateList.ts` rather than written down, so no
candidate is easier or harder to retire than another and the list stays
condition-invariant.

**A human repeating Alex does not count.** Alex's own two per candidate are
excluded by construction, so an extractor that credits a participant with
something Alex said cannot move the leader's agenda. T-C2-051 seq 33 is a live
example of that credit being given wrongly.

Run against the same two sessions, the rule leaves **C live to the end of both** —
the one candidate about which the humans pooled nothing, and the correct answer.
A leaves at seq 39, B at seq 3, D at seq 26 in T-C2-051; A at 36, B at 3, D at 24
in T-C2-050. Every removal is a human's.

## What leaving the list still means

Unchanged from `0009`, and worth restating because the quantity changed and the
licence did not. Leaving means the leader stops steering toward that candidate
and stops volunteering information about it. It is not elimination, it is not a
ranking, and Alex still answers questions about it. The list says where attention
is still owed.

## What this is not a licence for

The `live` list says a candidate has had nothing pooled. It does not say how much
is missing, and no move built on it may imply a count. The sentence the Chair's
Judge receives carries no number, for the same reason it never did.

## The one countervailing session

Replaying T-C1-016 — a pilot session from the previous architecture, with a trait
extractor known to over-detect one candidate's phrasings — the humans pooled
`C_p2`, `D_n3` and `D_n4`, so C and D leave the list while A and B stay. Under
the coverage bar nothing left it at all, because no candidate's total reached
five.

That is the low-bar cost `0009` predicted, now observed: a candidate can clear
the bar on one trait while three remain on somebody's card. It is a nudge not
given rather than a wrong nudge given, and it is recoverable. It is recorded here
because it is the strongest argument against this rule and the sessions that
would settle it have not been run.

## Consequences to watch

- The list is no longer shadow. `leaderCoverageNote` reads it and its sentence
  reaches the Chair's Judge, so a change to the bar is a change to a treatment.
  Peers still receive nothing.
- The coverage bar is gone from the decision but `coverage` stays in every turn
  record, so any completed session can be re-read against either.
- **The late half is still undesigned.** Under this rule the list empties much
  later, or not at all, which pushes the state the leader spec does not cover
  further out rather than removing it (`.scratch/leader-decision-frame/spec.md`,
  "The late half of the discussion is not designed").
