# 28: An opinion opened a request addressed to Alex

**What was built:** A proposal opens a request only when the Observer marked it
an **explicit** request. A question is untouched. The Observer's own obligation
snapshot has always drawn this line; the ledger branch did not, and that is where
the two readers had drifted apart.

**Status:** ready-for-human — landed behind `HAIT_GUARD_IMPLICIT_REQUEST`,
awaiting a paired run to confirm the turns it changes are better.

## The defect, as observed

**T-C2-051 seq 29.** A participant said: *"being moody in that situation when he
is responsible for people's lives is not something that you can neglect it
easy"*. The Observer read it as a proposal naming Alex and marked its
explicitness `implicit` — correctly, and in line with its own prompt, which says
a preference or a conclusion is not a request. The ledger branch read only the
speech act and minted an invitation
(`conversationLedger.ts`, `observerDeltaFromTurn`).

A selected request obliges the Judge to say what the request wants. Two turns
later the brief read:

> They asked why D would be the best; respond by addressing that concern and
> restating the tradeoffs …

Nobody asked that on that turn. Seq 24 had asked it, five messages earlier, and
Alex had already answered it at seq 25.

Five broadcast turns across two sessions were built on a request nobody made:
T-C2-051 seqs 23, 31, 34 and T-C2-050 seqs 20, 31.

## Why the transcripts still read acceptably

In all five the writer dropped or repaired the false half by itself.

| | what the brief ordered | what Alex said |
| --- | --- | --- |
| 051 seq 23 | add about A | nothing about A; a procedure proposal |
| 051 seq 31 | "they asked why D would be the best" | answered seq 30's actual concern |
| 051 seq 34 | add about A | repeated A_p4 and A_n6, already on the board |
| 050 seq 20 | add A's traits | nothing about A; announced a preference for D |
| 050 seq 31 | compare A against B | no comparison; added two B negatives |

This is not luck. `requestedAction` was deliberately removed from the generator's
opportunity block and from the Judge's prose situation — a thread's opening
purpose is the wrong thing to hand a turn as an order (T-C1-022 seq 10 greeted
the room again from it). What the generator is handed instead is the source
utterance, so it writes from the message and not from the brief's description of
it.

## What does not repair itself

**The act.** A listed request outranks every voluntary act — "select it rather
than contributing, following or acknowledging something of your own choosing"
(`LEDGER_JUDGE_SYSTEM`). While a fabricated request stands, `follow` is not
available, and `follow` is the act for taking up what the humans just said.

**T-C2-051 seq 22.** A participant argued that Candidate A's danger-recognition
is close enough to Candidate B's composure that the two are equal on the point —
a substantive claim, and the kind of thing a Chair exists to take up. Alex's
reply (seq 23) engaged with none of it; it answered a "request" carried over from
seq 21 and proposed a tradeoff framework instead.

This is also the reported symptom: in review the late half of T-C2-051 reads as
stiff and as failing to carry the conversation. That reading is what the act
selection makes structurally likely.

## What the rule removes, measured

Both sessions' recorded observations replayed through the reducer, guard on
versus off:

| session | requests before | after | removed |
| --- | --- | --- | --- |
| T-C2-051 | 15 | 11 | seqs 18, 21, 29, 33 |
| T-C2-050 | 15 | 12 | seqs 19, 30, 36 |

No opportunity is added in either. All seven removed are statements of opinion or
of the speaker's own choice — "I choose candidate A because his positive points
seem more vital to me", "the pilot's place should be very organized and tidy",
"I think teamwork is important in any job".

The uptake path underneath is unaffected: an opinion that answers Alex's own
question still mints an `uptake`, which is what issue 12 exists to protect.

## What is deliberately not changed

**The thread's requested action can still be Alex's own words.** At T-C2-051 the
recorded requested action became Alex's seq 23 proposal verbatim from seq 24
onward, and a restatement of the same agenda from seq 29 — while the humans were
asking why D was best and objecting to D's moodiness. T-C2-050 never drifted.

It is left alone because it is weakly wired: `requestedAction` reaches the Judge
only as a field inside the serialized ledger, and reaches the generator not at
all. Both removals were made on purpose. Fixing it now would buy little, and the
gate above removes the path by which it reached a brief as "they asked".

**The thread-continuation branch.** A single open thread still mints a
`group_request` on its own, with `targetBasis: "inferred"` and the thread's root
as its source — T-C2-051 seq 4's brief ("They asked us to lay out what we know")
came from there, not from any message. Both sessions ran to the end on one
thread. Out of scope here; see the leader-decision frame.

## Open

A paired run with `HAIT_GUARD_IMPLICIT_REQUEST=off` versus on. The five turns
should come back as `follow`, and the question is whether they take up the human
point. The guard also does not reach the Judge's serialized ledger, which still
carries the thread's requested action as a field — worth reading in the new
briefs.

## Follow-on, 2026-09-13: an obligation is not a guess either

The same shape one field over. `alexParticipation` on the thread decided whether a
group request was `required`, and `required` carries the strongest powers in the
ledger — unconditional cooldown bypass, no expiry, never swept, and the Judge may
not stay silent on one opened this turn.

The field is noise. The same script across three runs:

| | invited | required |
| --- | ---: | ---: |
| T-C2-050 | 8 | 19 |
| T-C2-051 | 19 | 9 |
| T-C2-052 | 2 | 27 |

Across all three it minted three `required` opportunities in total (050 seq 36,
052 seqs 1 and 13). Every other `required` in those sessions came from a
`direct_question`, which reads the speech act and the addressee.

**T-C2-052 seq 2 is what it cost.** Alex's own greeting opened a thread the
Observer happened to read as `required` that run, so the opportunity bypassed the
cooldown and Alex spoke one message after its own greeting. T-C2-051 read the same
thread as `invited` and waited. Nothing in the transcript differed. Intervention
timing is held constant across conditions, so a coin flip deciding it is not a
limitation to record — it breaks the comparison's premise.

Group requests are now always `invited`. An obligation to answer comes from
somebody asking Alex.

**No guard flag.** The other pacing changes get one so a paired run can measure
them; this one cannot be measured that way, because the build it would be measured
against decides by coin flip. T-C2-050, 051 and 052 are the baseline, and what
changes is three opportunities across them.
