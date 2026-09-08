# 13: An unanswered request outranks a contribution Alex just felt like making

**What to build:** A request Alex was asked to answer gets answered. Today an
invited opportunity is selectable during exactly one turn; miss it and the
request is unreachable for the rest of its life while the ledger goes on
reporting it open.

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
| 18 | Judge ran, answered `contribute` with `selectedOpportunityId: null` |
| 21 | same, `follow` |
| 25 | same, `follow` |

Alex spoke three times with the request open and answered something else each
time. The comparison was never given.

### Correction: the Judge never saw it

This issue was first filed saying the Judge "had that opportunity in its
selectable list and chose a voluntary act each time". **That is wrong**, and the
correction sharpens the defect rather than softening it.

`conversationLedgerDecisionProjection` — the same filter that builds the Judge's
prompt and its validation — drops an **invited** opportunity whose
`evidenceSeqs` do not include the current trigger. `opp:17` carried
`evidenceSeqs: [17]`, so from seq 18 onward it was invisible. And on seq 17
itself the projection dropped it again, this time because cooldown was
unavailable and it had no bypass.

**It was never selectable on any turn.** Minted and structurally unreachable,
until the TTL retired it.

An invited opportunity is therefore answerable during exactly one turn. Miss that
turn for any reason and the request is gone, while `state.opportunities` goes on
reporting it open — which is what made the log read as though something were
still live.

## Two separate things went wrong

**A. The cooldown silenced an explicit request addressed to Alex.** *(Shipped —
see the comments.)*
`opportunityMayBypassCooldown` grants a bypass to `required` expectations and to
invited `uptake`s. This opportunity was `invitation` / `invited`, so it got
neither — and both of those labels came from the model: `speechAct: "proposal"`
made the kind an invitation, and `alexParticipation: "invited"` made the
expectation invited.

The deterministic facts all pointed the other way, and every one of them was
already in the same observation: the turn was explicit, it was addressed to Alex,
it replied to Alex's own question, and the floor named Alex next.

**B. An unanswered request stops being offered at all.** This is the larger half
and it holds even if A is left exactly as it is. A cooldown silence is allowed to
be silent. What is not allowed is for the obligation to become unreachable: from
the next turn on, the projection filters the request out entirely, so the Judge
is not choosing a voluntary act over it — the Judge is never shown it. Whether
the eventual fix keeps it selectable or ranks it above voluntary acts is open;
what it must stop is the request silently ceasing to exist.

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

- [x] An explicit request addressed to Alex is answered **on the turn** - half A,
      shipped
- [ ] ...or on the next one Alex takes - half B, still open
- [x] The T-C2-045 seq 17 turn is now offered to the Judge instead of vetoed
      before it runs
- [ ] The decision to prefer an open request over a voluntary act is made where
      the Judge can see it, not by rewriting its answer
- [x] Cooldown cadence and the human-floor veto are unchanged, with a regression
      for each
- [ ] An expired opportunity is not revived
- [ ] Say whether Alex's own stated next step is covered by this, and if not, why

**Status after half A: still open.** Half B is the general defect and is
untouched.

## Comments

### Half A, shipped

An opportunity minted from a turn that answers Alex's own question now carries
`answersAlexSeq`, and `opportunityMayBypassCooldown` grants it the same bypass an
invited `uptake` already had.

That bypass exists so Alex can receive the answer to its own question. seq 17
missed it for a structural reason with nothing to do with intent: the turn both
answered Alex **and** asked for something, so the request branch fired first and
minted an `invitation`. Right on `kind`, and it cost the bypass.

The bypass conditions are unchanged - foreground thread, evidence includes the
current trigger, no human floor held. This widens what may bypass, never how far.
An ordinary invitation still waits its turn, and the existing assertion that an
invited group request cannot bypass the cooldown fails if that stops being true.

### Half B, deliberately not attempted

The general defect is that **an invited opportunity is selectable for exactly one
turn**. Fixing it means changing the projection filter that the Judge's prompt,
its validation and `deterministicVetoBeforeJudge` are all built from - the one
place this repair has been most careful to keep single-sourced. The filter has a
documented reason (B4: stale invitations must not linger) and a TTL already
bounds how long one survives, so the shape of the fix is probably "selectable
while unanswered and within TTL" rather than "only on its own seq".

That is a design change to a load-bearing filter, and it deserves its own pass
rather than being appended to a narrow bypass fix. Half A resolves the observed
turn; half B is what stops the next one.

### Verification

Two breaks confirmed the assertions fail: removing the bypass, and granting it to
every invitation - the second trips a pre-existing assertion, which is the one
that says the cadence has not moved.

Build, all five suites and `docs:check` green. **Not measured live.**
