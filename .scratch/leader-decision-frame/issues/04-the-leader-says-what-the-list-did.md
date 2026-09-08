# 04: The leader says what the list did, without saying a number

**What to build:** The leader's three procedural moves, as speech.

**Blocked by:** 03.

**Status:** needs-triage

## The three moves

1. **Naming a candidate the group has not covered.** When a live candidate's
   coverage trails the others, say so. This is what blocks a premature close.
2. **Saying the group has pooled something about a candidate.** When one leaves
   the list, say it plainly — "we have something of our own on A now; nobody has
   said anything about D yet". Not "let's set C aside": `docs/adr/0009` removed
   the list's ability to express a verdict, and this move must not smuggle one
   back in as a wording choice.
3. **Raising a shortfall once when the group moves to narrow or to close.** Say
   it, then accept the group's answer either way. The narrowing case is the one
   T-C3-003 seq 4 shows the need for: the group moved to eliminate a candidate
   before any trait for any candidate was on the board, and that candidate was
   the one they eventually chose.

A leader that keeps the list private is not observably a leader, and the
manipulation check has nothing to read.

## Numbers stay unsaid

Alex may name traits and may say a candidate looks weaker. It may not state
counts, ratios or scores. Two reasons, and they agree: the closing and summary
prompts already forbid it, and `CONTEXT.md` records that treating any one trait
as decisive is an error available to the group — Alex reporting a tally invites
exactly that reading with Alex's authority behind it.

T-C3-003 is the illustration. The humans ran the entire discussion as arithmetic
("4 thumbs up and 2 down", "so 6-3", "C wins with 6+ 3-"). A leader supplying
totals into that would not be leading the discussion, it would be scoring it.

## The shortfall has grounds, not discretion

The list is recomputed every turn from coverage, which never falls, so there is
nothing to reopen and no reopening move to get wrong. What the leader may do is
*raise* a coverage shortfall when the group moves to narrow or to close. It may
not raise one because it feels the discussion was hasty. Discretion here would
make "how often did the leader push back" a property of the model's mood, and
the manipulation check reads that number.

## What must not regress

- The leader raises a shortfall **once** per close attempt, then accepts
- Alex never overturns the group's choice; final submission is the humans'
- No numbers, ratios or counts in any generated message
- Peer prompts are untouched by this issue

- [ ] Each of the three moves has a prompt path and a logged marker
- [ ] A generated message containing a count is refused
- [ ] The shortfall is raised once per narrowing and once per close attempt, and not repeated when the group proceeds
- [ ] No generated message states or implies that a candidate is out of contention
- [ ] No peer route gains any of the three
