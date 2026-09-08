# 02: Compute the live candidate list, and let it reach nothing but the log

**What to build:** A deterministic per-turn derivation of which candidates are
still live, written to the turn record and to nothing else.

**Blocked by:** None. It is shadow-only, so it can land before issue 01's
sessions — and should, because those sessions are what validates its thresholds.

**Status:** done

## What it computes

Every turn, from the board only:

- `coverage(X)` — distinct traits on the board for candidate X, matches and
  misses together. `surfacedByCandidate` in `poolingTally.ts:126` already returns
  exactly this, over human `revealedIds` ∪ `aiSurfacedIds`.
- `score(X)` — matches minus misses on the board. Every trait weighs the same;
  `CONTEXT.md` says treating one as decisive is an error the group can make, and
  it is not one Alex may make on the group's behalf.
- X leaves the live list when **all three** hold: `coverage(X) >= 4`;
  `coverage(X) >= max(coverage of other live candidates) - 2`;
  `max(score of live candidates) - score(X) >= 2`.

Recomputed from scratch each turn. Nothing is carried, so a candidate re-enters
the moment new information puts it back — no separate reopening path exists,
because there is no stored state to reopen.

## Why the board and not everything Alex knows

Alex holds profile Z. If the list were computed over Z as well, Alex would
converge on the pooled answer ahead of the group in every condition, and in the
leader conditions would then steer toward it. The decision-accuracy DV would be
measuring Alex's private card. Computing over the board means Alex's own
information counts only once Alex has said it — where the pooling DV records it.

`poolingTally.ts:125` already notes that unspoken Z appears in neither source
set, so this property is inherited rather than built.

## Why it may not reach speech yet

`4` and `2` were chosen, not derived. The 39-session export is a different
architecture and cannot be replayed against them. Letting an unvalidated
threshold drive live speech, and then reading the session as evidence about the
design, is the mistake `CONVERSATION-REPAIR-CHECKPOINT.md` §6 names as letting a
plausible causal story outrun the data.

## What must not regress

- No model call is added. The derivation is arithmetic over state already computed
- No route, cadence, floor, or veto reads it
- The Observer and the extractor do not see it and do not change
- Both conditions compute it identically; issue 03 is what makes it condition-dependent

- [x] `coverage`, `score` and the live list are on the turn record every turn
- [x] Reverting the derivation fails a test that drives it from a real transcript
- [x] A candidate with high `score` and low `coverage` stays live — the hidden-profile case
- [x] A shadow-only assertion: no live routing, cadence or generation input differs with the field present or absent

## Comments

### What landed

`candidateList.ts` derives `coverage`, `score`, `live` and `setAside` from the
board, and the derivation is written to `AIIntervention.candidateList` on every
record a turn can leave: the four in `executeRouteTurn` (spoken, generation
failed, superseded, lifecycle-cancelled), the silence record, the cancelled
reservation, and both closing fallbacks. `aiTurn.ts` is untouched — it is the
historical golden path, not a live turn.

`coverage` and `score` are stored beside `live` on purpose. The list alone cannot
be re-checked against a different threshold afterwards, and the thresholds are
the thing under question.

**One decision the spec left open.** "Coverage within 2 of the best-covered
*live* candidate" is circular — which candidates are live is what is being
computed. The three tests are therefore applied once, in one pass, against all
four candidates rather than to a fixed point over a shrinking set. Setting a
candidate aside can only lower `max(coverage of the others)`, which loosens the
coverage clause for everyone left, so iterating would let one removal cascade
into exactly the removals that clause exists to prevent. The best-scoring
candidate trails itself by 0 and is never set aside, so the score clause's
reference point is identical either way and the list is never empty. One pass
sets aside a subset of what iterating would; the conservative reading is the one
the clause was written for.

**The shadow-only criterion is checked in the imports, not in behaviour.** The
claim is the absence of a reader, which no behavioural fixture can state. The
test asserts that only `candidateList.ts`, the two files that write the record,
the schema and the test itself mention the derivation at all, and that in the two
writers every line naming it is a comment, the import, or the record field.

### First read against the thresholds — they do not survive it

The pre-repair export was replayed message by message, rebuilding the board with
the deterministic keyword extractor and computing the list at every message. This
is a weak instrument twice over: it is a different architecture, and the fast
extractor is not the live one. It does not replace issue 01. It is reported
because of what it found.

Forty-three of its 48 sessions have any messages at all. Three of those ever
set a candidate aside.

| Session | Ends at | Coverage A/B/C/D | Score A/B/C/D |
| --- | --- | --- | --- |
| T-C3-007 | live `C` | 6 / 6 / 5 / 8 | 0 / 0 / **3** / 0 |
| T-C2-001 | sets aside `A` | 5 / 3 / 6 / 3 | 1 / 1 / 4 / 1 |
| T-C1-016 | **sets aside `C`** | 3 / 0 / **4** / 3 | 3 / 0 / 0 / −1 |

T-C3-007 is the case the design hoped for: the list narrows to the pooled answer
as the board fills, and candidates re-enter it three times when new information
arrives — with no reopening path, because nothing is carried.

**T-C1-016 is the case that matters.** The pooled answer is set aside there while
it is the *best-covered* candidate on the board, on four traits whose score is 0
against a leader on 3. The coverage clause protects a candidate that is *behind*
on coverage; C is ahead. That is not an unlucky session — it is the pooled
answer's shape. Its three misses are shared across all profiles and surface
early; its seven matches are distributed and surface late. A candidate whose
shared traits are its misses crosses the coverage minimum looking weak, and
nothing in the rule as written holds it.

So the thresholds do not simply need validating. The removal rule has a gap that
the sessions in issue 01 will not close by themselves, and issue 03 must not
inherit it — a leader that steers by this list steers away from the right answer
in exactly the sessions the study is about. Recorded as a comment on issue 03.

### The rule this issue shipped has been replaced, 2026-09-08

The finding above was acted on rather than filed. `docs/adr/0009` withdraws the
score-based removal rule and replaces it with coverage alone: a candidate leaves
the list at `coverage >= 5`, and `score` is recorded without being an input.

Five is derived rather than chosen, which the withdrawn 4 and 2 were not. Every
candidate carries exactly four traits visible on all three cards, so coverage 4
can be reached without the group having pooled anything; five is the first
coverage at which something beyond the common pool must be on the board.

The deeper reason the old rule could not be tuned is in `0009`: the shared four
score +4 for A, B and D and −2 for C, while the pooled scores are −2 and +4. The
sign is inverted for every candidate, so a shared-dominated board ranks them
backwards and any threshold on board score inherits it. T-C1-016 was one
instance, not the argument.

Read against the new bar, T-C1-016 says something worse than "the answer was
dropped": **no candidate in that session ever cleared coverage 5.** The group's
entire board stayed inside what a single card already held, and the old rule
eliminated the pooled answer out of a discussion that had pooled nothing.

Everything else this issue built stands — the derivation is still board-only,
still shadow, still on every turn record, and the shadow-only assertion is
unchanged. The acceptance list above was met by the version that shipped and is
met by the replacement.
