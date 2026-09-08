# 21: A repair is told one bound and judged against all of them

**What to build:** A rewrite that fixes what it was asked to fix is not then
killed by a limit nobody mentioned to it.

**Blocked by:** None.

**Status:** ready-for-agent

## The defect, as observed

**T-C1-021 seq 25.** Alex's draft named fourteen traits. The guard was the full
reveal budget:

```
{ candidate: null, reason: "route_reveal_budget",
  maxTraitIds: 1, maxRestatedTraitIds: 2, maxSentences: 3, maxWords: 80 }
```

`too_many_traits` fired, correctly. The repair correction sent was:

> Introduce at most 1 new candidate trait in this message. Refer back to at most
> 2 already-surfaced traits; do not recite the board. Keep it to a short chat
> message that answers what was just said.

The rewrite complied — **fourteen traits down to two** — and was then rejected
for `too_many_sentences`, a bound with a specific number that the correction
never named. `MAX_REPAIR_ATTEMPTS` is 1, so there was no second chance. A turn
that the guard had successfully improved was thrown away.

## Where it comes from

The correction is built by branching on the *single* violated bound: the
length text fires only when the violation is `too_many_sentences` or
`too_many_words`, and otherwise the trait text fires instead. So the model is
told about one dimension of a guard that constrains four, and the phrase it gets
for the others is "keep it to a short chat message" — an adjective where the
guard holds a number.

## Why this matters more than one turn

It is the only case in either 2026-09-08 session where a guard did its job and
the pipeline discarded the result anyway. Every other death was the guard
refusing something it should not have refused (→ issues 18, 20). This one is the
opposite failure and needs a different fix, which is why it is its own ticket.

## The change

State every bound in force in the correction, not only the violated one. The
numbers are already on the guard; the branch is what hides them.

## What must not regress

- The correction stays a correction: it must not turn into a restatement of the
  whole prompt, and it must keep naming the violation that triggered it first
- `MAX_REPAIR_ATTEMPTS` stays 1. This ticket is about making the one attempt
  informed, not about buying more attempts
- The candidate-scoped and metadata corrections are unchanged in what they ask
- No new model call

## Comments

### Recording asymmetry found alongside

`outputGuard` is `null` on a generation-failure record; only
`repairAudit.guard` carries the bounds that were in force. So the one class of
turn where the guard is most worth knowing about is the class where the
intervention record does not state it. Worth fixing in the same pass.
