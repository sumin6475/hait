# 13: An unanswered request outranks a contribution Alex just felt like making

**What to build:** A request Alex was asked to answer gets answered. Today an
invited opportunity is selectable during exactly one turn; miss it and the
request is unreachable for the rest of its life while the ledger goes on
reporting it open.

**Blocked by:** None (can start immediately).

**Status:** done

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
- [x] ...or on the next one Alex takes - half B
- [x] The T-C2-045 seq 17 turn is now offered to the Judge instead of vetoed
      before it runs
- [x] The decision to prefer an open request over a voluntary act is made where
      the Judge can see it, not by rewriting its answer
- [x] Cooldown cadence and the human-floor veto are unchanged, with a regression
      for each
- [x] An expired opportunity is not revived
- [x] Say whether Alex's own stated next step is covered by this, and if not, why
      - it is not; see the comment below and issue 16

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

### Half B, shipped: the rule split in two

The previous pass deferred this and guessed the shape would be "selectable while
unanswered and within TTL". That was right about the bound and wrong about the
population. The filter was not one rule being too strict - it was **two
different objects sharing one rule**, and only one of them is momentary.

An **uptake** is not a request. Nobody asked; it is minted because a human just
replied to Alex, and it licenses Alex to carry that reply one step further. The
licence is the reply being fresh, so for an uptake the current-trigger
requirement is not staleness bookkeeping, it is the whole meaning of the
opportunity. It stays, unchanged.

An **invitation** or **group_request** is somebody asking Alex for something,
and an obligation does not stop existing because the next message was somebody
else's. Those now stay selectable while open.

What bounds them instead is the reducer, which already had three retirement
paths and needed no fourth: the thread closes, Alex answers on the thread and
supersedes the older ones, or the [B4] TTL expires it eight seqs on. All three
are seq arithmetic that was already running every turn.

The predicate is now one exported function, `opportunityStillStands`. It had
been written out twice - once in the projection, once in the validator - which
is the duplication that lets a prompt offer a choice its own validator rejects.
See `docs/adr/0006-a-request-outlives-its-turn.md`.

### The cadence did not move, and that is not incidental

`opportunityMayBypassCooldown` still requires current-trigger evidence, and half
B did not touch it. So an older request never speaks *through* the cooldown: it
becomes an option only on a turn where Alex could already have spoken
voluntarily. `deterministicVetoBeforeJudge` returns exactly what it returned
before, on every input.

That containment is what makes this safe against the checkpoint's standing
warning - that a prompt-contract fix must not make every previously rejected
invited opportunity speak immediately. The bulk of those rejections were
uptakes, which are unchanged; the rest gain a turn they could already speak on,
not a turn they could not.

### The ranking is told, not enforced

The issue required that preferring an open request over a voluntary act be
decided where the Judge can see it. Two ways were available and only one is
compatible with the rest of this repair.

A validation rule rejecting a voluntary act while a request is open would be a
correction after the fact, and the retry's cheapest always-valid output is
`silent` - the same trade that produced `judgeCapitulatedToSilence` and forced
`canonicalizeConversationLedgerJudgeDecision` into existence. A ranking enforced
that way buys silences, not answers.

So it is a fact in the prompt instead. Every turn now lists
`Unanswered requests addressed to Alex, oldest first`, beside the selectable
ids, built by `unansweredRequestsForAlex` from the same projection - it can
never name an id the turn does not offer. The system prompt says a listed
unanswered request outranks a voluntary act and that the oldest goes first.
Nothing rewrites the Judge's answer.

### Alex's own commitment is not covered

Alex said at seq 22 that it would present its notes on D, and never did. Half B
does not reach that and cannot be extended to.

Every opportunity is minted from a **human** source message - the reducer
rejects any proposal whose `sourceRole` is not on the human roster, and every
branch in `observerDeltaFromTurn` is built off the human turn being observed. An
Alex commitment creates no ledger object at all, so there is nothing for a
selectability rule to keep alive. What Alex owes the group is a different object
with a different lifecycle and a different way of being discharged, and it
touches what Alex says rather than when. Filed as issue 16.

### Verification

Half A: two breaks confirmed the assertions fail - removing the bypass, and
granting it to every invitation. The second trips a pre-existing assertion,
which is the one that says the cadence has not moved.

Half B: six more. Restoring the old rule for every invited expectation; dropping
the rule for uptakes too; disabling the TTL; listing requests newest first;
counting an uptake as an owed request; and removing the owed-request line from
the prompt. Each fails its own assertion and no other's.

A seventh candidate assertion was written and then removed rather than kept: a
`doesNotMatch` on the prompt text saying an uptake is not listed as owed. No
single change could make it fail while the assertion above it still passed, so
it was a guard over a predicate that was already covered - the shape this repair
has been calling a vacuous guard.

The Judge prompt version is now `conversation-ledger-judge-prompt-v8`.

Build, all six suites and `docs:check` green. **Not measured live** - and the
one thing worth watching in the next session is whether Alex now answers a
carried-over request on a turn it would previously have spent on a voluntary
contribution.
