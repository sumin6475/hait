# 03: Make length a post-condition, not a request

**What to build:** A message that is too long costs the turn instead of going
out. Two prompt-only attempts have already failed to shorten Alex, so length
joins the reveal budget behind the output scope guard, which fails closed.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

Asking the generator for brevity in prose does not produce it. **T-C1-024** seq 7
ran five sentences and four traits against a contract of 40 words, two sentences
and one trait, and recorded `outputScopeRepaired: false` — the message went out
oversized because nothing checked. **T-C1-025** produced a 138-word mean.

Length has since improved on its own (**T-C1-027**: mean 34.7 words, max 68, no
dumps), so this is no longer urgent. It is still unenforced, which is the point:
the improvement is a property of the current prompt, not of the system.

## Two changes

**A. Use the model's own length control.** Set `text: { verbosity: "low" }` on
the generator. `reasoning: { effort: "minimal" }` is already set; this field is
simply unused. No prompt edit.

**B. Add a length post-condition** — sentence count and word count — to the
output scope guard, beside the trait bounds it already enforces. And trim the
`outputDiscipline` exception clause ("explicitly requested full list or
comparison"), which currently fires on ordinary turns and excuses the very
messages the guard exists to stop.

## What must not regress

- **The guard fails closed.** A violation costs the turn, through the existing
  repair loop. An oversized broadcast is worse than a missing one.
- **An explicit request for the whole board still answers in full.** The request
  scope machinery is entitled to decide that no limit applies, and those paths
  stay untouched. The post-condition bounds turns that asked for nothing in
  particular.
- The reveal budget and the length bound are separate limits on the same turn.
  Do not fold one into the other.

- [x] `verbosity: "low"` is set on the generator call
- [x] The output scope guard rejects a message over its sentence or word bound
      and routes it through the existing repair loop
- [x] The exception clause no longer fires on a turn that carried no explicit
      full-list or comparison request; the clause is gone entirely
- [x] A turn with an explicit whole-board request still answers in full
- [x] Exhausted repair costs the turn and records it as such, distinctly from
      every other silence reason

## Comments

### The premise was false, and had to be fixed first

"Length joins the reveal budget behind the output scope guard, which fails
closed" assumes the reveal budget reaches a live turn. **It did not.**

`withRouteRevealBudget` computes the budget *for* `address` and `followup` — and
only for those two routes, and only when the turn carried no request.
`routeGenerationGuard` then returned `undefined` for both routes unless the
guard's reason was `requested_narrowing`, which the budget's is not. So the
budget was built and thrown away before generation, on every turn it existed for.

It passed its own suite the whole time, because every assertion on it calls
`outputScopeViolation` directly with the guard object. The predicate was tested;
the wiring was not. That is the fifth vacuous guard this repair has found, and
it is **one of the three possibilities T-C2-041 seq 4 could not be told apart
from** — see issue 09, which exists because the export cannot answer that
question.

The budget now passes through; the candidate scope still does not, which is what
the original rule was actually protecting ("direct answers are not rewritten by
candidate/trait extraction"). The two were indistinguishable because an explicit
new-information request also caps traits at one, so `withRouteRevealBudget` now
marks what it supplied with `revealBudget: true` and the passthrough reads the
mark, not the numbers.

### The numbers, and why not 40 and 2

The prompt asks for two sentences and about forty words. The guard is not that
aim restated — it fails the turn, so it has to sit above output the prompt is
already producing well, or it costs turns that were going fine. T-C1-027's
longest message was 68 words and was judged good; T-C1-024 seq 7 was five
sentences and T-C1-025 averaged 138 words.

**Three sentences, eighty words.** Both bounds separate those two populations
with room on each side. They are the tunable part of this change; the mechanism
is not.

The two bounds are independent, and the regression proves it: the 138-word
fixture is one sentence, so only the word bound catches it.

### Three exemptions kept, one removed

Greeting, summary and closing keep their exemption — they are separate routes
with their own lengths, and two of the three are deterministic anyway. The
removed clause is "an explicitly requested full list or comparison", which asked
the generator to judge its own turn and then excused it on the strength of that
judgement. The request-scope machinery already decides when no limit applies, and
it decides from the participant's words rather than the generator's reading of
them.

An explicit whole-board request is untouched, in three separate ways: it never
receives a reveal budget (`requestIntentKind !== "none"`), its route limits leave
verbosity at the API default so the model is not asked to be terse, and its guard
carries no length fields at all. There is a regression on each.

Prompt source bumped 1.8.0 → 1.9.0 and recompiled; all 30 registry hashes move,
which is what a prompt edit is supposed to do.

**Corrected in review.** The first pass deleted the clause outright, which left
`outputDiscipline` ("Except for greeting, summary, and closing, use at most two
short sentences") contradicting `unifiedInteractionPolicy` ("use the space needed
for an explicitly requested complete list") — and asked for two sentences on
exactly the turns that must enumerate a profile. The exemption is back, sourced
from the server: "a turn whose server-derived Request scope permits a complete
list or comparison". The generator no longer judges its own turn; it reads a
block that only appears when the request machinery put it there.

### Verbosity

`text.verbosity` sat unused beside `reasoning.effort`, which was already set. It
is now `"low"` on the generator, and left at the default on summary, closing and
complete-list turns. It is passed only to the reasoning family — the fallback
models do not take it.

### The silence it costs

Exhausted repair used to be filed as `outcome: generation_failed` with no silence
reason, indistinguishable from a timeout. It now records
`output_violation_after_repair`, with `output_repair_failed` kept separate for a
rewrite that would not parse. An ordinary API failure is not relabelled.

### Verification

Four breaks confirmed the assertions fail: removing the length post-condition,
dropping the budget before generation again, unsetting verbosity, and filing
exhausted repair as an ordinary failure. A fifth break — inverting the
passthrough — does not compile, which is its own answer.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live**, and the prompt version bump means the golden set should be
re-run before a session.
