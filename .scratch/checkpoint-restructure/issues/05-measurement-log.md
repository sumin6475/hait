# 05: Normalise the seven session measurements into one log

**What to build:** The seven live sessions measured during this repair currently
live in six narrative sections written at different times in different shapes, so
the trend across them has to be reconstructed by hand every time. This makes them
one chronological log with a fixed entry shape.

Each entry records: the session id and condition; its size; **what it confirmed**;
**what it disconfirmed**; **what it did not exercise**; and its metric row. The
distinction between the middle three is the point — the record must keep saying
which claims are evidenced, which were overturned, and which are still only
expected.

This is a move, not a rewrite. The findings keep their substance and their
conclusions; only their shape is normalised.

The negative results are load-bearing and must survive intact: the measurement that
disconfirmed the premise of the whole Observer gate; the schema cut that was rolled
back after it destabilised the model's own reasoning; the guards that were found to
be passing vacuously on every turn; and the four admissions of a regression that was
vacuous on its first attempt. A record that keeps only the successes is not a
record.

The current two-column metrics table has already been overtaken twice by newer
sessions. It becomes the log's summary table with one column per session.

**Open question for Sumin, to raise rather than decide:** does this log stay inside
the checkpoint, or become a tracked file of its own with a lifetime longer than the
repair?

**Blocked by:** 01 (the migration map must exist before the largest move), 02
(vocabulary).

**Status:** done

- [x] All seven sessions appear as entries in one chronological log with the fixed
      shape above
- [x] Every entry distinguishes confirmed, disconfirmed, and not-exercised
- [x] The four negative results named above are present and not softened
- [x] The summary table has one column per session and replaces the two-column form
- [x] No finding's substance is changed; a diff against the source sections shows
      moves and reshaping only
- [x] Sumin has been asked where the log should live, and the answer is recorded
- [x] The source sections are marked in the migration map as moved

## Comments

Landed 2026-09-08 as `docs/measurements.md`, a tracked file of its own.

**Sumin's answer, recorded as the criterion asks:** the log becomes its own
tracked file, not a section of the checkpoint. The reason given was that the
numbers here are the ones that get cited later, and burying them under a repair
checkpoint's name makes them hard to find. `.gitignore` gained a third narrow
negation beside `docs/agents/` and `docs/adr/`; the checker now scans the file
like any other tracked document.

**Nine entries, not seven.** The seven measured rounds, plus the T-C2-034
diagnostic baseline that set the repair's first goal, plus T-C2-041 — a partial
session that had never been written up anywhere and that carries the correction
below. T-C1-021 has no entry: it appears only as one column in T-C1-022's
comparison table and no other record of it exists. That is stated in the log
rather than quietly ignored.

**The correction Sumin asked for, made in place.** §4i explained the schema-cut
rollback by saying the removed fields had been acting as reasoning scaffold,
since both stuck fields sat immediately after one of them and structured output
is generated in schema order. **T-C2-041 disconfirms it.** The rollback is in
effect there — Observer `v12`, the field asked for again and populated — and
`alexRelevance` is still `not_relevant` on 5 of 5 observations, 4 of them
alongside `explicit_addressee`. Restoring the fields did not restore the
behaviour, so the cut was not the cause and the real cause is unknown. §4i now
says so, the status table row says so, and the log says so. The rollback itself
still stands: 7% of output for no latency was not a trade worth making either
way. The method note that came with it — measure the fields you keep, not only
the tokens you cut — is right in general and was wrong about this case, and it is
kept on those terms.

**Reading T-C2-041 properly turned up four more things**, which is the argument
for the log's shape: they were only visible because the export was read against
the other eight runs rather than on its own.

- **The strongest evidence yet for issues 01 and 02, and it is a Chair session.**
  Two of six decisions were cooldown silences, and both paid for a full Observer
  (4.9 s, 6.5 s) *and* a full Judge — which answered `contribute` with a real
  trait each time. Both were voluntary contributions with no selected
  opportunity: the one path where the validator has no cooldown rule. The
  asymmetry found by reading the code is now observed live.
- **The literal-candidate detector missed a third time.** The observation at
  seq 6 reports no mentioned candidate while seq 6 names one by a bare letter.
  Focus fell back to the thread's carried candidate, which happened to be the
  same letter — **the miss was masked by an inference that was right by
  accident**. That is why issue 05 keeps both halves together.
- **The reveal budget is not auditable from an export.** seq 4 is a 59-word
  message naming all four candidates on Alex's second turn — the shape D3 exists
  to prevent — and the intervention record persists no guard fields at all, so
  set-and-passed, set-and-violated, and never-set are indistinguishable. The
  suspicion stays unverified, and this became **issue 09**: an enforcement
  mechanism that cannot be audited from its own output will fail silently again,
  as it already did once across several sessions.
- **Judge caching is still zero on every call**, exactly as T-C1-022 explained
  structurally. Recorded as a non-defect so it is not re-investigated.

**The second T-C2-041 suspicion could not be settled either.** Whether seq 6's
invitation was consumed by a task-grounding template is not decidable from the
export; the turn records a selected opportunity and a route, not the template
path. It is not in the log as a finding.

**Three procedural notes are kept at the end of the log**, because each one cost
a measurement: the missing T-C1-021 record, the restart rule (T-C1-022's A6
conclusion was wrong because the process had hot-reloaded across the change), and
the method note above. **The current working tree has hot-reloaded through about
ten edits including five deliberate breakages — restart before the next run.**

**`done` is now a sixth triage label**, recorded in `docs/agents/triage-labels.md`
with its reason: the canonical five have no terminal state and closed tickets
were being marked with a word nobody had agreed. A `done` issue keeps its
filename, so links to it do not break.

Build, `docs:check` and all four suites green.
