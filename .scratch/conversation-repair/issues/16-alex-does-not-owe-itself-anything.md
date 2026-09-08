# 16: Alex states a next step and nothing holds it to it

**What to build:** Nothing, yet. The behaviour is real and the fix is not worth
what it would cost. Measure the frequency first.

**Blocked by:** A frequency measurement (see below).

**Status:** needs-info

## The defect, as observed

**T-C2-045 seq 22.** Alex said it would present its notes on Candidate D. It
never did, and the group never heard why.

Nothing was broken. There is simply nothing to break: **an opportunity is minted
only from a human source message.** Every branch in `observerDeltaFromTurn` is
built off the human turn being observed, and `reduceConversationLedger` rejects
any proposal whose `sourceRole` is not on the human roster. Alex's own sentence
produced no ledger object of any kind.

## Why this is not being built

### The root cause is real, and it is not a missing tracker

Alex does not decide whether it speaks next. Pacing is settled outside it and
held constant across conditions, so **a promise about a later turn is one Alex is
structurally unable to keep**. Building a commitment object would be building
machinery to honour promises that should not be made, and honouring them means
speaking when the promise says so — which is the *when* that must stay
condition-invariant. That direction is closed.

The remaining direction is the output contract: stop Alex announcing steps it is
not taking now. All thirty route prompts **already say this** — "do not promise
to produce one later". So the gap is enforcement, not instruction.

### And enforcement is the expensive half

A post-condition here means a new regex in the layer that, in the same week,
became the largest source of lost turns:

| T-C1-021 | turns killed |
| --- | ---: |
| output guards | **10** |
| cooldown | 7 |

Eight of those ten were one violation class refusing a correct answer, and
seventeen repair calls fired on that class alone. A false positive here does not
reword the turn — if the repair fails, the turn dies.

### The evidence does not support paying that

| | instances |
| --- | ---: |
| T-C2-045 | 1 (seq 22) |
| T-C1-021 | 0 |
| T-C2-046 | 0 |

Across the twenty-five Alex messages in the two sessions still on disk, every
first-person future form is legitimate: two are "I'll add …" followed by the note
itself in the same sentence, and one is a stated preference about process. The
detector would have to separate those from a deferral, and the only deterministic
way to do it is a semantic proxy — whether the message discloses a trait — layered
on a hand-tuned verb list. That is a guess built to catch **one** observed
sentence.

Compare the no-question post-condition (issue 19), which was built after the same
rule was broken in four separate sessions, three times in one of them. That is
the bar this does not meet.

## What would change the answer

A frequency measurement. Alex's own promises are countable from any export with
no new code: first-person future forms in `sender: "ai"` messages, checked by
hand against whether the next Alex turn delivered. If it recurs at anything like
the rate the question defect did, the trade flips and the output-contract fix is
the one to build — not the ledger object.

## What must not regress if it is ever built

- The cadence stays condition-invariant arithmetic. A commitment must not become
  a reason to speak sooner or more often
- Opportunity provenance stays auditable — an opportunity is minted from a human
  message
- No new model call on the accept path
- Silence stays attributable

## Comments

### A guard was written and reverted

Three TDD slices of an `outputPromisesLaterDelivery` post-condition were written
and thrown away when the numbers above were counted rather than assumed. The
useful part was the evidence: `I'll` is not the signal — two real messages open
that way and hand the note over in the same breath. Any future attempt needs the
frequency first, then that distinction.

The general rule this produced is now the sixth entry in the checkpoint's method
note: **enforcement is not free, and the bar is a demonstrated recurrence.**
