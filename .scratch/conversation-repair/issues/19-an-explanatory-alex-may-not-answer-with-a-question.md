# 19: An explanatory Alex may not answer with a question

**What to build:** In the xai conditions, a request gets an answer. Today it can
get a menu of options, and the participant has to ask again.

**Blocked by:** None.

**Status:** done

## The defect, as observed

**T-C2-046, three of Alex's ten turns.** seq 8 asked whether Alex held
information on Candidate C; seq 14 asked for any new insight; seq 16 asked for a
concise comparison. Each was answered with a question offering two readings, and
seq 14→15 and 16→17 were consecutive. "Give us a concise comparison" cost two
further human turns before it was answered.

`C2.address.v1` already says:

> "Do not ask a question, end with a question mark, or request information. If a
> request is ambiguous, state the limitation briefly instead of asking for
> clarification."

and, separately, "Never answer two requests in a row with a question, and never
offer a menu of formats or order". All three turns broke the first; two broke
the second. Counting T-C1-027, where four consecutive requests were met with
clarifying questions, **this is the fourth time a prompt-only version of this
rule has failed.**

## Why this is not a style complaint

Question-led prompting **is** the aci manipulation. Every C1 and C2 route prompt
carries the no-question rule and no C3 or C4 prompt does — the axis is the
communication strategy, not the role. An xai Alex that clarifies by asking is
not merely wordy; it is performing the condition it exists to be contrasted
against, which is a threat to the manipulation check rather than to the prose.

## The change

A deterministic post-condition, like length and trait count: in an xai
condition, a generated message containing a question mark is a violation
(`answered_with_a_question`) and goes back for repair with an instruction to
answer the reading it took, or to decline plainly, in the same message.

The detector is a question mark and nothing cleverer, because the rule it
enforces is the prompt's own sentence. Anything subtler would start disagreeing
with the text Alex was given.

## What must not regress

- **aci is untouched.** C3 and C4 ask questions by design
- The existing plain-decline paths still satisfy the condition — a decline is
  what the prompt asks for *instead* of a clarification, and carries no question
  mark
- No new model call on the accept path; the repair budget is unchanged
- Alex may never say that a rule or scope prevents it from answering

- [x] Both xai conditions forbid a question; both aci conditions do not
- [x] The three real T-C2-046 outputs are detected; an ordinary answer and a
      plain decline are not
- [x] A question violation triggers repair **on a turn with no output guard**
- [x] The post-condition and the prompt text are pinned to each other

## Comments

### Deliberately not hung off the guard

Two of the three offending turns had `outputGuard.inForce: false` — no guard at
all. A check folded in beside the scope branch would have been skipped on
exactly the turns that broke the rule, which is the same shape as the reveal
budget that never reached generation in gate A. It is checked independently,
and `outputVerdict` was extracted so "does a lone question violation trigger a
repair" is a question with an assertion attached rather than a branch nobody
runs.

### The guard cannot outrun the prompts

A test walks all 30 route prompts and asserts that a prompt carries the
no-question sentence exactly when `forbidsQuestionOutput` is true for its
condition. If someone edits one without the other, that pairing fails rather
than the two silently drifting.

### Verification

Five breaks: turning the condition test off, flipping it to aci, narrowing the
detector to the final character, firing it on every message, and dropping the
question from `outputVerdict` — the last being the original bug's shape. Each
fails its own assertion.

**The wiring is not regression-covered.** `forbidsQuestionOutput` and
`outputAsksAQuestion` and `outputVerdict` are asserted directly; the line in
`routeTurn` that passes `forbidQuestion` into generation is not, because there
is still no runtime harness for `reserveTurn` / `executeRouteTurn`. Recorded in
the checkpoint beside the others of its kind.

Build, all six `test:*` suites and `docs:check` green. **Not measured live.**
