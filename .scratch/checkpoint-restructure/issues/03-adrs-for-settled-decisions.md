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

**Status:** ready-for-agent

- [ ] Each decision above is proposed to Sumin before being written, with a
      recommendation on any that may not be worth recording; only the confirmed set
      is written
- [ ] Every ADR states the alternatives that were genuinely available and why this
      one was chosen, not just what was decided
- [ ] The Judge role-goal ADR carries the IRB and pre-registration note, and says
      explicitly that the orthogonality assertions in the test suite remain binding
      and unchanged
- [ ] Filenames follow a four-digit number and kebab-case name; numbers are unique
      and contiguous
- [ ] Every ADR carries the required headings for the project's ADR format
- [ ] `docs:check` asserts the numbering and heading properties
- [ ] The checkpoint sections these replace are marked in the migration map as
      moved, naming the ADR that now holds them
