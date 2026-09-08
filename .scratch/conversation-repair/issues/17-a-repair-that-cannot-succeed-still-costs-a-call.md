# 17: A repair that cannot succeed still costs a call, then drops the turn

**What to build:** When a draft violates a limit the repair cannot satisfy, the
turn does not pay for a second generation to find that out.

**Blocked by:** None (can start immediately).

**Status:** needs-triage

## The defect, as observed

**T-C1-021, eight turns.** A participant asked for one candidate's misses. That
candidate has three, so the honest answer restates three already-visible traits,
and `maxRestatedTraitIds: 2` rejected it. The repair prompt said, correctly,
"Refer back to at most 2 already-surfaced traits". The model returned the same
three traits reworded, and the turn was dropped.

```
initial  rejected  [C_n1,C_n2,C_n3]  too_many_restated_traits
repair   rejected  [C_n1,C_n2,C_n3]  too_many_restated_traits   → dropped
```

The model was not disobeying. The instruction and the request were in direct
conflict, and it chose the request. Issue 18's classifier fix removes this
particular conflict, but not the shape.

## What the shape is

The repair loop treats every violation as a rewording problem. Two of them are
not:

- **Trait-count violations.** Dropping a trait changes what the message says.
  When the request is *for* those traits, no rewording satisfies both.
- **Length violations.** These are genuinely repairable — the correction says
  "cut content, do not compress it" — and that one works.

So the loop pays a full generation, on the live turn's latency budget, to learn
something the first result already showed: the same trait set came back twice.

## What to decide

- **Is a second attempt with an identical trait set worth making at all?** The
  cheap version of this ticket compares the repaired draft's extracted ids with
  the initial one and stops if they are unchanged, saving the second call's
  latency but not the dropped turn.
- **Should an unsatisfiable restated-trait violation drop the turn, or pass?**
  A restated trait is already on the board; restating it discloses nothing new.
  The cap exists to stop board recitation (T-C1-025 seq 7 restated sixteen), and
  silencing a three-trait answer to a three-trait question is the cap doing
  something it was not built for. A cap that varies with what was asked is one
  answer; issue 18 took the narrower one.
- **Should the silence be attributable as this?** Today it reads
  `output_violation_after_repair`, which does not say the repair was impossible.

## What must not regress

- The board-recitation bound holds. T-C1-025 seq 7's sixteen restated traits
  must still be rejected
- No new model call is added to the accept path
- `MAX_REPAIR_ATTEMPTS` stays a bound, not a target
- Silence stays attributable, and this class stays distinguishable from a
  generation that simply failed

## Comments

### Related

Issue 18 fixed the classifier so this particular request now lifts the guard.
That is the right fix for that request and it does not close this: any future
guard whose limit contradicts an explicit request produces the same two-call,
zero-output turn.

`owedRequestIds` (issue 13) is **absent** on every `output_violation_after_repair`
record in T-C1-021, so the largest silence class in that session carries no
record of what the group was still waiting for. That path does not pass
`ledgerState` to `recordSilence`. Worth fixing alongside whichever branch of
this ticket is taken.
