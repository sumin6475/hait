# 27: Two readers decide whether a request was made, and one of them is a word list

**What to build:** Let the Judge say that a turn is the whole board, and retire
the lexical classifier from the decision of *whether* a complete-list request was
made. Today that decision is taken twice — once by the Observer, once by a set of
regular expressions — and the deterministic board recap fires only when the two
agree.

**Status:** needs-triage

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
