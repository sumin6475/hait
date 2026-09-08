# 17: A repair that cannot succeed still costs a call, then drops the turn

**What to build:** When a draft violates a limit the repair cannot satisfy, the
turn does not pay for a second generation to find that out.

**Blocked by:** None.

**Status:** done — the premise was wrong; see below for what shipped

## The defect, as filed

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
conflict, and it chose the request.

## Why the premise was wrong

**The conflict cannot arise on a turn the bound applies to.**

`maxRestatedTraitIds` is reachable from exactly one place,
`ROUTE_REVEAL_BUDGET`, and `withRouteRevealBudget` applies that budget **only
when `requestIntentKind === "none"`** — a turn where nobody asked Alex for
anything. Such a turn has nothing it is obliged to enumerate, so a request
demanding more traits than the cap allows is not a state it can be in.

T-C1-021 reached that state only because the request **misclassified as
`none`** — which is issue 18, and is fixed. The turn now reaches generation with
no trait cap at all:

```
intent = complete_single_candidate
scope guard = { candidate: "C", reason: "explicit_complete_request" }
generation guard = undefined
```

There is no unsatisfiable-repair mechanism left to build.

## Two wrong fixes, written before that was checked

Both are recorded because each looked like the root cause and neither was.

**1. Tolerate the overage after a failed repair.** A predicate that lifted the
restated cap, re-ran the checker, and shipped the message if nothing else
failed. This is a sanctioned exception layered on top of a bound that was
assumed wrong — the shape of edge-case patching, not of a fix.

**2. Retire the bound as redundant.** The argument was that restating discloses
nothing, so the cap is a proxy for verbosity while `maxSentences`/`maxWords` in
the same budget measure verbosity directly. It is refuted by the D2 regression
already in the suite: `d2Restated` is a **40-word, two-sentence, six-trait
recital** of one candidate's whole profile. Both length bounds pass it and gate
D2 was built to refuse it. Length does not catch a terse recital; the restated
cap is what does, and on a turn where nothing was asked that is exactly the
failure mode worth refusing.

## What shipped

**One evaluation, used by both drafts.** The initial draft and the repaired one
were evaluated by two hand-written copies of the same logic, and they had
already drifted: the repair pass checked metadata and scope but **not** the
question post-condition, so a clarification question could survive a repair it
was never re-tested against. That was a live defect in issue 19, introduced the
same day. `evaluateDraft` is now called twice.

**`owedRequestIds` on the generation path.** Ten of T-C1-021's silences came
through `recordGenerationFailure`, and none recorded what the group was still
waiting for — the largest silence class in the session, blank. `recordSilence`
had this already; the generation path is a different function and had nothing.
The caller supplies it, because the caller is the layer holding the ledger.

**A regression that pins the actual rule**, rather than a mechanism: the
T-C1-021 turn now reaches the model with no trait cap, and a turn that asked
nothing still carries `maxRestatedTraitIds: 2`.

- [x] The turn that lost eight generations no longer meets the bound at all
- [x] A no-request turn still may not recite the board, with a regression
- [x] The question post-condition is re-checked after a repair
- [x] A generation failure records the requests Alex owed

## What must not regress

- The board-recitation bound holds. T-C1-025 seq 7's recital and gate D2's terse
  one must both still be refused
- No new model call on the accept path
- `MAX_REPAIR_ATTEMPTS` stays a bound, not a target
- Silence stays attributable

## Comments

### Verification

Two breaks, one in each direction on the rule that turned out to matter: making
the budget apply to request turns again (the T-C1-021 shape returns), and
stopping it applying to no-request turns (the recital goes unbounded). Each
fails its own assertion. A third break — removing the question check from the
shared evaluator — is what shows the repair pass is now covered.

A fourth break appeared to pass and did not run: removing the
`requestIntentKind` guard left the parameter unused, the build failed, and the
suite never executed. A silent build failure reads exactly like a passing test
in a one-line grep. Check that the suite actually ran.

Build, all six `test:*` suites and `docs:check` green. **Not measured live.**
