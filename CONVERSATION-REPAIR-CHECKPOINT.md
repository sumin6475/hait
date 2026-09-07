# Conversation System Repair — Checkpoint

Branch: `claude/hait-conversation-system-errors-0f5e58`
Baseline: `5263f0f` (= `origin/main` at time of writing = production)
Snapshot commit: `362416b` — relocated prior uncommitted work off the `main` checkout.
Last updated: 2026-09-06

> Read this file first in a new session. It is the working contract for the
> Observer / Judge / Generator repair. It replaces re-deriving the diagnosis.
> Background architecture lives in `docs/tmp/HAIT-handoff-current.md` (gitignored,
> local only) and the `/private/tmp/hait-*` artifact set it indexes.

---

## 0. Branch and safety rules

- **`origin/main` is production and must never be touched.** Do not push. Do not
  merge into it. Local `main` stays at `5263f0f`.
- **Work in the ordinary checkout at the repo root**
  (`/Users/jadekim/Documents/Code HQ/HAIT`), on branch `main`, leaving the changes
  **uncommitted**. This is deliberate: the user wants every change since
  `origin/main` collected as one pending change set in one place, the way it was
  before the repair work started. Do not create commits there without being asked.
- The branch `claude/hait-conversation-system-errors-0f5e58` (worktree under
  `.claude/worktrees/`) is a **frozen backup**, not the workspace. It holds the
  same content as committed history, so any accidental loss in the root checkout
  can be recovered from it. Do not resume work there unless the user says so.
- Because the working tree sits on `main`, `git commit` in the root checkout would
  move the production branch. **Never `git add -A && git commit` there.**
- Never commit `.env`, credentials, tokens, or raw participant text.
- `docs/`, `MEMORY.md`, `ARCHITECTURE.md`, `eval-results/` are gitignored. A
  document that must survive across sessions belongs in a tracked path (this file).
- Do not start/stop/restart the local server (port 3001) unless the task needs it
  and the user authorizes it.

## 1. Goal state (what "fixed" means)

The four things being optimized, in the user's words:

1. **Speech volume** — Alex participates enough (target ~61% of eligible turns).
2. **Condition orthogonality** — C1/C3 Peer never mediates or performs
   task-standard correction; C2/C4 Leader retains mediation. XAI stays
   explanatory; ACI asks questions. No condition's weighting leaks into another.
3. **Context is read and the state is updated correctly** — the ledger reflects
   what actually happened.
4. **The reply matches the context that was read** — including natural uptake
   (a light acknowledging opener), answering questions that were asked, and not
   restating information already on the table.

Quality bars that must hold throughout: natural uptake on ordinary turns;
per-condition speech style preserved; no single condition's weighting dominating.

## 2. Evidence base

Diagnostic artifact: session export `T-C2-034` (C2 Leader, 28 messages,
18 intervention decisions). Treat it as a symptom sample, not a spec. Do not copy
raw participant text into any document.

Baseline measured from that session:

| Metric | Baseline |
| --- | --- |
| Intervention decisions | 18 |
| `speak` | 10 (56%) |
| `stay_silent` | 8 |
| Silences with a structural (non-semantic) cause | 5 — turnIndex 13, 16, 22, 25, 26 |
| Judge first-attempt contract violations | 6 / 18 (33%) |
| Turns routed onto an already-terminal opportunity id | 9 / 18 |
| Alex messages opening with a notes/source phrase | 6 / 9 generated |
| `focusCandidate === null` at decision time | 15 / 18 |

If the 5 structural silences were recovered, speech rate would be 10/18 → 15/18 (83%).

## 3. Confirmed root causes

All line numbers are on this branch at `362416b`.

### A. Opportunity id is keyed to the thread root, so the session can only ever hold one

`server/src/lib/conversationLedger.ts:385` — the final branch of the opportunity
derivation cascade sets `opportunitySourceSeq = observedThread.rootSeq`. The id is
`opp:{opportunitySourceSeq}:{kind}:{targets}`, and `rootSeq` is constant for the
session, so this branch can only ever produce `opp:1:group_request:alex` — which
was already `consumed_by_alex` at turnIndex 3. Nine of eighteen turns routed onto
that dead id.

**Attribution correction (2026-09-06, after re-reading the run).** That dead id
did not cause any silence in this session. It was selected once, at turn 3.
Turns 9 and 23 spoke through the *voluntary* path (`relevant_unsurfaced_information`,
`routeReason: ledger_voluntary_act`) while ignoring it; turns 7, 17, 25 and 26
never attempted to select it; turn 16 selected a different terminal id leaked by
defect B. The damage from this branch is a terminal record that absorbs evidence
forever plus an observer that never learns the id is closed — a correctness and
auditability defect, not the speech-volume defect. **The keying itself is left
unchanged** (see Gate 1 below for why); Gate 1's terminal-merge guard makes the
deadness visible in `transition.rejected` so the decision can be made on data.

`server/src/lib/conversationLedger.ts:610` — the reducer's merge branch attaches
evidence to an existing opportunity **without checking status**, so terminal
opportunities keep accumulating `evidenceSeqs` forever (`opp:1` grew to
`[1,2,3,5,7,9,16,17,23,25,26]`). `describeConversationLedger` only shows *open*
opportunities to the Observer, so the Observer never learns the id is dead and
re-proposes it every turn.

The cascade dispatches on `observation.addressees` only. At seq 16 the Observer
returned `addressees: []` together with `alexRelation: "explicit_addressee"` — an
internal contradiction the normalizer does not catch (the prompt states the
addressees→relation rule in one direction only). A correctly-parsed explicit
request (`requestExplicitness: "explicit"`, `requestIntent: compare_request`) fell
through to the dead-id branch and was never answered.

**The Observer read that turn correctly. The id rule discarded it.**

### B. The Judge retry loop converges on silence

`server/src/lib/interventionJudge.ts:387` — `maxAttempts: 2`. The retry prompt
reports the violated rule codes and asks for a correction. The cheapest
always-valid output is `silent`, so the model capitulates rather than choosing a
valid alternative. turnIndex 22, 25, 26 all show `attempt1 speak → rejected →
attempt2 silent → accepted`, and are recorded as `evidence: "no_useful_move"`,
indistinguishable from genuine semantic silence. This violates the standing
invariant that generation failure must not be conflated with semantic silence.

`server/src/lib/interventionJudge.ts:595,616` — the decision projection filter only
removes *open invited* opportunities lacking current-trigger evidence. Terminal
opportunities survive into `JSON.stringify(decisionState)` in the user prompt,
while the prose summary above it lists only open ones. The model selects ids from
the JSON. The two projections must agree.

### C. No focus candidate means nothing to say

`server/src/lib/interventionEngine.ts:1713` — `eligibleTraitIdsForState` returns
`[]` whenever `thread.focusCandidate` is null. `relevant_unsurfaced_information`
is the only voluntary path that carries a new fact, and the only `speak` path
allowed in degraded mode. With focus null on 15/18 turns, the judge was handed an
empty candidate set and returned `no_useful_move`. Comparison phases (A vs B) are
exactly when focus is legitimately null and exactly when Alex is most useful.

### D. A regex pre-empt swallows the context

`server/src/lib/interventionEngine.ts:1686` — when `taskGroundingSignal()` matches,
the turn bypasses Observer, ledger, and Judge entirely and broadcasts a
hard-coded string. For C2 (non-C4 leader) that string is a single fixed sentence
with no question and no reference to what was just said
(`server/src/lib/routeContext.ts:94`). At seq 5 the participant made two moves —
a weighting claim and a candidate elimination — and Alex answered only the
weighting claim, ignoring the elimination. C4 has a question-form variant; C2 has
none, so a C2 leader cannot use this route to steer the group to the next candidate.

### E. Natural uptake is forbidden by the prompt contract

`server/src/prompts/route-prompts.source.json`:

- `common.unifiedInteractionPolicy`: *"On address and followup turns, begin with
  the substantive answer … do not open with an acknowledgment, transition, or
  source phrase."* — address and followup are Alex's two most common speaking routes.
- `common.outputDiscipline`: *"Refer to information you hold only as 'my notes' or
  'what I've got.'"* plus a 2-sentence / 40-word cap.

The combination forces the "notes recital" register observed in 6 of 9 generated
messages. The desired light opener is not a model capability gap — it is written
as a prohibition.

Repetition suppression is also too narrow: `server/src/lib/routeContext.ts:1555`
adds an anti-repeat instruction only for address/followup and only about repeated
*questions/options*, not about facts already stated. A candidate's full trait set
was re-broadcast 24 messages after its first broadcast, after a participant had
explicitly complained about repetition.

### F. Extractor miscounting is unobservable, and the agreed design is unwired

`server/src/lib/poolingExtractor.ts`:
- `catch { return [] }` makes timeout / network / parse failure indistinguishable
  from "this message contained no traits".
- `mention.confidence < 0.8` is a hard threshold on an uncalibrated self-reported
  number from `gpt-4o-mini`.
- A duplicate evidence quote causes **both** mentions to be dropped rather than
  deduplicated, so one sentence asserting two traits loses both.
- The 8s timeout blocks the routing path.

`server/src/sockets/index.ts:307` — the turn trace is emitted only `if (ids.length)`.
**False negatives leave no record at all**, so miscounting cannot currently be
measured from logs.

`server/src/eval/trait_keyword_registry.draft.yaml` holds the agreed design
(deterministic closed-pool matching first, bounded LLM verification only where
lexical evidence exists) for all 40 trait ids, with `runtime_enabled: false`. The
runtime is still the pipeline that was already diagnosed as defective.

## 4. Repair gates

Work top-down. Each gate is a separate commit with its regression test. **Do not
start a later gate before the earlier one's tests pass**, because the later
symptoms are downstream of the earlier causes — the generation layer is currently
being blamed for receiving empty inputs.

### Gate 1 — Opportunity identity — DONE (`ebd697d`)

Shipped three changes, ordered by evidenced impact:

1. `interventionJudge.ts` — extracted `conversationLedgerDecisionProjection(state)`,
   an exported pure function returning exactly the selectable opportunities
   (open + deferred, minus stale invited). Both the prose summary and the
   serialized `Exact structured decision ledger` are now built from it, so they
   can never disagree again. This was implicated in 4 of the 5 structural
   silences (turns 16, 22, 25, 26).
2. `conversationLedger.ts` — the derivation cascade now treats
   `alexRelation === "explicit_addressee"` as addressing Alex even when
   `addressees` is empty, still gated on `requestsAction`. Recorded as repair
   code `alex_addressee_taken_from_explicit_relation` so over-firing stays
   measurable. This was the sole cause of the dropped explicit request at turn 16.
3. `conversationLedger.ts` — the reducer rejects evidence merges into an
   opportunity in a terminal status (`opportunity:<id>:already_terminal`)
   instead of growing a closed record.

**Deliberately not changed:** the inferred thread-continuation branch still keys
its id to the thread root. Re-keying it per Alex generation would widen Alex's
entitlement to an invited opportunity that `opportunityMayBypassCooldown` still
refuses, producing more `selected_opportunity_requires_cooldown` rejections and,
through the same retry path as change 1, *more* capitulated silence. There is no
evidence in the observed run that the dead id cost any speech. Change 3 now
surfaces it in the audit; revisit with measurements after Gates 2–3.

Regression coverage added to `server/src/scripts/test-conversation-ledger.ts`,
reproducing all three shapes from the observed run. Each new assertion was
verified to fail with its own fix reverted, so none of them is vacuous.

Verified: `build`, `test:conversation-ledger`, `test:conversation-recovery`,
`test:intervention-v2` all pass; `git diff --check` clean.

Still open from the original Gate 1 exit check: replaying `T-C2-034` end to end
to confirm turn 16 now produces a `speak`. That needs a live model run, which is
the user's call.

### Gate 2 — Separate the real reason for silence — DONE (uncommitted)

Two category errors, both of which turned bookkeeping outcomes into silence.

1. **Redundant rejections no longer degrade the controller.**
   `conversationLedger.ts` set `degradedMode = ... || transition.rejected.length > 0`,
   so *any* rejection put the controller into degraded mode, which forbids all
   inferred speech. In T-C2-034 the only degraded turn (13) was produced by a
   single idempotent no-op: the observer proposed closing an opportunity that was
   already closed. The observer is shown only open opportunities, so it
   re-proposes finished ones as a matter of course. Rejections are now split by
   `isRedundantRejection(code)` — the two `:already_terminal` codes are no-ops,
   everything else is material — and only material ones reach `conflictCodes`
   and `degradedMode`. Redundant ones stay in `transition.rejected`, which is
   persisted, so nothing becomes invisible.

   **This also repaired a regression Gate 1 introduced.** Gate 1's terminal-merge
   guard emits `opportunity:<id>:already_terminal` every time the inferred branch
   re-proposes its session-constant id — eight turns in T-C2-034 — each of which
   would have degraded the controller under the old rule.

2. **Capitulated silence is labelled separately.**
   `judgeCapitulatedToSilence(decision, attempts)` and
   `judgeCapitulationRuleCodes(attempts)` in `interventionJudge.ts` detect the
   shape where the Judge asked to speak, deterministic validation rejected it,
   and the retry answered `silent` — the one output that always validates.
   `interventionEngine.ts` now records those as
   `ledger_judge_capitulated_after_rejection:<rule codes>` instead of
   `ledger_judge_silent`. `silenceReason` is a free-form String field, so no
   schema migration is needed. T-C2-034 turns 22, 25 and 26 are this shape.

   `judgeEvidence` is deliberately left as the model reported it
   (`no_useful_move`): it records what the Judge claimed, and rewriting it would
   falsify the record. The distinction lives in `silenceReason`.

**Deliberately not done: item 6, forbidding `silent` on the retry.** Re-reading
the run, the correction is not obviously "speak". At turns 22/25/26 there was no
selectable opportunity and no eligible trait, so the only valid speak was
`contribute` + `conversation_grounded_synthesis`; whether that was worth saying
is a judgement the log cannot settle. Forbidding `silent` would convert an
honest capitulation into an invalid speak, two failed attempts and a
`ledger_judge_failure` — a worse record, not more speech. Gate 1 also removed
terminal ids from the prompt, which is what attempt 1 kept selecting, so the
trigger may already be much rarer. Measure first, using the new label.

Regressions in `test-conversation-ledger.ts`: a redundant rejection does not
degrade while a material one still does; capitulation is distinguished from a
first-attempt silence, from a retry that recovers a valid speak, and from a
malformed silence corrected into a clean one. Each was verified to fail with its
own fix reverted.

Verified: `build`, `test:conversation-ledger`, `test:conversation-recovery`,
`test:intervention-v2` all pass (checked with real exit codes, not a piped
`$?`); `git diff --check` clean.

### Gate 3 — Supply something to say

7. `interventionEngine.ts:1713` — when `focusCandidate` is null, return unsurfaced
   `ALEX_Z_IDS` across the thread's `scopeCandidates` instead of `[]`. The Judge is
   already contracted to select exactly one. Keep focus as a **ranking hint**, never
   as a gate.

Regression: a comparison-phase turn with `focusCandidate: null` and a non-empty
`scopeCandidates` yields a non-empty eligible set.

Exit check: `no_useful_move` silences fall relative to the Section 2 baseline.

### Gate 4 — Speech quality (prompt layer; only after 1–3)

8. Rewrite the address/followup opener rule to preserve its real intent (do not
   let a condition performance replace the answer) while permitting uptake:
   *take up the previous turn briefly, then go straight to the substantive answer;
   the uptake must not exceed one clause and must vary across turns.*
9. Relax the "my notes" rule: the goal is source concealment, not a mandatory
   opener. Forbid a source phrase in the first sentence.
10. Replace the natural-language anti-repeat instruction with **deterministic
    context**: inject `revealStats.aiSurfacedIds` for the relevant candidate as
    "already stated by you", and forbid restatement outside an explicit full-list
    request.
11. Stop the C2 task-grounding regex from discarding the Observer snapshot. Pass
    the equal-weight correction as a required generation-context block so the
    reply also answers the substantive move in the same message. Add a C2
    counterpart to C4's question-form variant.

Regression: condition-orthogonality assertions in
`server/src/scripts/test-intervention-v2.ts:1317` must continue to pass — C1/C3
Peer must not gain mediation or task-standard correction from any of these edits.

### Gate 5 — Extractor

12. **Observability first.** Always emit a turn trace, including on empty results:
    outcome (`ok` / `timeout` / `parse_fail`), mention count, accepted count, and
    per-rejection rule codes. Nothing downstream is measurable until this exists.
13. Separate failure from absence in the `catch`; represent timeout as an explicit
    unknown rather than an empty result.
14. Deduplicate repeated evidence quotes instead of dropping both mentions.
15. Only then wire `trait_keyword_registry.draft.yaml` into the runtime.
    **This step requires the user's explicit manual approval of the draft — an
    agent must not enable `runtime_enabled` on its own.**

## 5. How to verify

From `server/` in the root checkout (it already has `node_modules` and a real
`.env`):

```sh
npm run build --silent
npm run test:intervention-v2
npm run test:conversation-ledger
npm run test:conversation-recovery
```

`tsx` tests may hit a managed-sandbox IPC `EPERM`; rerun with the local IPC
permission granted. Run `git diff --check` before finishing a change.

Capture exit codes directly — `npm run build --silent | tail -5; echo $?` reports
`tail`'s status, not the build's. Redirect to a file and test `$?` instead.

Note: `tsx` does not typecheck, so a test can pass under `test:conversation-ledger`
while `npm run build` fails. Always run `build` as well — `test:intervention-v2`
depends on it.

Live smoke runs are the user's call (they own the server on port 3001). Per-gate
exit checks above should be measured against the Section 2 baseline table.

## 6. Method note

Existing tests in this repository were written alongside the defects they cover.
`test-conversation-ledger.ts` asserts "standing opportunity identity is unique
per thread origin" — that is the very property that lets one consumed id kill a
derivation branch for a whole session. **Do not treat an existing assertion as
evidence of intended design.** Re-derive intent from the code and the observed
run, and when a fix requires changing a test, say so explicitly rather than
bending the fix to fit.

Equally, do not let a plausible causal story outrun the data. The first version
of Section 3.A claimed nine turns of speech loss from a dead opportunity id; the
run shows it cost none. Check attribution against the record before ranking a
repair.

## 7. Invariants that must not regress

- Observer supplies current-turn evidence; a deterministic reducer owns threads,
  opportunities, and floor state.
- The Judge is condition-blind. Condition-specific behavior belongs at final
  generation, with the single exception that Leader-only mediation stays gated to
  C2/C4.
- Successful broadcast is the only `consumed_by_alex` transition. Generation
  failure, cancellation, floor blocking, and supersession must not consume one.
- Human floor, cooldown, lifecycle, supersession, and generation failure must
  never be conflated with semantic silence.
- Opportunities are candidates, not automatic speech entitlements.
- Multiple answers to one Alex question form one response cluster, not independent
  per-message entitlements.
- Do not apply a prompt-contract fix alone if it would make every previously
  rejected invited opportunity speak immediately.
- Shadow mode must not alter live routing, cadence, timing, or reservations.

## 8. Progress log

Append one line per completed gate: date, gate, commit, tests run, measured effect.

- 2026-09-06 — Gate 0 (branch relocation + this checkpoint). Commit `362416b`
  snapshot; work moved off the production `main` checkout. No behavioral change.
- 2026-09-06 — Gate 1 complete. Commit `ebd697d`. Judge decision projection,
  addressee/relation dispatch, terminal-merge guard, plus three verified-failing
  regressions. build + ledger + recovery + intervention-v2 green. Attribution for
  root cause A corrected downward: the dead standing id cost no speech in the
  observed run, so its keying was left unchanged and instrumented instead.
  Live-replay exit check for turn 16 not yet run (needs a model run).
- 2026-09-06 — Working location moved back to the root checkout at the user's
  request; all Gate 0+1 content now lives there as uncommitted changes on top of
  `origin/main`. The repair branch is retained as a frozen backup at `ba582c3`.
- 2026-09-06 — Gate 2 complete (uncommitted in the root checkout; backed up on
  the repair branch). Redundant vs material rejections split so idempotent
  no-ops stop degrading the controller — this also repaired a regression Gate 1
  had introduced — and capitulated silence given its own `silenceReason`.
  Retry-forbids-silent deliberately deferred pending measurement. build + ledger
  + recovery + intervention-v2 green.
