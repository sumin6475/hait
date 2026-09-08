# 03: Make length a post-condition, not a request

**What to build:** A message that is too long costs the turn instead of going
out. Two prompt-only attempts have already failed to shorten Alex, so length
joins the reveal budget behind the output scope guard, which fails closed.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] `verbosity: "low"` is set on the generator call
- [ ] The output scope guard rejects a message over its sentence or word bound
      and routes it through the existing repair loop
- [ ] The exception clause no longer fires on a turn that carried no explicit
      full-list or comparison request; verify against a turn that previously
      triggered it
- [ ] A turn with an explicit whole-board request still answers in full
- [ ] Exhausted repair costs the turn and records it as such, distinctly from
      every other silence reason
