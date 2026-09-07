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

- **`main` is production.** Local `main` and `origin/main` must stay at `5263f0f`
  until the user explicitly authorizes a merge or push. Never push this branch to
  `origin/main`. Never `git switch main` and commit.
- All work happens on `claude/hait-conversation-system-errors-0f5e58`, in the
  worktree at `.claude/worktrees/hait-conversation-system-errors-0f5e58`.
- The original checkout at the repo root still holds an identical dirty working
  tree (49 files). It is the user's copy; **do not reset, clean, or edit it.**
  Everything in it is already captured in commit `362416b`. If the user later
  confirms, it can be discarded — that is their call, not the agent's.
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

### Gate 1 — Opportunity identity (largest speech-volume recovery)

1. `conversationLedger.ts:385` — derive `opportunitySourceSeq` from the current
   trigger seq, not `observedThread.rootSeq`, so each turn can open a distinct id.
2. `conversationLedger.ts:610` — reject evidence merges into an opportunity whose
   status is in `TERMINAL_OPPORTUNITY_STATUSES`; open a new opportunity instead.
3. Make the derivation cascade treat `alexRelation === "explicit_addressee"` as
   satisfying the first branch, not only a non-empty `addressees` array.
4. `interventionJudge.ts:595` — narrow the decision projection to
   `status === "open" || status === "deferred"` so the JSON and the prose summary
   agree on what is selectable.

Regression (`test-conversation-ledger`, `test-conversation-recovery`):
- one session's thread-continuation branch produces N distinct opportunity ids
  across N turns;
- an evidence merge into a terminal opportunity is rejected;
- an explicit request with `addressees: []` and
  `alexRelation: "explicit_addressee"` opens a `direct_question`;
- the judge prompt never contains a terminal opportunity id.

Exit check: replay `T-C2-034`; the seq 16 request must produce a `speak`.

### Gate 2 — Separate the real reason for silence

5. Forbid `silent` in the Judge's retry turn (require a corrected version of the
   rejected decision), **or** record capitulation distinctly, e.g.
   `silenceReason: "judge_capitulated_after_rejection"`, never as
   `no_useful_move`. Without this separation, speech-volume loss can never be
   attributed correctly in evaluation.
6. Only after that separation exists, consider raising `maxAttempts` from 2.
   Raising it first would add another capitulation, not another repair.

Regression: a decision rejected on attempt 1 that ends silent is recorded with
the capitulation reason, and `no_useful_move` appears only when attempt 1 itself
chose silence.

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

From `server/` in this worktree (`npm install` first — the worktree has no
`node_modules` yet):

```sh
npm run build --silent
npm run test:intervention-v2
npm run test:conversation-ledger
npm run test:conversation-recovery
```

`tsx` tests may hit a managed-sandbox IPC `EPERM`; rerun with the local IPC
permission granted. Run `git diff --check` before every commit.

Live smoke runs are the user's call (they own the server on port 3001). Per-gate
exit checks above should be measured against the Section 2 baseline table.

## 6. Invariants that must not regress

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

## 7. Progress log

Append one line per completed gate: date, gate, commit, tests run, measured effect.

- 2026-09-06 — Gate 0 (branch relocation + this checkpoint). Commit `362416b`
  snapshot; work moved off the production `main` checkout. No behavioral change.
