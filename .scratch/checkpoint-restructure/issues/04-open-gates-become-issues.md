# 04: Migrate the open gates into tracker issues

**What to build:** Every piece of work still open moves out of tables inside a
1,800-line document and into the issue tracker, where status has an owner and each
item can be picked up on its own.

The work to migrate: taking the Observer off the critical path by the deterministic
route (the first of the two decided steps); the Judge role-goal gate and its four
parts; the generator's remaining length and emptiness items, including the half of
the restatement work that is still open — telling the generator what it has already
said, as opposed to merely bounding the recital; and the Observer accuracy items
that carry no latency expectation.

Each issue must **stand alone**: the defect as observed, the session that evidences
it, and the constraints it must not violate, all copied in — so that an agent can
act on it without reading the checkpoint.

Completed gates do not become issues. Their outcome belongs in the measurement log
or in an ADR.

**Blocked by:** 02 — issue titles and bodies use the glossary's vocabulary.

**Status:** done

- [x] One issue per open gate item, in the tracker's own format, with its status
      field set from the project's triage vocabulary
- [x] Each issue states the defect, names the session that evidenced it, and lists
      the invariants it must not regress
- [~] Each issue is readable without the checkpoint open — written for it, but
      **not independently verified**; no reader without the checkpoint has read them
- [x] The Observer critical-path issue records that only the first of the two
      decided steps is in scope, and why the second waits for its measurement
- [x] The Judge issue records that the orthogonality assertions must keep passing
      unchanged, and links the ADR from ticket 03 once that exists
- [x] No completed gate becomes an issue
- [x] The checkpoint's gate tables are marked in the migration map as moved, naming
      the issues that now hold them

## Comments

Landed 2026-09-08 as `.scratch/conversation-repair/issues/`, eight files: seven
`ready-for-agent` and one `wontfix`.

**Gate C3 split along a seam that was not obvious until the code was read.** The
gate said "expose cooldown to the Judge as a budget it can see and spend". Two
findings changed what was left of it.

*The exposure is already there.* Both Judge prompts already carry `Messages
since Alex` and `Ordinary cooldown available`, and the prompt already asks in
prose that voluntary acts require the cooldown. What was never built is the
"spend" half — and ADR-0001 forbids exactly that, because a condition-dependent
role goal plus a spendable time budget makes *when* Alex speaks depend on the
condition.

*The prose rule is unenforced, and that is the mechanical cause of the gate.* The
Judge validator enforces the cooldown for a selected opportunity and not at all
for a voluntary `contribute`. The prompt asks, nothing checks, the model ignores
it — which is why 18 of 19 decisions were `speak` and every one of T-C1-024's
non-greeting silences was the router discarding a decision it had paid for. This
is the same shape as D2: a guard whose input made it pass vacuously. Third time
in this repair.

So C3 became two halves in two issues, along what the Judge owns:

- *stop asking the Judge about time* — a question about **what it decides** →
  issue 02. Closing the validator asymmetry symmetrically was rejected: adding a
  rule triggers a retry, which makes a blocked turn slower than today. The
  filtering pattern that already hides untakeable opportunities is extended to
  voluntary acts instead. A filtered option set is a fact about the choices; a
  counter is a fact about time.
- *stop calling the Judge when the answer cannot matter* — a question about
  **call ordering** → issue 01, where it joins the Observer's Option 2. They are
  the same surgery at two stages, and they compose rather than duplicate: the
  pre-Observer test must be conservative because no opportunity exists yet, while
  the post-ledger test is exact because they do.

Cooldown was verified condition-invariant before any of this: pure message
arithmetic, one constant, no condition read on the path.

**B5 had been dropped silently.** "Compact the carried state" is in the Gate B
table and absent from the status table, the do-next list, and §4g's redirect. Its
premise — that payload size drives Observer latency — is the one §4g measured and
disconfirmed. Recorded as issue 08 `wontfix` with the numbers, rather than
deleted, because a silent drop is precisely what this migration exists to stop.

**The migration map's missing third state landed here**, because this is the
ticket that could not proceed without it. Ticket 03 found the gap and left it
alone; four gate sections gave up part of themselves and kept the rest, and
neither `unmoved` nor `moved` is true of them. `partial` must still be present,
must name where the moved part went, and must say in `remains` what is left —
prose someone wrote, not a residue a later reader reconstructs. Five assertions,
all revert-checked: missing target, missing `remains`, target that does not
exist, heading gone from the source, and a `remains` note on a non-partial entry.
`enforceAllAccounted` now counts `partial` as unaccounted, so ticket 06 cannot
flip it while any section is half-moved.

**`docs/agents/issue-tracker.md` said the opposite of this ticket.** Its
HAIT-specific note read "do not duplicate the checkpoint into `.scratch/`; open
an issue only for work not already tracked as a gate there". This ticket inverts
that, so the note was rewritten rather than left to contradict the tracker's own
contents.

**Two smaller things.**

The checkpoint's status table and do-next list now name the issues instead of
gate sections. That is a light touch, not the rewrite — ticket 06 still owns the
body.

The worktree had no `server/.env`, so all four suites aborted on a missing
`MONGODB_URI`. Earlier tickets in this effort must have been verified from the
root checkout. Symlinked to the root copy, which `.gitignore` already covers at
`.env`; nothing secret is tracked. **Anyone running the suites in a fresh
worktree hits this first.**

**One criterion is not met and is marked `[~]`.** "Readable without the
checkpoint open; verify by having someone who has not read the checkpoint say
what the issue asks for" — the issues were written for it and carry no `§`
pointers or checkpoint dependencies, but no such reader has read them. The
mechanical proxy passed; the criterion as written did not run.

Build, `docs:check` and all four suites green.
