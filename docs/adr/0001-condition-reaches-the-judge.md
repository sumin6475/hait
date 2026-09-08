---
status: accepted
date: 2026-09-07
---

# The condition reaches the Judge, not only the generator

Until now the Judge was condition-blind by construction — its prompts say so
literally, and forbid it to infer leader/peer or XAI/ACI — so every difference
between conditions was realised at final generation. That made a Chair and a
Member decide identically and merely *say* it differently, which understates the
manipulation: a chair differs in what they decide to do, not only in how they
word it. We inject a role goal into the Judge so the condition reaches the
decision, and accept that the manipulation now sits upstream of generation.

## What this changes about where the manipulation lives

The manipulation was always applied at two layers, and only one of them is code:
participants are given a role framing in the experiment instructions, and Alex is
given a condition-specific system prompt. This decision changes the second layer
only. Before, that layer governed what Alex *said*; now it also governs what Alex
*decides* — which candidates it weighs, which intervention it selects, and how far
it structures the discussion.

The boundary that does not move: authority over the team's final candidate
submission stays with the human participants in every condition. "The AI's
decisions are manipulated" means its internal evaluation and intervention policy,
never the group's outcome.

## Consequences

Two claims about the study need re-examining before the next run, and neither is
ours to settle:

- "The AI's status is manipulated via the system prompt" stays true but is
  incomplete — participant-facing role framing is the other half, and a reader who
  sees only the prompt half will mis-scope the manipulation.
- "The manipulation affects how the AI communicates" becomes too narrow. It now
  affects candidate evaluation and intervention selection as well.

**One part of the originating gate must not ship as designed.** That gate also
proposed exposing the cooldown counter to the Judge as a budget it can see and
spend. Combined with this decision, that would make *when* Alex intervenes depend
on the condition — and intervention triggers and timing are explicitly held
constant across conditions. Cooldown and the floor delays are condition-invariant
arithmetic today, and must stay so. The Judge may be given something real to
decide, but it must be *which act on what grounds*, never *when*.

A weaker version of that constraint is already strained and should be stated
rather than discovered: three routes exist only in the Chair conditions, so
"identical triggers" holds of the shared routes and not of mediation, summary and
closing.

## Considered and rejected

Leaving the invariant in place. It keeps the cleanest possible separation, but it
buys that cleanliness by making the manipulation weaker than the construct it
claims to manipulate. Every silence measured so far has been the router's
cooldown veto applied *after* the Judge had already decided to contribute, so the
Judge as built decides almost nothing; keeping it condition-blind preserves a
separation that is not doing any work.

## Binding regardless

A Member never gains mediation or task-standard correction. The orthogonality
assertions in the intervention test suite enforce this and must keep passing
unchanged. Note that these are the assertions covering peer/leader prompt
separation and the peer task-drift refusal; an earlier note in the repair
checkpoint cited a line number that no longer points at them, which is why this
ADR names the property rather than a location.
