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
- [ ] An aci session runs on the current build and is entered there
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
