# 27: Two readers decide whether a request was made, and one of them is a word list

**What to build:** Let the Judge say that a turn is the whole board, and retire
the lexical classifier from the decision of *whether* a complete-list request was
made. Today that decision is taken twice — once by the Observer, once by a set of
regular expressions — and the deterministic board recap fires only when the two
agree.

**Status:** ready-for-human — built 2026-09-12 behind
`HAIT_GUARD_OBSERVER_BOARD_RECAP`, but **not the way this issue proposed**. The
premise below turned out to be wrong; see the correction.

## Correction, 2026-09-12: there are three readers, and the label is the loose one

This issue was written believing the Observer read the request correctly and the
word list did not. T-C2-051 disproved the first half.

T-C2-050 and T-C2-051 ran the same script. On both summary requests the
Observer's `kind` label came back differently between the two runs, while the
three fields describing the same request were identical in both:

| message | 050 label | 051 label | scope / source / count, both runs |
| --- | --- | --- | --- |
| "the whole summary we've discussed for each candidate?" | `complete_all_candidates` | `new_information_request` | whole_board / visible_board / all |
| "Alex can you give us a summary?" | `complete_all_candidates` | `new_information_request` | whole_board / visible_board / all |

So the structure is not "two readers, one of which is a word list". It is **one
stable signal with an unstable label on top of it and a word list on top of
that**. The word list was patching the label, which is why every patch bought one
session: it was never the reading that was wrong.

**T-C2-051 seq 47** is what the gap costs when nothing rescues the label. "Alex
can you give us a summary?" has no word the list carries, the bypass refused, and
the turn went to generation. The model wrote the recap from the transcript:
`A_n4` is missing, though it entered the board at seq 39, and the whole-board
answer opens with "You meant Candidate B" from the request-scope block. Fifteen
messages earlier the same participant asked the same thing in more words and got
the exact board.

## What was built instead

`observerAskedForTheWholeBoard` reads the Observer's own scope fields —
`requestedScope: whole_board`, `source: visible_board`, `countKind: all` — and
the word list no longer has to agree for the recap to fire. The scope now travels
inside `requestIntent` so the stage that reads the intent has the scope and the
source on one object.

The brake this issue said must be replaced is already inside those fields, and it
is the Observer's own documented distinction rather than a new rule: rendering
what the group has said is `visible_board`; "do you have any new insight" is
`known_profile` and never reaches the recap. `requestedScope` separates the
remaining case, "is there information that either of you have that I don't" —
`visible_board`, but scoped to `multiple_candidates`.

Across the fifteen requests in the two sessions it fires on four, and on exactly
the four that asked for the board. All fifteen are pinned in
`test:intervention-v2`.

**Not built: the Judge naming the shape.** The plan below asked for a new Judge
output field, on the reasoning that the Judge reads the message and a word list
does not. That reasoning still holds against the *word list*. It does not hold
against the scope fields, because the Judge is the same kind of reader as the
label that flipped, and nothing has measured its stability. If the scope fields
turn out to drift the way the label did, the Judge is the next move and this
section is the evidence it would need.

## The defect, as observed

**T-C2-050 seq 44.** A participant asked Alex for a summary of the board. The
Observer read it correctly as a complete-list request. The word list did not:
`summary` appears in none of `ALL_CANDIDATES_SCOPE`, `ALL_INVENTORY_SCOPE`,
`EXPLICIT_COMPLETE_SINGLE` or `EVERYTHING_REQUEST`
(`server/src/lib/routeContext.ts:895-920`). The two readings disagreed, the
agreement check at `routeContext.ts:2098` refused the deterministic path, and the
turn fell through to generation.

The agreement check is not the bug. It was added for the opposite failure:

> **[D6 / T-C1-023 seq 14]** an "any other positives or negatives?" turn — which
> the classifier reads as no list request at all — routed to the board recap.

So the word list currently serves as a **brake on the Observer over-reading**, not
as a substitute for it. Removing the brake and keeping two readers is not the
same change as adding one word, and must not be done casually.

## Why this is the root and the word additions are not

The list has already been patched twice for exactly this shape, and each patch
names its own session in the source:

| patch | what was missing | session |
| --- | --- | --- |
| `COMPLETE_INVENTORY_NOUNS` widened | "attributes", "items" — four requests classified `none` | T-C1-027 |
| `ALL_CANDIDATES_SCOPE` / `ALL_INVENTORY_SCOPE` split | "all your notes for A" hit the whole-board recap | T-C1-027 |
| *(proposed, not taken)* add `summary`/`recap`/`요약` | the word list has no summary word | T-C2-050 |

A third addition buys the next session and not the one after it: `overview`,
`rundown`, `run through`, `walk us through` are all unlisted today.

The direction is already decided elsewhere in the tree. `docs/adr/0010` moved the
four per-turn injected blocks out of `routeContext` on this exact reasoning, and
the comment left behind at `routeContext.ts:2139` states it plainly:

> the *detection* was a word list: T-C4-022 seq 53 asked for a summary, the word
> was not in any list, and the turn was answered as though nothing had been
> asked. **The Judge reads the message.**

That sentence has not yet been carried into the complete-list path, which is the
one place a word list still decides whether a person asked for something.

## What it would take

Not a deletion. The deterministic recap exists because a board recap must be
*exact* — it is assembled from `revealStats`, not written by the generator — so
something still has to authorise it. Three parts:

1. **The Judge names the shape.** It already decides the act and the size of
   `discloseTraitIds` ("every relevant id when a person asked Alex to give what
   it has", `interventionJudge.ts:538`). It does not have a way to say *this turn
   is the board, rendered whole*. That is the new output field or act.
2. **The classifier keeps its other jobs.** `classifyRequestIntent` also supplies
   `countKind`, the resolved candidate, and the reveal-budget lift. Only the
   whether-a-list-was-asked-for decision moves.
3. **The brake has to be replaced, not dropped.** Whatever stops T-C1-023 seq 14
   from dumping the board must survive. If the Judge is the single reader, the
   brake becomes a Judge rule, and its cost is a turn — so it needs the same
   before/after measurement the guard flags exist for.

## Constraints

- **Condition-blind.** Whether a request was made is read from the message, never
  from the condition (`docs/adr/0001`).
- **A recap must stay exact.** No path may let the generator author board
  contents from memory; the deterministic assembly is why this route exists.
- **Measure it.** Ship behind a guard flag or run the paired sessions. The last
  two changes to this classifier were each justified by one session, and one of
  them created the failure the next one fixed.

## Not doing now

Adding `summary`/`recap`/`요약` to `EXPLICIT_COMPLETE_SINGLE` is a one-line change
that would have served T-C2-050 seq 44. It was considered and deliberately not
taken on 2026-09-10: patching the word list a third time is the thing this issue
exists to stop. If a session is run before this is built and the gap bites again,
take the one-liner as a stopgap and say so in the commit.
