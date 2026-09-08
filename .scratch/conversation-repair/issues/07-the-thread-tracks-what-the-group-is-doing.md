# 07: Make a thread's requested action track what the group is doing

**What to build:** The instruction the generator receives describes what the
group is currently trying to do. Today it describes what the group was doing when
the thread was created, forever.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

A thread's requested action is written once, at creation, and never revised. In
**T-C1-022**, a thread rooted at Alex's own greeting carried "greet participants"
for the whole session, and at seq 10 that instruction made Alex greet the room
again in the middle of the discussion.

A thread is a stretch of conversation pursuing one goal with one requested
action, and a new one begins when the group changes what it is trying to do — so
a requested action that never changes is either stale or evidence that the thread
should have ended.

## The change

Either the requested action is revised as the thread proceeds, or it stops being
passed to generation as an instruction. Both are acceptable outcomes; pick one
and say why in the issue's comments.

Note the interaction: revising it means the Observer writes it more often, and
the Observer's output growth across a session is already a known cost. Prefer the
option that does not grow the observation.

## What must not regress

- The ledger stays the authority on threads. The Observer proposes a revision; it
  does not apply one
- A thread's identity must not change when its requested action does. Opportunity
  keying depends on the thread id

- [x] A long thread does not carry its opening action into the middle of a session
- [x] The T-C1-022 seq 10 shape does not recur
- [x] Thread identity is stable across a revision
- [x] The choice made — revise, or stop passing it — is recorded with its reason

## Comments

### A correction to the issue's premise

"A thread's requested action is written once, at creation, and never revised" is
not what the code does. The Observer re-emits `activeThread` on every turn, the
delta carries `requestedAction`, and the reducer takes the new value — the
existing-thread branch spreads `...proposal` over `...existing`. The field is
revised every turn.

What T-C1-022 showed is that the Observer kept *describing the thread's opening
purpose*. So the field was current in the sense of freshly written and stale in
the sense that matters, which is worse than plainly stale: it looked current.

That correction is what settles the choice, because it changes what option A
would actually be.

### The choice: stop passing it, and why

Option A is not "make the Observer write it more often" — it already does. It is
"hope the Observer writes it differently", which means changing a versioned
prompt, re-running the Observer eval, and then depending on a probabilistic
free-text field to be right, while that field is consumed by another model as a
mandatory instruction. The instruction quality is the defect, and A leaves it in
place.

**Option B.** The thread's requested action stops reaching generation. Nothing is
revised, no prompt version moves, no model dependency is added — and the issue's
own preference ("the option that does not grow the observation") is satisfied
absolutely rather than approximately, because the observation does not change at
all.

Nothing is lost. Every turn already carries a current instruction: the route
contract, the Turn Metadata primary goal, the communicative act, the request
scope, and — on a selected opportunity — the source utterance itself, which is
current by construction. The thread description was a stale free-text order on
top of all of that.

### The two places it reached generation

**`describeConversationSituation`.** "Its current goal is X: <requestedAction>",
the paragraph that is the generator's picture of the turn. The goal stays: it is
a small enum naming the kind of project, not an action to perform.

**The selected-opportunity block**, which is worse and was easy to miss:
`selectedOpportunityGenerationContext` fills the opportunity's `requestedAction`
from **`thread.requestedAction`**, and the block heads itself "sole primary
task". So the thread's description was being presented as the one thing this turn
must do. That is exactly the T-C1-022 seq 10 shape, and it is the line that
produced it.

### What was left alone

**The ledger and the audit.** `requestedAction` stays on the thread, on the
generation context, and in `selectedOpportunityRequestedAction` on the
intervention row. It stops instructing; it does not stop being recorded.

**The Judge.** `describeConversationLedger` still names it, and the legacy Judge
path serializes `stateAfter` whole, so removing it from the prose would not have
hidden it anyway. The Judge is deciding whether and how to act with the full
transcript beside it; generation was receiving it as an order. Those are
different uses and only one of them was the defect.

### Verification

Two breaks confirmed the assertions fail: putting the thread action back into the
opportunity block, and making thread identity move with a revision. The identity
regression is new — opportunity keying depends on the thread id, and it now has a
test that says so.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live.**
