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

**Status:** ready-for-agent

- [ ] All seven sessions appear as entries in one chronological log with the fixed
      shape above
- [ ] Every entry distinguishes confirmed, disconfirmed, and not-exercised
- [ ] The four negative results named above are present and not softened
- [ ] The summary table has one column per session and replaces the two-column form
- [ ] No finding's substance is changed; a diff against the source sections shows
      moves and reshaping only
- [ ] Sumin has been asked where the log should live, and the answer is recorded
- [ ] The source sections are marked in the migration map as moved
