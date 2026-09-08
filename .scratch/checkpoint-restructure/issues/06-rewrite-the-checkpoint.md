# 06: Rewrite the checkpoint as the repair's own document

**What to build:** With the glossary, the decisions, the open work and the
measurements all rehoused, the checkpoint stops being the container for everything
and becomes what it was always good at: the thing an agent reads to resume.

What it keeps: the current-state block, the branch and safety rules, the goal state,
the invariants, how to verify, the method note, and — depending on the answer from
ticket 05 — the measurement log. What it loses: the gate tables, the progress log,
and the decision narratives that are now ADRs, each replaced by a one-line pointer.

The current-state block is reduced to what cannot be derived from anywhere else:
the branch situation, what is uncommitted and where, and a pointer to the tracker.
The per-item status table goes; the tracker owns status. That table has gone stale
twice, and it went stale because it was a hand-maintained summary of information
living elsewhere in the same file.

The section ordering is fixed here, in one pass, as part of the move — the sections
currently run in neither chronological nor alphabetical order.

The progress log is removed. Before removal, the two things it holds that git does
not must survive: each gate's **measured effect**, which joins that session's entry
in the measurement log, and the **vacuous-test admissions**, which join the method
note where the discipline is already described.

The document must say plainly, near the top, that it is a time-bounded repair
document and not the system's architecture reference.

**Blocked by:** 01, 02, 03, 04, 05 — everything it points at must exist first.

**Status:** done

- [x] The checkpoint contains only the sections listed as kept, plus pointers
- [x] The current-state block holds only what cannot be derived elsewhere, and no
      per-item status table
- [x] Section order matches reading order
- [x] The progress log is gone, and both things it uniquely held have demonstrably
      landed in their new homes
- [x] The document states its own scope and expiry near the top
- [x] Every pointer resolves; `docs:check` fails if any does not
- [x] The migration map has zero unmoved entries, and `docs:check` now **fails**
      rather than reports when an entry is unaccounted for
- [x] The invariants are a list, so their count is assertable and one cannot be
      added by burying it in a paragraph; `docs:check` asserts this
- [x] The four existing test suites are untouched and still pass — the change stayed
      inside documentation

## Comments

Landed 2026-09-08. **1,830 lines → 224.**

**Kept, in reading order:** the title and its scope statement, the current-state
block, the branch and safety rules, the goal state, how to verify, the method
note, the invariants. **Section numbers now have gaps** — 0, 1, 5, 6, 7 — and the
file says so and points at the map. Renumbering would have rewritten seven
heading strings that the migration map keys on, to buy tidiness in a document
that is meant to expire. The gaps are the record.

**A fourth map state was needed, and this ticket is where it showed up.** The
acceptance criterion says the map must reach zero unmoved entries — but seven
sections were always meant to *stay*, and `unmoved` is the transitional state
that blocks the flip. So `kept` joins `moved` as a terminal state: it must still
be present, must **not** name a move target, and must say what it keeps and why.
`unmoved` and `partial` are now both transitional and both must be zero.

That is the second time this map has needed a state it did not have — `partial`
in ticket 04, `kept` here — and both times the gap only appeared when a ticket
tried to use it. **Final tally: 54 moved, 7 kept, 0 unmoved, 0 partial.**
`enforceAllAccounted` is on; an unaccounted section now fails the build.

**The invariants are assertable.** `docs:check` asserts §7 holds exactly eight
bullets and that no prose sits between them. The explanatory paragraph that
originally followed the list had to move into §5 to make that true — which is the
check working on its first run, since a paragraph inside the section is exactly
what it exists to forbid. Both directions revert-checked, along with the four new
map assertions.

The count went 8 → 8 with a substitution: the condition-blind Judge invariant was
retired by ADR-0001, and the narrower rule that survives it took the slot — a
Member never gains mediation or task-standard correction, and the cooldown and
floor delays stay condition-invariant. **Retiring it inside its own bullet, which
is how it was recorded before, is precisely what the new check forbids.**

**The progress log's two unique holdings landed where they were promised.**

- *Measured effects* → the measurement log. This turned up **two sessions that
  had no entry anywhere**: T-C2-035, which Gate 3 was built from (8 of 10
  silences were contract rejections, not an absence of content), and T-C2-037,
  which Gate 3R was built from (6 spoken of 23). The log is now eleven entries.
  Gate 2's effect and Gate 1's downward attribution correction joined the
  T-C2-034 entry, along with the six original root causes as a table — one of
  which, the regex pre-empt, **is still open** and is now visibly linked to
  issue 06.
- *Vacuous-test admissions* → the method note, as a table of four with what each
  one actually exercised, plus the fifth assertion that could not be written at
  all. The method note also gained two rules the repair learned after it was
  first written: a rule that lives only in a prompt is not a rule, and restart
  the server before measuring.

**Two sections had nowhere to go, so two issues were written rather than letting
them vanish.**

- The Observer split — the second of the two decided latency steps — had a full
  design here and no home. It is **issue 10**, blocked by issue 01, carrying the
  measurement that makes its latency claim a measurement rather than an
  extrapolation.
- The stale trait-registry draft was filed as "cosmetic; blocks nothing", and
  that is no longer true: two changes since then put Alex's own output through
  that registry, so a trait it fails to recognise is now simultaneously invisible
  to the ledger, to the anti-repeat work, and to the reveal guard. It is
  **issue 11**.

**ADR-0003 gained a section** rather than losing the content of §4k: the rule
that a refusal outranks the deterministic template, and the asymmetry that lets a
disagreement between the two readings of a request widen the scope but never
narrow it into a template. Without that precedence, widening the classifier would
have had a Member recite the group's board.

**One criterion is weaker than it reads.** "Every pointer resolves; `docs:check`
fails if any does not" is true for `§` references and relative links inside
tracked documents. The pointer to `.scratch/conversation-repair/issues/` is a
directory reference in prose, not a link, so it is not checked. Naming the
directory rather than eleven files was the deliberate choice; the cost is that
the checker cannot catch it if that directory is renamed.

Build, `docs:check` and all four suites green. `git diff --check` clean.
