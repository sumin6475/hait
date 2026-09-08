# 03: ADRs for the decisions already made

**What to build:** One file per decision, numbered and dated, each stating what was
traded away — so that a future reader can tell a settled decision from an
unexamined habit, and so that a proposal already ruled out is not re-litigated.

The candidates drawn from the repair record, each of which is hard to reverse,
surprising without context, and the result of a real trade-off:

- Retire the condition-blind Judge invariant in favour of a role goal inside the
  Judge. **This one carries an IRB note**: the manipulation moves upstream of
  generation, so the pre-registration description of where the manipulation is
  applied must be checked before the next run. It needs Sumin's confirmation on
  that wording; do not invent it.
- Replace the model trait extractor with the deterministic closed-pool matcher, on
  both the broadcast path and the guard path. Trades recall on unanticipated
  phrasings for a failure mode that cannot read as absence — which is precisely
  what had been letting every output guard pass vacuously.
- Roll back the Observer output-schema cut, and record the general finding: a
  structured-output field can carry reasoning value after its own value is
  discarded, so a schema cut must be measured on the fields kept, not on the tokens
  removed.
- Keep the layout ban and decline honestly instead of deferring with a question.
  Includes the Peer-only collation refusal, which is an orthogonality property
  rather than a tone preference.
- Take the Observer off the critical path by deciding the deterministic vetoes
  before paying for it, then splitting the call. Decided, not yet built.
- Rank opportunities by candidate salience rather than conversational focus.
- Treat successful broadcast as the only transition that consumes an opportunity.

An older decision file predating this scheme exists but is local-only. Leave it
where it is and reference it from the first ADR rather than renumbering it.

**Blocked by:** 02 — the ADRs use the glossary's vocabulary.

**Status:** done

- [x] Each decision above is proposed to Sumin before being written, with a
      recommendation on any that may not be worth recording; only the confirmed set
      is written
- [x] Every ADR states the alternatives that were genuinely available and why this
      one was chosen, not just what was decided
- [x] The Judge role-goal ADR carries the IRB and pre-registration note, and says
      explicitly that the orthogonality assertions in the test suite remain binding
      and unchanged
- [x] Filenames follow a four-digit number and kebab-case name; numbers are unique
      and contiguous
- [x] Every ADR carries the required headings for the project's ADR format
- [x] `docs:check` asserts the numbering and heading properties
- [x] The checkpoint sections these replace are marked in the migration map as
      moved, naming the ADR that now holds them

## Comments

Landed 2026-09-08. Five ADRs, not the seven proposed. Sumin confirmed the shape;
the count moved for reasons worth keeping.

**Dropped: the Observer schema rollback.** Its rationale — that the removed fields
were reasoning scaffold — was disconfirmed the day before by a live session in
which the rollback was demonstrably in effect and the field it was supposed to
free stayed stuck, contradicting itself on four of five observations. An ADR is
not edited after it lands, so writing one whose reason is already known to be
wrong would enshrine a wrong explanation. It belongs in the measurement log until
the real cause is found.

**Reshaped: the Observer overlap.** The sequencing is a plan and is already an
issue. What is hard to reverse and invisible in the code is the *rejection* of the
obvious alternative — swapping to a faster model — on the grounds that which
models produced the behaviour is part of the study record. That became ADR-0005.

**Not written: broadcast as the only consuming transition.** It is already an
invariant in the checkpoint and stays there under the ticket that rewrites it. An
ADR would restate a rule that is written down and test-enforced.

**Two conflicts surfaced while writing ADR-0001, both real.**

The first is in the originating gate. It proposed exposing the cooldown counter to
the Judge as a budget it can spend. Combined with a condition-dependent role goal,
that makes *when* Alex intervenes depend on the condition — and intervention
triggers and timing are explicitly held constant across conditions. Verified that
they are condition-invariant today: the cooldown gate is arithmetic over message
counts and the floor delays are route constants, neither reading the condition.
The ADR records that this part must not ship as designed, and that the Judge's
real decision must be which act on what grounds, never when. A weaker version of
the same constraint is already strained and is stated rather than left to be
discovered: three routes exist only in the Chair conditions.

The second was in this repair's own writing. The checkpoint cited a test file line
number twice as the location of the orthogonality assertions, and that line now
holds long-silence gate tests. One of those citations was added by me the previous
day by copying it forward without checking. Both are replaced by the property
they were trying to name, which is the reason the ticket templates say not to
write line numbers into prose.

**A gap in ticket 01's own artifact, found by trying to use it.** The migration map
has two states, unmoved and moved, and every section an ADR draws on is *partially*
covered — the gate section that produced ADR-0001 also contains implementation
items that belong in an issue, and the section behind ADR-0003 also covers label
reservation, which is not a decision with a trade-off. Marking any of them moved
would be false. The map is left untouched and needs a third state, or a
per-section list of what remains, before the rewrite ticket can use it.

**Vocabulary corrected mid-ticket.** The glossary written yesterday called the
status distinction Peer/Leader after the code. Sumin pointed out that Chair and
Member are participant-facing, and the label helper confirms it: Alex is rendered
as "Alex — Chair" or "Alex — Member", renamed from Leader/Peer by an explicit
decision in June. Both layers are real, so the glossary now names Chair/Member as
the participant-facing and study terms and records leader/peer as the deliberate
internal spelling rather than drift.
