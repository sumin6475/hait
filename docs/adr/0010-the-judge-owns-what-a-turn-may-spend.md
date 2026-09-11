---
status: accepted
date: 2026-09-09
---

# The Judge owns what a turn must do and what it may spend

Two sentences, and the second is the reason for the first.

> **The Judge decides what this turn must accomplish and what it may spend. The
> generator writes that; nothing else bounds it.**
>
> **A rule that cannot reach the check is not built.**

`0001` gave the Judge a role goal and drew the line it must not cross: a
condition may reach *which act on what grounds*, never *when*. That line is
untouched here. What moves is everything downstream of the act — how much Alex
may say, about which candidate, in answer to what — from a deterministic layer
that runs after the Judge and cannot see it, into the Judge itself.

## What is actually true today

Ten things can set a bound on a turn. **The Judge authors one of them.** The
other nine are computed after it has decided, by a layer that does not receive
its decision.

Three of the nine can never reach the check at all. `new_information_request`,
`scopeless_information_request` and `explicit_complete_request` are built only
when the route is `address` or `followup` — the request classifier does not run
otherwise — and `routeGenerationGuard` discards every guard on exactly those two
routes unless it is the per-turn reveal budget or a `requested_narrowing`. They
are made where they are thrown away. `focus_depth` survives only on
`long_silence`, outranked everywhere else it is built.

That leaves, on the two routes that carried 21 of Alex's 24 turns in T-C4-022,
**two live bounds out of ten**.

The record agrees. Across the two most recent sessions on repaired builds, one
check has ever fired. T-C4-022: 29 intervention rows, five violations, all
`too_many_traits`. T-C2-047: one guard death, `selected_trait_missing`; its entry
records that `maxSentences`, `maxWords` and the metadata check never fired first.
Eight of the twelve checks have no observed effect on either session, and the one
doing the work is a count.

## What the seam costs when it has no owner

**T-C4-022 seq 53 and 54.** A participant asked for a summary and for no
follow-up question; then, for a retry. The Judge read the request and routed
`address` to answer it. Separately, `withRouteRevealBudget` saw a request intent
of `none` — no pattern matches the word *summary* — and set `maxTraitIds: 1`. The
generator wrote the recap that had been asked for: 19 traits, then 25 after
repair. Both turns died. The group heard nothing for 62 seconds, and the
`long_silence` turn that broke it repeated an offer they had already declined.

Both readings were locally correct. Nothing arbitrated them, so the turn was
spent instead.

That is the shape of the whole failure, and it recurs at a smaller scale on every
ordinary turn. The reveal budget caps disclosure at one trait; the unsurfaced-notes
block, added the same week for the opposite purpose, lists everything Alex has not
said. Both reach the generator, neither knows about the other, and Alex spent its
last twelve consecutive turns asking permission to disclose a trait it never
disclosed. Eighteen of twenty-four messages carried no new trait, against a
target of zero.

## The rule that follows from it

**A count bound almost never repairs; a scope bound always did.** The 2026-09-08
guard audit is unambiguous: `too_many_restated_traits` repaired once in nine,
`too_many_traits` never in two, while every scope violation repaired. Asking for
fewer traits about the same subject is something the model cannot do without
failing the task, so it keeps the answer and loses the turn. Asking it to talk
about a different candidate is something it can simply do.

So the Judge names **what** may be said, not **how much**. A turn carries the
traits the Judge selected, or none. The check becomes *did anything outside that
selection appear* — a scope question, which repairs.

## What is removed

Twelve checks become four. Each removal is against the standing test: it must
have originating evidence, that failure must have recurred, and it must still be
possible once the Judge names the content.

| Check | Why it goes |
| --- | --- |
| `too_many_traits` | A count. Impossible once the selection is named — anything extra is already outside it |
| `new_trait_in_mediation` | The same count with a zero. A mediation turn is a turn whose selection is empty |
| `too_many_restated_traits` | A count, and the one the audit shows repairs worst |
| `too_many_sentences` · `too_many_words` | Never fired first in either recent session. The prompt is holding length on its own, and T-C4-022's mean was the lowest in the record while these were in force |
| `trait_outside_current_candidate` | Subsumed: a trait about another candidate is a trait outside the selection |
| `candidate_outside_current_focus` | Bounds which letters may be *named*, not which facts are introduced. Dropped on address and followup already, so its live surface is small and unmeasured |
| soft `too_many_trait_labels` | A count, recorded and never acted on |

Four stay.

**Two are the scope check itself.** Did a trait outside the selection appear;
did the selected trait fail to appear. These are what "the Judge names the
content" means in enforcement.

**One is the metadata leak.** It stays regardless of how often it fires, and it
is deliberately exempt from the recurrence test. Every other check fails toward a
worse message; this one fails toward a participant reading the study's internals.
That is not recoverable in a session, and the bar for it is therefore different.

**And one is the no-question post-condition, which the agreed count of three did
not include.** Applying the test honestly keeps it: it has four sessions of
evidence, it repaired three times out of three in T-C2-047, and it remains
possible after this change — the Judge names content, not phrasing, so nothing
structurally prevents an explanatory Alex from ending on a question mark. It also
guards the manipulation rather than the prose: an xai Alex that clarifies by
asking is performing the condition it exists to be contrasted against. The count
is four.

## What this does not settle

**The delivery format of the Judge's instruction.** That it is written in natural
language, condition-blind, and short is decided; whether it is one free-text line
or a set of typed fields is not, and is deliberately left to measurement. What is
decided is that it never carries register or tone. The four condition prompts own
how Alex sounds, and they are hashed and diffable; a per-turn line written by a
model is neither. Moving any part of the manipulation into it would put a
manipulated variable somewhere nobody can audit.

**The repair budget.** `MAX_REPAIR_ATTEMPTS` is 1 and a failed repair broadcasts
nothing. With four checks instead of twelve the failure rate should fall, but the
silence that follows a failure is unchanged and remains the worst outcome
available — worse than an imperfect message. Whether a failed turn should fall
back rather than vanish is a live question this decision does not answer.

**When Alex speaks.** Unchanged, and `0001` still governs it. One narrow gap is
being closed in the same work and is recorded with the wiring rather than here:
naming Alex in a request that is not a question opens an `invitation`, which does
not currently bypass the cooldown, so Alex can be addressed by name and stay
silent. The fix reads the message, not the condition, so pacing stays
condition-invariant arithmetic.

## Consequences to watch

**The prompts must move with this.** `outputDiscipline` currently tells Alex that
"the server-derived Request scope is mandatory", to "share only the amount of
information allowed by the Turn Metadata", and to "share at most one trait"
absent an explicit request. All three describe machinery this decision removes.
Shipping the wiring without the prompt edit leaves Alex obeying rules that no
longer exist — the failure `ba7fb43` was written to stop.

**A Member can now be walked into a Leader behaviour, and this is the one place
the cull touches the manipulation.** Three word lists went with the request
classifier, and one of them was a guard rather than a convenience: it recognised
"can you compile all our notes" and stopped the whole-board template answering
it for a Member. A Member holds only its own card, so assembling what the group
posted is a view it does not have and a Chair behaviour it must not show —
against the one property `CONTEXT.md` says every change must preserve.

It ships without a deterministic replacement, on the same standard applied to
every other removal here: **the protection has never been observed doing
anything.** No session in the record contains a Member assembling the board. The
list was written from phrasings rather than from a failure, and the checkpoint's method note sets the
bar for enforcement at a demonstrated recurrence, which this does not have. What
stands in its place is the Judge, which knows the condition and reads the
message, and the Member conditions' own prompts, which already carry the refusal.

**That is the weakest claim in this decision, and it is checked by a session
rather than by an argument. A Member condition — C1 or C3 — has to run before it
is believed.** The assertion in `test-intervention-v2` records the gap as it
stands rather than asserting the behaviour away.

**The measurement baseline breaks here.** Every session in `docs/measurements.md`
was run with these twelve checks in force. Trait-release figures either side of
this change are not directly comparable, and the record already carries two
smaller breaks of the same kind. This one is larger and should be stated
wherever the figures are compared.

**Nothing requires a turn to carry anything, deliberately.** The checks being
removed were the only pressure on how much Alex says, and they pushed in the
wrong direction — down, on turns that had nothing to give. The owner settled the
converse when this was written: a turn is not required to advance the board, and
no check will be built to make it. Alex may reply without adding a fact, because
people do.

**A pure restatement of the board is now unguarded, and that is a knowing
trade.** The surviving factual check asks what a turn *newly introduced*, so a
message that recites fifteen traits already on the board introduces nothing and
passes. `too_many_restated_traits` was what caught that, and T-C1-025 seq 7 is
the observed instance — fifteen restated, none new. It was dropped anyway, on
two grounds: it repaired once in nine attempts, the worst rate of any bound; and
across the two most recent sessions it was in force and never fired once, which
says the prompt is holding the rule on its own. The reason Alex recited was
having nothing to say on a turn it had to fill, and the Judge's brief now tells
every turn what it is for. If a recital returns, this is the first thing to
reconsider, and the assertion in `test-intervention-v2` records the gap rather
than hiding it.
