# Restructure the repair checkpoint into artifacts with distinct lifetimes

Status: ready-for-agent

## Problem Statement

`CONVERSATION-REPAIR-CHECKPOINT.md` is 1,807 lines across 52 sections, and it is
one of only two design documents that travel with the repository — every file
under `docs/` is excluded by `.gitignore`, so `CHANGELOG.md`, `prompt-set.md`,
the intervention spec, `SESSION-PROVENANCE.md` and the 2026-06-16 ADR are all
local-only. Anything moved into `docs/` disappears from the repo.

The file has accumulated six genres of content whose lifetimes and audiences do
not match:

- **Vocabulary** used everywhere but defined nowhere. The repo has no
  `CONTEXT.md`. Terms like *opportunity*, *floor*, *ledger*, *route*, *reveal
  budget*, *supersession* and *condition orthogonality* are load-bearing across
  code, prompts, tests and this document, and each is currently explained
  in-line, repeatedly, in whichever section needed it first.
- **Decisions with real trade-offs** that a future reader will not be able to
  reconstruct: retiring the condition-blind Judge invariant, replacing the model
  extractor with the deterministic matcher, rolling back the Observer schema cut,
  keeping the layout ban and declining instead.
- **Invariants** (§7, 24 lines) — rules that constrain all future work.
- **Measurement records** for seven sessions (T-C1-020 through T-C1-027, roughly
  250 lines), append-only and still growing.
- **Work tracking** — gates 1/2/3/3R and A/B/C/D, mixing finished work, decided-
  but-unbuilt work, and open questions. The repo now has an issue tracker
  (`.scratch/`, see `docs/agents/issue-tracker.md`) that did not exist when these
  were written.
- **A progress log** (§8, 183 lines) that restates commit messages already in git.

Three concrete failures follow from the mixing:

1. **Reading order no longer matches file order.** The sections run 4f-bis (L1086)
   → 4i (L1122) → 4g (L1206) → 4j (L1258) → 4k (L1309) → 4h (L1386). Neither
   chronological nor alphabetical.
2. **The resumable header has gone stale twice.** It is a hand-maintained summary
   of state that lives elsewhere in the same file, so it drifts every time a
   section is added and is only corrected when someone notices.
3. **Terms drift because nothing pins them.** "Focus" and "salience" were used
   interchangeably until Gate 3R had to separate them; "scope" currently means
   both the request's breadth and the output guard's limits.

## Solution

Split by **lifetime**, not by topic, and keep everything that survives the split
inside the tracked part of the repo.

| Artifact | Lifetime | Holds |
| --- | --- | --- |
| `CONTEXT.md` (root, new) | permanent, slow-changing | the glossary and nothing else |
| `docs/adr/NNNN-*.md` (new, un-ignored) | permanent, append-only | decisions with trade-offs, one per file |
| `CONVERSATION-REPAIR-CHECKPOINT.md` | until the repair ends | current state, how to verify, invariants, method note, and the measurement log |
| `.scratch/<slug>/` issues | until the work ships | every open gate and next action |

The checkpoint stops being the container for everything and becomes the *repair's*
document: what is true now, how to check it, and what the sessions measured. Work
moves to the tracker, decisions move to ADRs, and vocabulary moves to the
glossary, where each has an owner and a natural end.

Nothing is deleted. Every section either moves to a new home or stays, and the
migration is verifiable.

## User Stories

1. As an agent resuming this repair cold, I want the checkpoint's first screen to
   tell me the current state without my having to reconcile it against the rest of
   the file, so that I can start work from a summary I can trust.
2. As an agent resuming cold, I want each open piece of work to be an issue in the
   tracker rather than a row in a table inside a 1,807-line document, so that I can
   see what is actionable without reading the history of what is not.
3. As an agent writing code, I want the project's terms defined in one place, so
   that I use `opportunity` and `thread` the way the reducer uses them rather than
   the way the sentence I happened to read used them.
4. As an agent writing code, I want to know that "scope" is ambiguous in this
   project before I write a function called `scope`, so that I pick the term the
   glossary settled on.
5. As an agent proposing a change, I want to find the decision that already ruled
   my proposal out, so that I do not re-litigate the model extractor or the
   Observer schema cut a second time.
6. As an agent proposing a change, I want ADRs to state what was traded away, so
   that I can tell a settled decision from an unexamined habit.
7. As Sumin, I want the condition-orthogonality rules stated once as invariants
   rather than restated in every gate, so that a reviewer can check them in one
   place.
8. As Sumin, I want the seven session measurements in one chronological log with a
   stable shape, so that the trend across T-C1-020 to T-C1-027 is readable without
   my reconstructing it from six separate narrative sections.
9. As Sumin, I want each measurement entry to record what it confirmed, what it
   disconfirmed, and what it left unverified, so that the record distinguishes
   evidence from expectation.
10. As Sumin, I want the record to keep the negative findings — §4g disconfirming
    Gate B's premise, B1 being rolled back, D3/D4 passing vacuously — so that the
    method holds up under examination rather than reading as a success narrative.
11. As Sumin, I want the four vacuous-first-attempt admissions preserved verbatim,
    so that the reliability of the remaining regressions is legible.
12. As Sumin preparing the thesis methods section, I want the decisions that touch
    the manipulation to be separately addressable documents, so that I can cite the
    Judge role-goal decision without attaching a repair log.
13. As Sumin preparing IRB material, I want the decision that moved the
    manipulation upstream of generation to carry its own IRB note, so that the
    pre-registration check is attached to the decision rather than buried in a
    progress-log paragraph.
14. As Sumin, I want to know which documents travel with the repo and which are
    local-only, so that I do not move something into `docs/` and lose it.
15. As Sumin, I want the restructure to move content rather than rewrite it, so
    that I can verify nothing was lost or quietly reworded.
16. As Sumin, I want the migration to be checkable by a command rather than by
    re-reading both versions, so that verification is cheap.
17. As a future collaborator, I want to read `CONTEXT.md` and understand the
    domain in ten minutes without reading any repair history.
18. As a future collaborator, I want ADRs numbered and dated, so that I can read
    the decisions in the order they were made.
19. As a future collaborator, I want the checkpoint to say plainly that it is a
    time-bounded repair document, so that I do not treat it as the system's
    architecture reference.
20. As an agent running `/triage`, I want the gates that are still open to carry
    the tracker's own status vocabulary, so that triage works on them like any
    other issue.
21. As an agent picking up work, I want each migrated gate issue to be
    self-contained — the defect, the evidence session, the constraint — so that I
    do not have to read the checkpoint to act on it.
22. As Sumin, I want the progress log's content that git already holds to stop
    being maintained by hand, so that the two cannot disagree.
23. As Sumin, I want anything the progress log holds that git does *not* — the
    measured effect of each gate, and the vacuous-test admissions — to survive the
    log's removal.
24. As an agent, I want section cross-references (`§4h`, `§7`) to resolve after the
    split, so that a pointer into a moved section is not a dead end.
25. As Sumin, I want the section-ordering defect fixed as part of the move rather
    than as a separate pass, so that the file is reordered exactly once.
26. As Sumin, I want the restructure to leave every runtime file untouched, so that
    the four test suites are unaffected and the change is reviewable as
    documentation alone.
27. As Sumin, I want `docs/adr/` un-ignored the same narrow way `docs/agents/` was,
    so that no other local-only note becomes tracked by accident.
28. As Sumin, I want to be told which sections I should decide the fate of rather
    than have them silently dropped, so that the judgment calls stay mine.

## Implementation Decisions

**Modules changed.** Documentation only. No file under `client/` or `server/`
changes, with the single exception of adding one `npm` script and its checker
under `server/src/scripts/` (or a top-level `scripts/`, matching wherever the
repo's other check scripts live).

**`.gitignore`.** Add `!docs/adr/` next to the existing `!docs/agents/`
exception, under the same `docs/*` rule. Do not broaden `docs/*` further; every
other file under `docs/` stays local-only, deliberately.

**`CONTEXT.md` — glossary only.** Root of the repo. No implementation details, no
decisions, no status. Terms to define, drawn from what the checkpoint and code
already use inconsistently:

- The pipeline roles: *Observer*, *ledger reducer*, *Judge*, *router*, *generator*
- *Opportunity*, and its `kind` / `expectation` axes
- *Thread*, *floor*, *human floor*, *cooldown*
- *Route* and the route kinds
- *Trait*, *candidate*, *profile*, *hidden profile*, *Z-exclusive trait*
- *Surfaced* vs *confirmed* vs *known* — three different sets the code keeps apart
- *Reveal budget*, *output scope guard*, *request scope*, *request intent*
- *Supersession*, *consumed*, *capitulation*
- *Condition*, *Peer* / *Leader*, *condition orthogonality*
- *Focus* vs *salience* — separated by Gate 3R and still used loosely in prose
- *Scope* — currently overloaded; the glossary must split it into the request's
  breadth and the output guard's limit, and name each

The glossary records the resolution, not the argument. Where a term was
deliberately narrowed, say what it now excludes.

**`docs/adr/` — one decision per file**, numbered from `0001`, dated, with the
trade-off stated. The decisions in the checkpoint that meet the bar (hard to
reverse, surprising without context, a real trade-off):

- Retire the condition-blind Judge invariant in favour of a role goal inside the
  Judge. Carries the IRB / pre-registration note about the manipulation moving
  upstream of generation.
- Replace the model trait extractor with the deterministic closed-pool matcher on
  both the broadcast path and the guard path. Trades recall on unanticipated
  phrasings for a failure mode that cannot read as absence.
- Roll back the Observer output-schema cut. Records the general finding: a
  structured-output field can carry reasoning value after its own value is
  discarded, so schema cuts must be measured on the fields kept, not the tokens
  removed.
- Keep the layout ban and decline honestly instead. Includes the Peer-only
  collation refusal as an orthogonality property rather than a tone preference.
- Take the Observer off the critical path by deciding deterministic vetoes first
  (Option 2), then splitting the call (Option 1). Decided, not yet built.
- Rank opportunities by candidate salience rather than conversational focus.
- Treat successful broadcast as the only transition that consumes an opportunity.

The existing `docs/decisions/2026-06-16-ADR-judge-protection-and-slim.md` is
local-only and predates this scheme; leave it where it is and note it from the
first ADR rather than renumbering it.

**The checkpoint keeps** its current-state block, the branch and safety rules
(§0), the goal state (§1), the invariants (§7), how to verify (§5), the method
note (§6), and the measurement log. It loses the gate tables, the progress log,
and the decision narratives that become ADRs — each replaced by a one-line pointer
to the new home.

**Current-state block.** Reduced to what cannot be derived: the branch situation,
what is uncommitted where, and a pointer to the tracker. The per-item status table
moves to the tracker, which owns status.

**Measurement log.** One entry per session, chronological, with a fixed shape:
session id and condition; size; what was confirmed; what was disconfirmed; what
was not exercised; the metric row. The seven existing sessions are migrated into
that shape without rewriting their findings. The metrics table (§ Measurement
targets) becomes the log's summary table with one column per session, replacing
the current two-column form that has already been overtaken twice.

**Gates become issues.** One `.scratch/` directory per open gate, with the gate's
defect, its evidence session, and its non-regression constraints copied in so the
issue stands alone. Completed gates do not become issues; their outcome is a line
in the measurement log or an ADR. Gates to migrate: Observer overlap Option 2,
Gate C (C1–C4), Gate D (D1, D4's open half, D5), and Gate B's accuracy items
(B2, B3, B6, B7).

**Progress log.** Removed. Before removal, the two things it holds that git does
not — each gate's measured effect, and the vacuous-first-attempt admissions —
move: measured effect into the measurement log's per-session entry, the
admissions into the method note (§6), which is where the discipline is already
described.

**Cross-references.** Every `§N` pointer is rewritten to name its new home. The
checker below enforces that none dangle.

**What the agent must not decide alone.** Three judgment calls stay with Sumin and
should be raised, not resolved: whether the measurement log stays in the tracked
checkpoint or moves to a tracked file of its own; whether `docs/decisions/` should
be un-ignored too; and whether any of the seven candidate ADRs is not actually a
decision worth recording.

## Testing Decisions

A good test here checks the **externally observable properties of the document
set**, not its prose. It must not assert on wording, section titles, or ordering
beyond what a reader depends on — those change as the writing improves.

**One seam**: a single checker invoked as `npm run docs:check`, following the
shape of the repo's existing `npm run test:*` scripts — a plain Node script using
`node:assert`, no framework, run from `server/` alongside the other four suites.
Prior art: `server/src/scripts/test-conversation-ledger.ts` and its siblings,
which are executed directly and print a single pass line.

What it asserts:

1. **No dangling cross-reference.** Every `§`-style pointer and every relative
   markdown link in the tracked documentation resolves to a heading or file that
   exists.
2. **No content lost in the migration.** A one-time coverage assertion: every
   section heading present in the pre-migration checkpoint is accounted for,
   either still present or listed in an explicit migration map committed with the
   change. The map is data the test reads, so an unaccounted section fails.
3. **Glossary integrity.** No term defined twice in `CONTEXT.md`; every term has a
   definition body; the file contains no code fences or file paths, which is the
   mechanical proxy for "glossary and nothing else".
4. **ADR integrity.** Filenames match `NNNN-kebab-case.md`, numbers are unique and
   contiguous, and each file carries the required headings from the ADR format.
5. **Invariants are enumerated, not prose.** Every item in the invariants section
   is a list item, so the count is assertable and an invariant cannot be added by
   burying it in a paragraph.

What it deliberately does **not** assert: section order, word counts, that a
particular term exists, or anything about the measurement numbers. Those are the
author's business.

The four existing suites must continue to pass untouched; the change should not
be able to affect them, and that is itself the check that the change stayed
inside documentation.

## Out of Scope

- Any change to runtime behaviour in `client/` or `server/`. This spec adds a
  checker script and nothing else executable.
- Rewriting the *content* of the measurements, gates, or findings. This is a move,
  with the reordering and the shape normalisation the move requires.
- The live session that next-step 1 calls for, and the Observer overlap Option 2
  implementation. Both are separate issues; this spec only files them.
- Migrating the local-only documents under `docs/` (`CHANGELOG.md`,
  `prompt-set.md`, the intervention spec, `SESSION-PROVENANCE.md`). They stay
  local-only and out of scope unless Sumin says otherwise.
- Anything about the participant text now in `server/src/scripts/test-intervention-v2.ts`.
  Sumin decided to publish it as-is; revisiting that is a separate decision.
- Publishing to GitHub Issues. The tracker is local markdown by decision.

## Further Notes

**Why lifetime and not topic.** A topic split ("everything about the Observer in
one file") fails the moment a decision spans two subsystems, which most of them
do — the overlap decision is about the Observer, the router and the ledger at
once. A lifetime split gives every piece an owner and an end: the glossary is
never finished, an ADR is never edited after it lands, the checkpoint ends when
the repair does, and an issue closes.

**Why the checkpoint survives at all.** It is doing one job well — being the
thing an agent reads to resume. The problem is that it is also doing five other
jobs. Removing the other five is the change; replacing it is not.

**Sequencing.** `CONTEXT.md` first: writing it forces the vocabulary decisions
that the ADRs and the rewritten sections then use. ADRs second, since several
checkpoint sections shrink to a pointer once the ADR exists. Issues third. The
checkpoint's own edit last, when everything it points at exists.

**Risk.** The migration map is the only thing standing between "moved" and "lost".
It should be written as the move happens, not reconstructed afterwards, and it is
the input to assertion 2 above.
