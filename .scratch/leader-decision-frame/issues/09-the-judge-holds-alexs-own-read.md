# 09: The Judge holds Alex's own read of the candidates

**What was built:** One line of Alex's standing read — the whole order, tied
candidates grouped, no numbers — in the Judge's turn facts on every turn, for
every condition (`alexPreferenceNote`).

**Status:** ready-for-human — landed, awaiting a session that exercises it.

## The defect, as observed

**T-C2-051 seq 24.** A participant asked: *"Alex, why do you think D is the
best?"*

Alex had never said D was best. It answered: *"My current read is Candidate D,
based on the overall profile…"* — taking the lean straight from the question's
premise. It happened again at seq 38.

The server computes that read from Alex's card and the board. At seq 24 it had A
and D level at the top; by seq 37, A ahead of B and D with C last. So the answer
was not contradicted, but it was not grounded in anything either.

## Why nothing carried it

The read reaches the generator as a cue, and the cue is gated on the turn's
request being classified as one of four kinds. Seq 24 was classified as no
request at all.

Across all nineteen broadcast turns of T-C2-051 the cue fired **zero times**.
Every turn in that session that expressed a lean expressed one the model chose.

This is an absence, not a conflict, and that is what decides the fix. Removing
the generator cue in favour of the Judge would trade a deterministic carrier for
a second model hop and would leave the frozen prompt's *"when the dynamic context
supplies an Internal preference cue, it is authoritative"* inert — the model
would be free on exactly the turns the cue was written to constrain. So the cue
stays, and the Judge gets the read as well. Both read
`decidePreferenceFromKnownCoverage` over the same board on the same turn, so they
cannot name different candidates.

## The whole order, not the top of it

**T-C2-051 seq 27.** A participant narrowed to A and B. Alex leads with A at that
point, so the leader alone happens to answer it — but had they narrowed to B and
D, the top of the order would say nothing at all.

Narrowing is the Judge's call, so the Judge needs the order inside whatever
subset the humans drew. The sentence places every compared candidate:

> Weighing every requirement the same, your card plus what is on the board puts
> Candidate A first, then Candidate B and Candidate D together, and Candidate C
> last.

The Judge's rule says to answer inside the narrowed set and not to reopen the
candidates the group set aside in order to answer.

## What it says on the real session

| seq | the read |
| --- | --- |
| 2 | A, B and D together first, C last |
| 5–24 | A and D together first, then B, C last |
| 27–37 | A first, then B and D together, C last |
| 42–48 | A and D together first, B and C together last |

Before anybody speaks, Alex's own card alone ranks the pooled answer last. That
is the hidden profile, and the read states it rather than hiding it.

## Boundaries kept

- **No numbers**, the same rule the coverage and card sentences follow. A count
  reads as a budget, and every requirement weighing the same is the study's
  control.
- **Condition-blind.** Having a view is not owning the procedure; the role goal
  decides whether Alex volunteers it. Contrast `leaderCoverageNote`.
- **No board, no sentence.** "Nothing separates them" is a claim about a board,
  and the offline replay eval has none.
- **Ties are grouped, never broken.** Breaking one here would be the server
  choosing a candidate.

## Open

- The read is now an input on every turn. Whether it makes Alex state a lean more
  often — and whether that is the Chair behaviour wanted — is the thing the next
  session measures.
- The request-scope block still narrows the turn to one candidate independently
  ("I took that to mean Candidate B", T-C2-051 seq 17 and 48). That is a
  different seam and is untouched here.
