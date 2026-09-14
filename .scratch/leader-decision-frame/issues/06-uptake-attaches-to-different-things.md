# 06: A peer takes up what was said; a leader may take up what the group is doing

**What to build:** A prompt-level distinction in what Alex's acknowledging opener
is allowed to attach to.

**Blocked by:** None.

**Status:** ready-for-human — landed 2026-09-14 in prompt 1.12.0; awaits a Member session

## The defect, as observed

**T-C3-003, seq 4–5.** A participant proposed eliminating Candidate C. Alex — a
**peer** — replied "I see your point about eliminating C, **but** I have an
additional note: C can make the right decisions very quickly", and shared a trait
from its own profile.

Blocking premature closure is the leader's move. A peer performed it. And it
mattered: the group eventually chose C, three of whose six positives came from
Alex's profile. Had the peer followed the group at seq 4, C would have died
there.

This is not a peer that ignored its instructions. It is a peer that was told to
take up what was just said, and did — the previous message happened to be a
procedural proposal.

## The distinction

Uptake is not the problem and is not being removed. What the uptake **attaches
to** is the condition boundary.

| Uptake attaches to | Peer | Leader |
| --- | --- | --- |
| Content — what was just said | yes | yes |
| The group's procedural move — narrowing, setting aside, closing | **no** | yes |

The same trait goes out in both conditions. Only the framing differs:

- Peer: "C came up — I've got a note that C makes the right decisions quickly.
  Do you both have that?"
- Leader: "Before we set C aside — I have a note that C makes the right decisions
  quickly. Let's look at that first."

Information volume is identical. If a peer could not share here, the conditions
would differ in how much reaches the pool, and the pooling DV would be measuring
the manipulation instead of the group.

## Prompt, not guard

This is a framing property, and a detector for it would be a model judgement in
the generation path — another way for a turn to die, on a class of failure
observed once. The rule goes in the peer's role goal and route prompts, and
violations are recorded rather than blocked. Some leakage is expected and
accepted; the record is what says how much.

## What must not regress

- The peer still shares its own information freely, including about a candidate
  the group is dismissing
- Natural uptake on ordinary turns is unchanged in both conditions
- No new post-condition, no new repair path
- The leader's framing is unchanged

- [x] Peer prompts license uptake of content and withhold uptake of a procedural move
- [ ] A peer fixture facing an elimination proposal still emits the trait (needs a
      model run: a Member session or an eval case)
- [ ] A logged marker counts peer turns that take a position on a procedural move
      (not built, 2026-09-14: a detector here is a model judgement on the generation
      path; the first Member session is read by hand instead)
- [x] Leader prompts are byte-identical apart from the intended line (C2 and C4
      differ from 1.11.0 only by LDF-07's shared sentence; `test:intervention-v2`
      pins which conditions carry this one)
