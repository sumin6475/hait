# 21: A repair is told one bound and judged against all of them

**What to build:** A rewrite that fixes what it was asked to fix is not then
killed by a limit nobody mentioned to it.

**Blocked by:** None.

**Status:** done

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

- [x] Every bound in force is stated, whichever one was broken
- [x] The violation still leads
- [x] A bound the guard does not hold is not invented
- [x] Mediation keeps its own instruction
- [x] A generation failure records the guard that caused it

## Comments

### What seq 25 would now be sent

The guard is the one from that turn's `repairAudit.guard`, unchanged:

before
> Introduce at most 1 new candidate trait in this message. Refer back to at most
> 2 already-surfaced traits; do not recite the board. **Keep it to a short chat
> message that answers what was just said.**

after
> **Your message introduced more new candidate traits than this turn allows.**
> Introduce at most 1 new candidate trait in this message. Refer back to at most
> 2 already-surfaced traits; do not recite the board. **Keep it to at most 3
> sentences and under 80 words.** Cut content, do not compress it into longer
> sentences.

The adjective is replaced by the two numbers the guard was already holding. The
rewrite that died on `maxSentences: 3` would have been told about it.

### The correction had no test at all

Not a weak one — none. The instruction that decides whether a rejected turn is
recovered or lost was the only part of this path with no assertion on it, which
is why a branch could describe one bound out of five for as long as it did. It
is now a pure function with the bounds enumerated from the guard.

### Applied whatever was broken, not only for scope violations

A rewrite triggered by the question post-condition is judged against the trait
and length bounds too, so it is told them as well. Stating the bounds is keyed
on the guard being in force, not on which check happened to fire.

### Verification

Four breaks: omitting length unless length was the violation (the defect
itself), inventing length numbers a guard does not hold, dropping the violation
lead, and reducing mediation to a trait count.

The mediation assertion was **weak on the first attempt** and passed the break —
it matched wording that also appears in the violation lead. Rewritten to match
the instruction's own phrase.

Build, all six `test:*` suites and `docs:check` green. **Not measured live.**

### Recording asymmetry found alongside

`outputGuard` was `null` on a generation-failure record; only
`repairAudit.guard` carried the bounds that were in force, so the one class of
turn where the guard decided the outcome was the class whose record did not name
it — the audit that found all this had to reconstruct it from a nested field.
`recordGenerationFailure` now writes the same `outputGuardAudit` the broadcast
path does, carrying the violation as well.

Like the rest of the engine-side wiring, that line is not regression-covered:
there is still no runtime harness for `reserveTurn` / `executeRouteTurn`. It is
listed in the checkpoint beside the others.
