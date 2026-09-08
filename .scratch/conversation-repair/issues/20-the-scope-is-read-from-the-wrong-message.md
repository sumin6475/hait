# 20: The scope is read from the wrong message

**What to build:** When Alex answers a request made three turns ago, the request
that governs how much it may say is *that* request — not whatever the last human
happened to type.

**Blocked by:** None.

**Status:** ready-for-agent

## The defect, as observed

**T-C1-021, eight turns.** seq 34 asked "What misses do others have for
Candidate C?" — a `direct_question`, `required`, so it stays open until answered.
Alex tried to answer it on seq 35, 36, 39, 40, 41 and 45, and every one of those
turns was dropped by the reveal budget.

The budget is decided by `withRouteRevealBudget(guard, routeKind,
requestIntentKind)`, and it applies **only when the turn carries no request**.
`requestIntent` is derived from the *anchor* message — the human message that
triggered this turn. On seq 45 the anchor was "Sure! Let's exit and make a
decision", which asks nothing, so the budget applied. Alex was answering seq 34.

The wiring for this already exists and is not the problem:
`selectedOpportunity.requestIntent` overrides the anchor's reading, and
`widenRequestIntent` lets a stronger lexical reading widen an Observer
under-read. Both fire. Neither helps, because:

- the opportunity's stored intent came from the **Observer**, which classified
  seq 34 as `kind: "none"` (confirmed in the ledger export), and
- the lexical reading that could widen it is computed from
  `requestBundleForAnchor(window, input.anchorSeq)` — the anchor's text. Nothing
  ever re-reads the *opportunity's own source message*.

So the one message that states what Alex was asked for is the only one no reader
consults.

## Why this is worth fixing rather than guarding around

Issue 18 fixed the lexical classifier, and that closes seq 34 and seq 37 — the
turns where the anchor **is** the request. It cannot close the other eight,
because on those the anchor genuinely asks nothing.

This is the first move in the method note's order: fix the input the guard is
reacting to. The guard is behaving correctly on the information it was given.

## The change

When a selected opportunity is being answered, widen its stored intent against
the lexical reading of **its own source message** (`opportunitySourceSeq`, which
the opportunity already carries and which is in the window), not only the
anchor's.

The existing widening rules are unchanged and already narrow: only `none`,
`scoped_information_request` and `new_information_request` may be widened, and
only `complete_single_candidate` / `complete_all_candidates` may widen them,
both gated on the request being directed at Alex.

## What must not regress

- **[D6] holds.** A procedural proposal still widens nothing, from either message
- The anchor's own reading still governs when no opportunity is selected
- Widening stays one-directional: a lexical reading may widen an Observer
  under-read, never narrow a reading the Observer made on another axis
- No new model call; both readings are lexical
- An opportunity whose source message has left the window is not guessed at

## Comments

### A verification gap this exposed, in issue 18

Issue 18's regressions call `buildRouteUserContext` with no
`requestIntentOverride`, so they exercise the lexical path only. The live path
for these turns goes through the opportunity's stored intent and then
`widenRequestIntent`. It happens to reach the same answer on seq 34 and 37, so
the fix is real — but it was asserted on the wrong path, which is the
predicate-tested / wiring-untested shape again. Whatever closes this ticket
should assert through the opportunity path.
