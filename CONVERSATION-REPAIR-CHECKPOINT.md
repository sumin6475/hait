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
now a post-condition rather than a request, and the per-turn reveal budget
reaches a live turn for the first time — it was computed for `address` and
`followup` and then dropped before generation, and passed its own suite the whole
time because every assertion called the predicate directly. The honest decline
and the request scope behind it are built but have never been seen in a live
session.

**What is open.** Twenty-three issues in `.scratch/conversation-repair/issues/`.
Nothing is blocked on code. The three that remain are blocked on a measurement:
issue 10 needs a live Observer latency figure, issue 16 needs a frequency count
before a guard for it is worth its cost, and issue 23 needs a second leak before
renaming thirty live prompts is worth an unmeasured version bump. Nineteen are
done and one records a decision not to act.

**T-C1-023 measured the guard fixes on a near-identical script: guard deaths
10 → 3, repair success 23% → 57%, and both questions that cost T-C1-021 its
endgame were answered.** One of the three remaining deaths was issue 22 (taking
up a participant's own words counted as reciting) and is fixed. One is the bound
working. One was a preference-cue label the model repeated back as a value
(issue 23); the detector caught it, and the suspicion recorded at the time that
issue 21 had caused it is disconfirmed — see the measurement log.

**Issues 20 and 21 close the guard audit.** 20 removed eight of T-C1-021's ten
guard deaths, verified by replaying all ten through the built context with the
real opportunities and the intent the Observer actually stored. 21 covers the
tenth: the rewrite is now told every bound in force rather than only the one it
broke, and a generation failure records the guard that caused it. The remaining
death is a turn the budget should apply to.

**Issue 20 removed eight of T-C1-021's ten guard deaths**, verified by replaying
all ten through the built context with the real opportunities and the intent the
Observer actually stored. The two that remain are turns the budget should apply
to, and one of them is issue 21.

**The guard audit, 2026-09-08.** Across both sessions, thirteen guard events:

| bound | repair worked | turn died |
| --- | ---: | ---: |
| `too_many_restated_traits` | 1 | **8** |
| `too_many_traits` | 0 | **2** |
| `trait_outside_selected_contribution` | 1 | 0 |
| `candidate_outside_current_focus` | 1 | 0 |

**A count bound almost never repairs; a scope bound always did.** Asking for
fewer traits about the same subject is something the model cannot do without
failing the task, so it keeps the answer and loses the turn; asking it to talk
about a different candidate is something it can simply do. `maxSentences`,
`maxWords` and the metadata check never fired first in either session — the
prompt is holding those on its own.

Of the ten deaths, issue 18 closes two. Eight are issue 20 (the scope is read
from the anchor, but the turn is answering a request three messages back) and
one is issue 21 (the guard was right, the repair complied, and a bound nobody
named to it killed the result).

**Guards are now the largest source of lost turns.** Ten in T-C1-021 against the
cooldown's seven. Before adding another server-side check, read §6's sixth rule
— the bar is a demonstrated recurrence, and the first move is to fix whatever
input the guard is reacting to.

**The pooling DV changed on 2026-09-08.** Issue 15 corrected the extractor, which
means `sharedInfoIds` and `revealStats` from sessions after that date are not
directly comparable with earlier ones — the earlier ones under-record. T-C2-045
recorded 3 matches and 3 misses for each finalist where the board held 3 and 4.
Say so before comparing any pooling figure across that line.

**Issues 12 and 13 were one failure at two depths** — a reply to Alex that goes
unanswered. 12 was the Observer not seeing it; 13 was everything below the
Observer losing it anyway. Both are now shipped, neither is measured, and
T-C2-045 showed that fixing 12 alone would not have saved that session.

**An unanswered request now outlives the turn it was made on.** Issue 13 half B
split the `invited` selectability rule: a request (`invitation`,
`group_request`) stays selectable until the reducer retires it, an `uptake` is
still selectable only while its evidence is the current trigger. The cadence did
not move — `opportunityMayBypassCooldown` is untouched, so a carried-over
request becomes an option only on turns where Alex could already have spoken.
The Judge prompt is now `conversation-ledger-judge-prompt-v8` and lists the
requests it owes. See `docs/adr/0006-a-request-outlives-its-turn.md`.

**Two sessions ran on the half-B build on 2026-09-08** — a Member session under
the reused code `T-C1-021` and a Chair session `T-C2-046`. See the measurement
log; the id collision is flagged there. Issue 13 half B is **confirmed live**
(an invitation silenced by cooldown at seq 24 was taken at seq 25, which the
previous build could not reach). Everything from issues 14, 15, 18 and 19 is
still verified by build, the six `test:*` suites, `docs:check` and deliberate
breakages only. §5 lists the four suites the gate requires; `test:seq` and
`test:conversation-gold` exist and pass but are not in that list.

**The reveal budget silenced more turns than the cooldown did.** T-C1-021 lost
ten turns to `output_violation_after_repair` against seven to the cooldown, and
eight of the ten were one question repeated. Do not reason about Alex's speech
volume from the cooldown alone.

**The budget was not the fault, and issue 17 records two wrong fixes for it.**
`maxRestatedTraitIds` is reachable only through `ROUTE_REVEAL_BUDGET`, which
applies **only when the turn carries no request** — a turn with nothing to
enumerate, where a recital is the failure mode. T-C1-021 met the bound only
because the request misclassified as `none`, which is issue 18. Retiring the
bound as "redundant with the length bounds" is refuted by gate D2's own
regression: a 40-word, two-sentence, six-trait recital passes both length bounds.
**Length does not catch a terse recital.**

**The Judge has never chosen silence.** 21/21 and 9/9 across the two sessions:
every turn that reached it came back `speak`. Any proposal to remove the
cooldown and let the Judge decide silence has to start there — the branch it
would rely on is currently unexercised, and the Judge is condition-aware while
the cooldown is not.

**The golden set does not cover the live prompts, and never did.** `run-golden`
builds its prompt through `buildSystemPromptForTask`, which reads
`compiled-prompts.json` — the legacy path `aiTurn.ts` uses, and `aiTurn.ts` says
of itself "LEGACY EVALUATION PATH ONLY". Live turns read
`route-prompts.snapshot.v1.json` through `getRoutePrompt`. The two prompt systems
share no text: the 1.9.0 edit appears in all 30 route keys and nowhere in
`prompts.ts`. **A route-prompt version bump is not a reason to re-run the golden
set**, and saying so once already cost a run. The route prompts are covered
structurally instead — startup hash verification plus the assertions in
`test-intervention-v2.ts`.

**Nothing offline exercises the live route prompts against the model.** That is a
real gap, not a decision; name it before assuming a session is the only way to
see a prompt regression.

**Two sessions ran on 2026-09-08, and together they are the controlled
comparison this repair never had.** T-C2-043 is the pre-repair build
(`promptVersion 1.8.0`, no `outputGuard`); T-C2-045 re-ran almost the same human
script on the new one. **Alex's mean length fell 56.0 → 39.4 words, the maximum
145 → 72, budget-exceeding messages 13/20 → 4/20, and the verbatim recital
stopped.** Issues 01, 03, 04 and 09 are measured, not merely built.

What the pair also showed: issue 06's mechanism fires and its content still
misses; an explicit request to Alex can be silenced by cooldown and then
abandoned (issue 13); and a count request ignores its own source (issue 14).

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
the engine-side early supersession check, issue 13B's `owedRequestIds` on the
silence record, issue 19's `forbidQuestion` hand-off in `routeTurn`, and issue
21's `outputGuard` on a generation failure are all verified by reasoning plus
live measurement only.
Building that harness is worth doing before the generator work, which needs
generation-level post-conditions. **Do not describe those six as
regression-covered.**

`owedRequestIds` is the sharpest current example of why the harness is owed. Its
derivation, `unansweredRequestsForAlex`, is asserted directly; the line in
`recordSilence` that calls it is not, and that is the exact shape — predicate
tested, wiring untested — that hid the reveal budget for the whole of gate A.

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

Six rules, each of which this repair learned by breaking.

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

**Enforcement is not free, and the bar is a demonstrated recurrence.** The rule
above says a prompt-only rule is not a rule. Its counterweight, learned later and
more expensively: every server-side check is another way for a turn to die, and
by 2026-09-08 that had become the **largest** failure mode there is. T-C1-021
lost ten turns to output guards against seven to the cooldown, and seventeen
repair calls fired on one violation class alone. A guard that silences a correct
answer costs more than the behaviour it was aimed at.

So the two rules resolve by evidence, not by preference. Enforce in the server
when the prompt has **repeatedly and observably** failed: the no-question
post-condition was built after four separate sessions broke a rule stated in
every prompt that carries it. Do not enforce on a single observation — issue 16
is the worked example, and the reasoning is in that file. Prefer, in order: fix
the input the guard is reacting to (issue 18), then record the behaviour and
measure how often it recurs, then guard.

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
