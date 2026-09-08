# Conversation System Repair — Checkpoint

**What this document is.** The thing to read to resume the conversation repair.
It holds the working rules, the goal, how to verify a change, the method
discipline this repair had to learn, and the invariants. Nothing else.

**What it is not.** It is not the system's architecture reference, and it is not
a status board. It is time-bounded: when the repair ends, this file ends with it,
and the four documents it points at outlive it.

**Where everything else went.** This file used to hold all of it. It no longer
does, and nothing here should be re-added.

| What | Where | Why there |
| --- | --- | --- |
| The project's vocabulary | [CONTEXT.md](CONTEXT.md) | Terms outlive the repair |
| Decisions that are settled | [docs/adr/](docs/adr/) | A decision is not status |
| Work still open | `.scratch/conversation-repair/issues/` | The tracker owns status |
| Every live session measured | [docs/measurements.md](docs/measurements.md) | The trend is only legible in one shape |

The per-item status table that used to live here is gone. It went stale twice,
and it went stale because it was a hand-maintained summary of information living
elsewhere in the same file. **Ask the tracker.**

Section numbers below have gaps. The missing numbers are the sections that moved,
and `server/src/scripts/docs-migration-map.json` records where each one went.

## Current state — read this first

**Where the code is.** Uncommitted in the root checkout
(`/Users/jadekim/Documents/Code HQ/HAIT`, branch `main`, never commit there).
Mirrored as commits on `claude/hait-conversation-system-errors-0f5e58` for backup
only. Confirmed 2026-09-07: every tracked file modified in the root checkout is
byte-identical to the backup branch HEAD, so the mirror is faithful and either
location can be recovered from the other.

**What is done, in one line.** Gate A is finished and confirmed live. Length is
solved. The reveal guards enforce for real, since the extractor that made them
pass vacuously was replaced. The honest decline and the request scope behind it
are built but have never been seen in a live session.

**What is open.** Eleven issues in `.scratch/conversation-repair/issues/`. Ten
are open; one records a decision not to act. Start at the lowest-numbered issue
whose blockers are done.

**Before the next measurement, two things.**

1. **Restart the server.** The working tree has hot-reloaded through roughly ten
   edits, including five deliberate breakages made to check that assertions fail.
   A measurement taken now measures neither build. This has already invalidated
   one run — see T-C1-022 in the measurement log.
2. **Check the pre-registration and IRB wording** on where the manipulation is
   applied. Retiring the condition-blind Judge moved the manipulation upstream of
   generation, and two descriptions of the study need re-examining as a result.
   `docs/adr/0001-condition-reaches-the-judge.md` says which two. Neither is an
   implementer's to settle. Code may land first; a session may not run first.

**Waiting on the user.** Two things, neither blocking:

- **Reveal ranking ignores information uniqueness.** Alex spends traits every
  participant already holds while its own exclusive ones go unsaid. Stating
  shared traits may be intended common-ground behaviour, so this is flagged and
  not changed. See T-C1-024 in the measurement log.
- **`alexRelevance` is stuck** and no one knows why. The explanation given at the
  time was disconfirmed. See T-C2-041 in the measurement log.

**What is not covered by tests, and why.** This repository has no runtime harness
for `reserveTurn` / `executeRouteTurn` — the intervention suite tests
`humanArrivalAction` as a pure function and never drives the engine. So A6's
timing and cancellation behaviour, A7's broadcast-before-verification ordering,
and the engine-side early supersession check are all verified by reasoning plus
live measurement only. Building that harness is worth doing before the generator
work, which needs generation-level post-conditions. **Do not describe those three
as regression-covered.**

## 0. Branch and safety rules

- **`origin/main` is production and must never be touched.** Do not push. Do not
  merge into it. Local `main` stays at `5263f0f`.
- **Work in the ordinary checkout at the repo root**
  (`/Users/jadekim/Documents/Code HQ/HAIT`), on branch `main`, leaving the changes
  **uncommitted**. This is deliberate: the user wants every change since
  `origin/main` collected as one pending change set in one place, the way it was
  before the repair work started. Do not create commits there without being asked.
- The branch `claude/hait-conversation-system-errors-0f5e58` (worktree under
  `.claude/worktrees/`) is a **frozen backup**, not the workspace. It holds the
  same content as committed history, so any accidental loss in the root checkout
  can be recovered from it. Do not resume work there unless the user says so.
- Because the working tree sits on `main`, `git commit` in the root checkout would
  move the production branch. **Never `git add -A && git commit` there.**
- Never commit `.env`, credentials, tokens, or raw participant text.
- Most of `docs/` is gitignored. Three narrow exceptions are tracked and must
  stay tracked: `docs/agents/`, `docs/adr/`, and `docs/measurements.md`. A
  document that must survive across sessions belongs in a tracked path.
- The worktree has no `server/.env` of its own. The four suites abort on a
  missing `MONGODB_URI` until it is linked to the root checkout's copy.
- Do not start/stop/restart the local server (port 3001) unless the task needs it
  and the user authorizes it.

## 1. Goal state (what "fixed" means)

The six things being optimized, in the user's words:

1. **Speech volume** — Alex participates enough (target ~61% of eligible turns).
2. **Condition orthogonality** — a Member never mediates or performs
   task-standard correction; a Chair retains mediation. XAI stays explanatory;
   ACI asks questions. No condition's weighting leaks into another.
3. **Context is read and the state is updated correctly** — the ledger reflects
   what actually happened.
4. **The reply matches the context that was read** — including natural uptake
   (a light acknowledging opener), answering questions that were asked, and not
   restating information already on the board.
5. **Alex answers inside the conversation's tempo** — a decision that lands after
   the humans have moved on is a lost turn, not a slow one. Added 2026-09-07:
   39% of T-C1-020's turns were discarded as superseded.
6. **Alex speaks like a participant, not a report** — length and per-turn
   information release are bounded and enforced, not requested. Added
   2026-09-07: Alex averaged 4× the humans' message length and released 15 traits
   in a single turn.

Quality bars that must hold throughout: natural uptake on ordinary turns;
per-condition speech style preserved; no single condition's weighting dominating.

## 5. How to verify

From `server/` in the root checkout (it already has `node_modules` and a real
`.env`):

```sh
npm run build --silent
npm run test:intervention-v2
npm run test:conversation-ledger
npm run test:conversation-recovery
npm run test:pooling-extractor
npm run docs:check
```

All six must pass. `test:pooling-extractor` joined the set with A7, which put the
deterministic matcher on Alex's own output as well as the humans'. `docs:check`
joined with the restructure, and fails if a section of this file disappears
without the migration map saying where it went, if a `§` pointer or relative link
stops resolving, or if the invariant list in §7 changes length.

That last check is why §7 is a bare list and nothing else: it asserts exactly
eight entries and that no prose sits between them, so an invariant cannot be
added or retired by editing a paragraph. Changing the count is a deliberate edit
to the checker, in the same commit.

`tsx` tests may hit a managed-sandbox IPC `EPERM`; rerun with the local IPC
permission granted. Run `git diff --check` before finishing a change.

Capture exit codes directly — `npm run build --silent | tail -5; echo $?` reports
`tail`'s status, not the build's. Redirect to a file and test `$?` instead.

Note: `tsx` does not typecheck, so a test can pass under
`test:conversation-ledger` while `npm run build` fails. Always run `build` as
well — `test:intervention-v2` depends on it.

Live smoke runs are the user's call (they own the server on port 3001). Measure a
change against the targets table in [docs/measurements.md](docs/measurements.md).

## 6. Method note

Five rules, each of which this repair learned by breaking.

**Do not treat an existing assertion as evidence of intended design.** Existing
tests here were written alongside the defects they cover. The ledger suite
asserted "standing opportunity identity is unique per thread origin" — the very
property that let one consumed id kill a derivation branch for a whole session.
Re-derive intent from the code and the observed run, and when a fix requires
changing a test, say so explicitly rather than bending the fix to fit.

**Do not let a plausible causal story outrun the data.** The first reading of the
dead-opportunity defect claimed nine turns of speech loss; the run shows it cost
none. It happened again with the Observer schema cut: a tidy explanation from
schema ordering survived until a later session ran with the change reverted and
the symptom did not move. Check attribution against the record before ranking a
repair, and before writing the explanation down as settled.

**A regression that passes without the fix proves nothing.** Every fix here is
verified by reverting it and watching its own test fail. **Four regressions in
this repair were vacuous on the first attempt**, each caught by that check and
replaced. They are recorded rather than hidden, because the pattern is the
lesson:

| # | The vacuous test | What it actually exercised |
| --- | --- | --- |
| 1 | The Observer schema cut | The normalizer's roster filter, not the widening step that fills the field |
| 2 | The Observer review path | The normalizer, not the call site — replaced with a test that counts model calls |
| 3 | The reveal guard | Pre-computed trait ids, instead of driving the real generation path |
| 4 | The decline precedence | A request phrasing that could never reach the template — replaced, with a Chair positive control |
| 5 | The order of the two deterministic vetoes | A fixture where both orders give the same answer — replaced with one where they disagree |

A sixth assertion could not be written at all: removing unreachable code is
unobservable. That was said plainly in the test rather than faked.

**A rule that lives only in a prompt is not a rule.** The length contract was
written and unenforced for four sessions. The reveal guards passed vacuously
because an extractor's failure was indistinguishable from an empty result. The
Judge is asked in prose to respect the cooldown on voluntary acts and nothing
checks it. Each was found late, by hand. **If a prompt asks for something, either
the code checks it or the record shows whether it happened.**

**Restart the server before measuring.** A conclusion about overlapping the floor
was wrong because the process had hot-reloaded across the change and the run
measured the previous build.

## 7. Invariants that must not regress

- Observer supplies current-turn evidence; a deterministic reducer owns threads,
  opportunities, and floor state.
- A Member never gains mediation or task-standard correction, and the cooldown
  and floor delays stay condition-invariant arithmetic. The Judge is no longer
  condition-blind — see `docs/adr/0001-condition-reaches-the-judge.md` — but what
  the condition may reach is *which act on what grounds*, never *when*.
- Successful broadcast is the only `consumed_by_alex` transition. Generation
  failure, cancellation, floor blocking, and supersession must not consume one.
- Human floor, cooldown, lifecycle, supersession, and generation failure must
  never be conflated with semantic silence.
- Opportunities are candidates, not automatic speech entitlements.
- Multiple answers to one Alex question form one response cluster, not
  independent per-message entitlements.
- Do not apply a prompt-contract fix alone if it would make every previously
  rejected invited opportunity speak immediately.
- Shadow mode must not alter live routing, cadence, timing, or reservations.
