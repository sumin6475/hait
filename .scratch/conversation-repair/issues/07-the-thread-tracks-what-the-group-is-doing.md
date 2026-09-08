# 07: Make a thread's requested action track what the group is doing

**What to build:** The instruction the generator receives describes what the
group is currently trying to do. Today it describes what the group was doing when
the thread was created, forever.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] A long thread does not carry its opening action into the middle of a session
- [ ] The T-C1-022 seq 10 shape does not recur
- [ ] Thread identity is stable across a revision
- [ ] The choice made — revise, or stop passing it — is recorded with its reason
