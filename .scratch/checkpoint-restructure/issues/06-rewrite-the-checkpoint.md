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

**Status:** ready-for-agent

- [ ] The checkpoint contains only the sections listed as kept, plus pointers
- [ ] The current-state block holds only what cannot be derived elsewhere, and no
      per-item status table
- [ ] Section order matches reading order
- [ ] The progress log is gone, and both things it uniquely held have demonstrably
      landed in their new homes
- [ ] The document states its own scope and expiry near the top
- [ ] Every pointer resolves; `docs:check` fails if any does not
- [ ] The migration map has zero unmoved entries, and `docs:check` now **fails**
      rather than reports when an entry is unaccounted for
- [ ] The invariants are a list, so their count is assertable and one cannot be
      added by burying it in a paragraph; `docs:check` asserts this
- [ ] The four existing test suites are untouched and still pass — the change stayed
      inside documentation
