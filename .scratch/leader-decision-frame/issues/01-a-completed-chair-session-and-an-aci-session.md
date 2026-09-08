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

- [ ] A Chair session runs to `closing` and is entered in `docs/measurements.md`
- [ ] An aci session runs on the current build and is entered there
- [ ] The server was restarted before each, and the record says so
- [ ] Guard events are tabulated by bound and by condition
