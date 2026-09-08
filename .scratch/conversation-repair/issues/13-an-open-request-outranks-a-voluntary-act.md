# 13: An unanswered request outranks a contribution Alex just felt like making

**What to build:** A request Alex was asked to answer gets answered. Today
cooldown can silence it, and once silenced nothing brings Alex back to it — three
later turns spoke, and all three chose something else.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## The defect, as observed

**T-C2-045 seq 16–25.** Alex offered a choice at seq 16. A participant answered
it at seq 17: give us the concise comparison.

The Observer read that turn correctly — `addressees: ["alex"]`,
`alexRelation: explicit_addressee`, `requestExplicitness: explicit`,
`relationToPendingAlexQuestion: related_addition`, `floor.expectedNext: ["alex"]`,
confidence 0.9 — and the ledger minted an opportunity for it.

Then:

| seq | what happened |
| --- | --- |
| 17 | cooldown veto, Judge skipped, opportunity left open |
| 18 | Judge ran with that opportunity selectable, answered `contribute` with `selectedOpportunityId: null` |
| 21 | same, `follow`, `selectedOpportunityId: null` |
| 25 | same, `follow`, `selectedOpportunityId: null` |

Alex spoke three times with the request open in front of it and answered
something else each time. The comparison was never given.

## Two separate things went wrong

**A. The cooldown silenced an explicit request addressed to Alex.**
`opportunityMayBypassCooldown` grants a bypass to `required` expectations and to
invited `uptake`s. This opportunity was `invitation` / `invited`, so it got
neither — and both of those labels came from the model: `speechAct: "proposal"`
made the kind an invitation, and `alexParticipation: "invited"` made the
expectation invited.

The deterministic facts all pointed the other way, and every one of them was
already in the same observation: the turn was explicit, it was addressed to Alex,
it replied to Alex's own question, and the floor named Alex next.

**B. Nothing ranks an open request above a voluntary act.** This is the larger
half, and it holds even if A is left exactly as it is. A cooldown silence is
allowed to be silent. What is not allowed is for the obligation to evaporate: on
the next turn Alex takes, an open request it was asked to answer should outrank
`contribute` and `follow`. The Judge is offered both and told to pick; nothing
tells it that one of them is owed.

Alex also made a commitment of its own at seq 22 — "I will present my notes on
D" — and never did. That is the same shape from the other direction, and whatever
fixes B should say whether it covers this too.

## Why this is not issue 12

Issue 12 is the Observer failing to see that a reply answers Alex. **Here it saw
everything correctly and the turn was still lost**, one layer further down. The
two issues are the same story at different depths, and fixing 12 would not have
helped this session at all. Neither blocks the other.

## What must not regress

- **The cooldown still governs.** Whatever bypass A gains must be narrow enough
  that Alex does not answer on consecutive turns as a matter of course; the
  cadence invariant is unchanged
- **A held human floor still vetoes.** An owed answer is not a reason to take a
  floor another human holds
- **Opportunities still expire.** B must not resurrect a request the TTL has
  already retired, or Alex will answer something the group moved past
- Silence stays attributable, and a turn silenced by cooldown while a request is
  open should say that both were true
- The Judge is not overruled after the fact. If an open request is to outrank a
  voluntary act, the Judge must be told so before it decides, not corrected
  afterwards

- [ ] An explicit request addressed to Alex is answered, on the turn or on the
      next one Alex takes
- [ ] The T-C2-045 seq 16–25 shape resolves with the comparison given
- [ ] The decision to prefer an open request over a voluntary act is made where
      the Judge can see it, not by rewriting its answer
- [ ] Cooldown cadence and the human-floor veto are unchanged, with a regression
      for each
- [ ] An expired opportunity is not revived
- [ ] Say whether Alex's own stated next step is covered by this, and if not, why
