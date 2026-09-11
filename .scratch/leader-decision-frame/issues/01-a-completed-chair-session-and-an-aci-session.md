# 01: Run a Chair session that finishes, and an aci session at all

**What to build:** Nothing. Two measured sessions, because the half of the design
space this whole effort is aimed at has never been observed.

**Blocked by:** None. Everything else in this directory is blocked by it.

**Status:** ready-for-human

## Why this is first

A frequency count over every source available — the 15 sessions in
`docs/measurements.md`, the 21 repair issues, and the 39 non-empty sessions in
`server/pilot-export.json` — produced this:

| Behaviour | Observations |
| --- | ---: |
| Alex is far longer than a human | 378 of 459 messages, 39 of 39 sessions |
| A set request answered in the wrong shape | 5 sessions |
| A message naming Alex goes unanswered | 3 sessions |
| A peer sets the agenda | 3 sessions |
| **A leader fails to check standing or to lead** | **0** |
| **A leader fails to narrow or to close** | **0** |
| **A peer question aimed at the whole team** | **0** |
| **A peer over-explains, or a leader under-explains** | **0** |

The four zeroes are not evidence of health. Every analysed session is xai, and
no Chair session has ever run to completion — `mediation`, `summary` and
`closing` exist only in C2 and C4 and have not been exercised end to end. There
is no baseline against which a leader frame could be shown to have changed
anything.

## What the sessions must produce

- One **Chair** session that reaches its closing.
- One **aci** session (C3 or C4) on the current build. The only aci material that
  exists is pre-repair and carries no `outputGuard`, no `routeKind` and no
  latency.

## Preconditions, both of which have already invalidated a run

- **Restart the server first.** The working tree has hot-reloaded across many
  edits, including deliberate breakages. T-C1-022 measured neither build.
- Confirm the build in the record, not from memory. T-C3-003 is filed with its
  build unverified for exactly this reason.

## What to read out of them

- Whether the eight guard deaths of T-C1-021 recur now that issues 18 and 20
  have changed the input the guard was reacting to.
- Whether `maxRestatedTraitIds` still fires at all.
- The shadow candidate list from issue 02 against what the group actually did.
- The repeated-question-form rate, for the deferred item in `spec.md`.

- [~] A Chair session runs to `closing` and is entered in `docs/measurements.md` — T-C2-047 is entered and **did not close**: still `in_progress` after 7 minutes of 30
- [x] An aci session runs on the current build and is entered there — T-C4-022 (C4), `promptVersion` 1.10.0, one `promptHash` across 29 intervention rows
- [x] The server was restarted before each, and the record says so — T-C2-047 carries one `promptHash` across all 24 rows and `promptVersion` 1.9.0
- [x] Guard events are tabulated by bound and by condition — for T-C2-047, in its measurement entry

## Comments

### Half of this issue is done: T-C2-047, 2026-09-08

A Chair session ran on a verified build and is entered in `docs/measurements.md`.
It stopped at seq 36 without closing, so `mediation`, `summary` and `closing`
are still unexercised end to end and the first criterion stays open. Everything
else this issue asked to be read out has an answer.

**The eight guard deaths of T-C1-021 did not recur.** One guard death in 24
records. `answered_with_a_question` was raised three times and repaired every
time.

**`maxRestatedTraitIds` still fires as a bound and did not bite.** In force on
four turns, violated on none.

**The shadow candidate list against what the group did.** Read against
`docs/adr/0009`: every candidate stayed live for 29 of 36 turns, A cleared at seq
30, B at seq 36, and C and D never cleared. Both of the group's eliminations
happened while the candidate was far below the bar, so the shortfall move would
have fired twice and both times correctly. The withdrawn rule, replayed on the
same board, sets C aside at seq 27 and B at seq 29 and leaves A and D — the two
candidates with the least on the board.

**The repeated question form does not arise here.** Zero of thirteen leader
messages contain a question mark; the deferred item in `spec.md` is about the aci
conditions and still needs the aci session.

**Two defects came out of it**, both new and both filed against the repair rather
than this effort: `.scratch/conversation-repair/issues/22` (Alex disclosed one of
the eight traits only it holds) and `.scratch/conversation-repair/issues/23` (the
reveal budget and the board are read from different extractors).

**And one behaviour cleared the two-session bar.** The group eliminated the
pooled answer on the first human message of the session, on a board of one trait.
T-C3-003 seq 4 is the same move. Issue 04's shortfall-on-narrowing is now
evidenced rather than anticipated.

### The second criterion is met: T-C4-022, 2026-09-09

An aci session ran on a verified build and is entered in `docs/measurements.md`.
It is C4, so it is a Chair session as well, and it also **did not close** — the
first criterion is unchanged and this issue stays open on it alone. `summary` and
`closing` are still unexercised; `mediation` fired once.

**The deferred question this issue was holding has an answer, and it is the
worst one available.** `spec.md` deferred the repeated-question-form rate to an
aci session. T-C3-003 closed 12 of 15 messages with one confirmation-request
form; T-C4-022 closes **the last twelve consecutive Alex messages** with an offer
to add a trait, 22 of 24 messages with a question, and 14 of 24 with an either/or
question. Two sessions, two builds, both statuses. Under the sixth method rule
that is a demonstrated recurrence, and the deferred item stops being a rate to
watch.

**The shortfall move would have fired correctly for the third session running.**
C cleared the bar at seq 17, A at seq 24, B at seq 46; D never cleared. Both
group eliminations — C at seq 2 on coverage 0, D at seq 35 on coverage 2 —
happened far below the bar. With T-C2-047 and T-C3-003 that is three sessions.

**And the behaviour issues 03 and 04 propose is already leaking, unrouted.** The
live list stayed log-only as issue 02 requires and did not reach Alex. But the
unsaid-notes context block, shipped 2026-09-08 for
`.scratch/conversation-repair/issues/24`, lists Alex's unsurfaced notes on every
trait-bearing route, and D dominated it from seq 29 onward. Alex asked permission
to disclose a D trait on each of its last twelve turns and disclosed one on none.
Whatever 03 builds has to account for a coverage pressure that already reaches
generation through a block written for another purpose.

**Guard deaths, by bound and condition.** Two of 29 rows, both `too_many_traits`
against `maxTraitIds: 1`, both on turns answering an explicit request for a
summary (seq 53, 54). The count bound is the one the 2026-09-08 audit found
almost never repairs, and it did not repair here either. No other bound fired.
