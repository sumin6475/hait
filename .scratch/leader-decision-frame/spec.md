# Leader decision frame

**What this is.** The design agreed for manipulating Alex's status as *ownership
of a decision procedure* rather than as tone, speaking volume, or the right to
the last word. It replaces the four-stage state machine of the original
"Leader-only Decision Protocol (A-E-S)" proposal with the part of it that
survived scrutiny: a per-turn frame the leader reasons inside, and the peer does
not have.

**What it is not.** It is not a status board and it is not a decision record. A
decision that is settled belongs in `docs/adr/`; open work belongs in
`issues/`.

## Why the original proposal changed shape

Three of its clauses contradicted constraints the study already holds, and one
was aimed at behaviour that has never been observed.

| Original clause | Why it did not survive |
| --- | --- |
| Leader speaks on Judge stage transitions | Intervention triggers and timing are held constant across conditions (`docs/adr/0001`). A stage transition that mints a turn makes that false. |
| Peer's Judge is read-blocked from the evidence board | Alex's held information is fixed across conditions, and `CONTEXT.md` defines **Known** condition-invariantly. Blocking a read also makes the peer answer board questions wrongly, which the answer-quality bar forbids. |
| Peer may not intervene on long silence | Removes a speaking trigger from one condition. Empirically backwards: in T-C3-003 the peer's silence was read by participants as a fault ("AI Alex took a break"). |
| Generator becomes a server-fixed template with slots | The measured gain from T-C2-043 → T-C2-045 came from post-conditions on model output, not from templating. Server guards are now the largest single source of lost turns. |

A frequency count across all available evidence (15 analysed sessions, 21 repair
issues, and the 39-session pre-repair export) found **zero observations of any
leader-side behaviour failing.** Not because leaders behave well, but because no
Chair session has ever run to completion on an analysed build and no aci session
had ever been analysed at all. That is why issue 01 comes before everything else.

## The fixed points

**Nothing here may move `when` Alex speaks.** Cooldown, floor delays, route
delays and lifecycle gates stay condition-invariant arithmetic. The frame
changes *what Alex does on a turn it already qualifies for*, never whether the
turn exists. No new route is added; the nine in `RouteKind` are the whole set.

**Both conditions see the same board.** The peer is not made ignorant. It is made
**passive**. An occasional peer tally is accepted rather than guarded — see
issue 06 for what is actually held apart.

**Authority over the team's final submission stays with the humans**, unchanged.

## The computation

Deterministic, recomputed every turn, no model call. Derived from the board —
what has actually been put in view — so Alex's own unspoken profile Z cannot
steer it. `poolingTally.ts` already computes on exactly this basis.

- `coverage(X)` — distinct traits on the board for candidate X, matches and
  misses together, human-surfaced ∪ Alex-surfaced.
- `score(X)` — matches minus misses on the board for X. Recorded, and **not an
  input to the list**.
- **X leaves the live list when `coverage(X) >= 5`, and for no other reason.**

Five is derived, not chosen. Every candidate carries exactly four traits that all
three profiles can see, so coverage 4 can be reached on nothing the group did not
already share; five is the first coverage at which something beyond the common
pool must have reached the board.

**The list measures attention, not merit.** An earlier version removed a
candidate for being well covered and clearly trailing on `score`, and `docs/adr/
0009` withdraws that: over a shared-dominated board `score` ranks the candidates
backwards — the three wrong candidates at +4 and the pooled answer at −2 — so any
threshold on it eliminates the right answer at the moment the group has pooled
its common ground and nothing else. `DEPTH_MIN_PER_CAND` (3) keeps its existing
and adjacent job: holding the discussion on a candidate that is still thin.

**"Leaving the list" means only this:** Alex stops steering discussion toward
that candidate and stops volunteering new information about it. Alex still
answers questions about it. It is not removed from anyone's choice.

**The bar is still unvalidated as a bar.** It is derived rather than guessed, but
whether one unshared trait is enough attention is a question only a session
answers. Issue 02 therefore computes and logs the list without letting it reach
speech, and issue 03 does not start until a real session has been read against
it. The failure mode has changed direction: too low a bar costs a nudge not
given, where the withdrawn rule cost the answer.

## What splits the conditions

| | Leader | Peer |
| --- | --- | --- |
| Receives the live candidate list | yes | **no** — board only |
| Names a candidate the group has not covered | yes | no |
| Says the group has pooled something about a candidate | yes, without numbers | no |
| Raises a coverage shortfall when the group moves to narrow or to close | once each, then accepts | no |
| Re-argues the weakest candidate once | yes, introducing no new trait | no |
| Uptake attaches to | content **and** the group's procedural move | content only |
| Long silence | may fill | **may also fill** |

The last row is deliberate. The conditions differ in what breaks a silence, not
in whether one may be broken.

## Where it lives

Deterministic state is injected as one identical block into both the Judge and
the generator. *What may be done* goes in the Judge's role goal; *how it is said*
goes in the route prompts. The 30-key snapshot structure, its startup hash
verification, and the orthogonality assertions in `test-intervention-v2` are
untouched.

## Deliberately deferred

- **The repeated question form.** In T-C3-003, 12 of Alex's 15 messages ended
  with the same "Does that match what you have for X?" frame. Fixing it now would
  mix with the frame's own effect. Measured from issue 01 onward; opened as work
  only if it recurs.
- **Loosening the restated-trait bound to fire only on a message with no new
  information.** Issue 17 of the repair records two wrong fixes at this exact
  spot. Issues 18 and 20 changed the input it was reacting to; whether it still
  bites is a question for issue 01's sessions.
