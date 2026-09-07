# Conversation System Repair — Checkpoint

Branch: `claude/hait-conversation-system-errors-0f5e58`
Baseline: `5263f0f` (= `origin/main` at time of writing = production)
Snapshot commit: `362416b` — relocated prior uncommitted work off the `main` checkout.
Last updated: 2026-09-07 — after T-C1-027; B1 rolled back, D2 + decline + label reservation done

> **This file is the single source of truth for this work.** Read it first in a
> new session; it replaces re-deriving the diagnosis. Status is maintained here,
> not anywhere else — an earlier published web snapshot of the first plan
> (`claude.ai/code/artifact/fa28d004-…`) is **superseded and safe to delete**;
> it stops at the first plan and knows nothing of the four measurement rounds.
> Background architecture lives in `docs/tmp/HAIT-handoff-current.md` (gitignored,
> local only) and the `/private/tmp/hait-*` artifact set it indexes.

---

## Current state — read this first

**Where the work is.** Five live measurement rounds have been run against the
repair. Gate A is done and confirmed: T-C1-024 measured A7's tail at 0.2–1.5 s
against the 2.5–3.5 s it replaced, and superseded turns at 11% against a 39%
baseline. **The Observer is now the whole of the remaining latency** — 66% of
mean turn time, 49–86% per turn — which is Gate B. Speech *quality* is the open
front: Alex is no longer too long, it is too often empty or repetitive, and
every Alex message in T-C1-024 carried a defect.

**Where the code is.** Uncommitted in the root checkout
(`/Users/jadekim/Documents/Code HQ/HAIT`, branch `main`, never commit there).
Mirrored as commits on `claude/hait-conversation-system-errors-0f5e58` for
backup only. Confirmed 2026-09-07: every tracked file modified in the root
checkout is byte-identical to the backup branch HEAD, so the mirror is faithful
and either location can be recovered from the other.

| Item | State | Where |
| --- | --- | --- |
| Gate 1 · opportunity identity | **DONE** | §4 |
| Gate 2 · real reason for silence | **DONE** | §4 |
| Gate 3 · supply something to say | **DONE** | §4 |
| Gate 3R · T-C2-037 repairs | **DONE** | §4 |
| A1–A4 · burst coalescing, cancellation, cache order | **DONE** | §4c |
| A5 · `floorMs` | **not needed** — A6 buys the same 2 s free | §4c |
| A6 · overlap floor with generation | **DONE**, confirmed live in T-C1-023 | §4c |
| A7 · model call off the broadcast path | **DONE**, confirmed live in T-C1-024 | §4e, §4f |
| B9 · one "addresses Alex" predicate | **DONE**, still unverified live (§4f) | Gate B table |
| D6 · deterministic template under the output contract | **DONE** | Gate D table, §4f |
| B4 · opportunity lifetime | **DONE** | Gate B table |
| B1 · Observer output schema | **ROLLED BACK** — it destabilized `alexRelevance` | §4i |
| B8 · bound the Observer review path | **DONE**, confirmed live (review rate 10% → 2%) | Gate B table, §4i |
| D2 · silent guard bypass | **DONE** — without it D3/D4 never fired | Gate D table, §4i |
| D3/D4 · per-turn reveal budget | **DONE**, enforcing only since D2 | Gate D table, §4i |
| Honest decline (table / collation) | **DONE** | §4j |
| Candidate-label reservation | **DONE** | §4j |
| B2, B3, B6, B7 · Observer accuracy | OPEN — **no latency benefit expected** | Gate B table, §4g |
| Observer overlap | **DESIGNED, awaiting a decision** | §4h |
| Gate C · Judge role goals | **BLOCKED on the user** (§ Open decisions) | Gate C |
| Gate D · D1–D5 generator length, emptiness, anti-repeat | OPEN | Gate D |

**Do next, in this order.**

1. **Run a live session.** Four things have never been observed live: the
   rolled-back Observer (`alexRelevance` should vary again, and 32 self-
   contradictory observations should not recur), D2 (repair exhaustion should
   stay rare — it fails closed, costing the turn), and the decline and
   label-reservation blocks.
2. **Fix the scope the decline refuses from** (§4j, "not done"). The Observer
   classified all four table turns `new_information_request` while the lexical
   classifier read the first as `complete_all_candidates`; with an opportunity
   selected, `routeContext.ts:1479` never consults the classifier. Let the
   classifier *widen* a scope the Observer under-read — the D6 asymmetry in the
   other direction — and carry a request across follow-up fragments so "full row"
   is not re-scoped to `none`.
5. **Decide on the Observer overlap** — §4h, recommendation Option 2 then Option 1.
6. **D1/D5**, then **B2, B3, B7, B6** as accuracy work with no latency
   expectation (§4g).

**Waiting on the user.** Gate C cannot start until the condition-blind Judge
invariant is formally retired (§7, § Open decisions). Nothing else is blocked.
Note that T-C1-024 makes Gate C more pressing, not less: **every** silence in
that session was `cooldown`, applied by the router after the Judge had already
decided to contribute (§4f).

**How to know it worked.** The measurement targets table in §4c, against the
baselines in §2, §4b, §4d and §4e.

**What is not covered by tests, and why.** This repository has no runtime
harness for `reserveTurn` / `executeRouteTurn` — `test-intervention-v2.ts` tests
`humanArrivalAction` as a pure function and never drives the engine. So A6's
timing and cancellation behaviour, A7's broadcast-before-verification ordering,
and the engine-side early supersession check in A2 are all verified by reasoning
plus live measurement only. Building that harness is worth doing before Gate D,
which needs generation-level post-conditions. Do not describe those three as
regression-covered.

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

5. **Alex answers inside the conversation's tempo** — a decision that lands
   after the humans have moved on is a lost turn, not a slow one. Added
   2026-09-07: 39% of T-C1-020's turns were discarded as superseded.
6. **Alex speaks like a participant, not a report** — length and per-turn
   information release are bounded and enforced, not requested. Added
   2026-09-07: Alex averaged 4× the humans' message length and released 15
   traits in a single turn.

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

### Gate 3 — Supply something to say — DONE (uncommitted)

Evidence: T-C2-035 (25 messages, 18 triggers, 6 Alex turns = 24%). Of 10
silences, **8 were contract-rejection silences** — 3 where every Judge attempt
was rejected (`ledger_judge_failure`, turns 2/9/12) and 5 where the Judge asked
to speak and then capitulated (turns 18/21/22/23/24). Exactly one silence was a
genuine `no_useful_move` (turn 25) and one was cooldown (turn 6). Alex was not
short of things to say; the validator was rejecting what it wanted to say.

**3a. `conversationObserver.ts` focus normalization.** A `current_explicit`
focus whose candidate the turn does not name was silently relabelled
`carried_thread` and kept. T-C2-035 seq 4 said "so I delete Candidate C as well"
while the observer reported focus B; B survived with a valid-looking basis and,
because focus carries forward, pinned the thread to B through seq 7 — Alex
answered about B, citing seq 3, four turns after the group moved to C. Now the
focus is dropped when the turn names candidates and the claimed one is not among
them, symmetric with the existing multiple-mention rule.

  Scope note: the rule fires **only** on a contradiction. A turn that names no
  candidate contradicts nothing, so the observer's carried candidate stands and
  only the basis is corrected. The first draft of this fix nulled that case too
  and was caught by an existing `test-intervention-v2` assertion (tc4022 seq 7);
  that assertion was correct and the draft rule was wrong.

**3b. `interventionEngine.ts` — `eligibleTraitIdsForLedgerState`.** Focus was a
hard gate: no focus candidate meant zero eligible traits, which made every
voluntary contribution structurally invalid. Eligibility is now a property of
the thread's `scopeCandidates`, with focus reordering the list rather than
filtering it. Extracted from a closure into an exported pure function so it is
directly testable.

**3c. `interventionJudge.ts` — voluntary `follow`.** `follow` was classed as an
interaction act requiring an opportunity id, and the only kind that maps to it
(`uptake`) is minted only after a human replies to Alex. So while the humans
talked to each other, taking up their point was structurally illegal — on turns
18/21/22/23/24 the Judge asked for exactly this and was rejected with
`interaction_act_missing_opportunity` + `voluntary_act_evidence_invalid` every
time. `follow` is now valid without an opportunity when its evidence is
`conversation_grounded_synthesis`, which keeps it distinct from `contribute`
(which carries a fact or correction) and stops it becoming an unconditional
right to speak. `answer` and `participate` still require the request on record.
Judge prompt updated and versioned `conversation-ledger-judge-prompt-v4`;
`CONVERSATION_OBSERVER_VERSION` bumped to `conversation-observer-v9` for 3a.

Regressions added, each verified to fail when its own fix is reverted:
`test-intervention-v2` (3a: contradicted focus dropped, named focus kept,
unnamed turn still carries) and `test-conversation-ledger` (3b: null focus
offers the whole 24-trait scope, focus reorders without shrinking, surfaced
excluded, dead thread offers nothing; 3c: grounded voluntary follow valid,
ungrounded follow rejected, orphan `participate` still rejected).

Exit check (still open, needs a live run): `no_useful_move` and
`ledger_judge_capitulated_after_rejection` silences fall relative to the
T-C2-035 baseline of 5 capitulations + 1 genuine silence.

### Gate 3R — What T-C2-037 showed after Gates 1–3 — DONE (uncommitted)

Second diagnostic session, run with Gates 1–3 live: C2 Leader, 31 messages,
23 intervention decisions, 6 spoken (26%). Four distinct structural causes, all
confirmed against the exported observations rather than the console log.

| Turn(s) | Recorded outcome | Actual cause |
| --- | --- | --- |
| 2 | `ledger_judge_failure` | the only listed opportunity was one cooldown forbids |
| 8→9 | spoke, wrong candidate | eligible traits arrived unranked; focus was null |
| 18, 19, 25, 26 | `ledger_judge_capitulated_after_rejection` | one inert field rejected the whole decision |
| 28, 30 | `ledger_router_human_floor_held`, no opportunity | a plural invitation resolved to one human |

1. **Candidate salience.** `focusCandidate` is a single slot filled by a
   probabilistic observer, and it was null on 12 of 23 decisions — null on
   exactly the turns that matter, because a comparison turn names two candidates
   (so "the" focus is undecidable and normalization drops it) and a continuation
   turn names none. Gate 3 removed the *gate* but left the list in trait-id
   order whenever focus was null, so at turn 8 the Judge read from the top and
   Alex broadcast a Candidate A note while the group was eliminating Candidate C.
   The humans complained six messages later that Alex was adding nothing.
   `ConversationThread.candidateSalience` now records the last seq at which each
   candidate was literally named; the reducer accumulates it, so a turn that
   names nobody no longer erases what the group was on.
   `candidateSalienceOrder()` ranks focus first when there is one and recency
   otherwise, and `eligibleTraitIdsForLedgerState` orders by it. Pure derivation
   over recorded mentions — no model call, no reinterpretation of wording, which
   keeps the Observer/reducer split in §7 intact.

2. **An option the validator will reject is not offered.** Turn 2 listed
   `opp:1:group_request:alex` and nothing else; Alex had spoken on the previous
   message, so `selected_opportunity_requires_cooldown` rejected it on both
   attempts and the turn produced no decision at all. This is the same defect
   Gate 1 fixed for terminal and stale-invited opportunities — cooldown is
   simply the third class. `conversationLedgerDecisionProjection` now takes
   `cooldownAvailable` and drops opportunities that cannot bypass it. The
   validation rule is unchanged; only the menu is.

3. **An inert field is repaired, not punished with silence.** Turns 18, 19, 25
   and 26 are one shape four times: `follow` + `conversation_grounded_synthesis`
   with `selectedTraitId` also filled. That field reaches generation solely
   through `build_on` + `relevant_unsurfaced_information` (`routeTurn.ts:220`,
   `routeTurn.ts:308`), so under any other evidence it is inert — yet validation
   rejected the whole decision, and the retry took `silent`, the one output that
   always validates. `canonicalizeConversationLedgerJudgeDecision` now clears the
   field before validation and records `trait_cleared_for_non_trait_evidence` on
   the attempt. The legacy Judge path has always done exactly this
   (`interventionJudge.ts:40`); only the ledger Judge was stricter.

   **The opposite repair was rejected.** Promoting the evidence to
   `relevant_unsurfaced_information` to match the trait would hand the turn a
   licence to reveal a private note that the Judge never asked for. Repair may
   only ever remove a privilege, never grant one. Anything that could change
   meaning is still rejected.

4. **A plural invitation is not a prohibition.** At turns 28 and 30 a
   participant asked "the two of you" and "either of you". The room is one
   speaker, one other human and Alex, so both turns addressed Alex — the
   observer resolved each to the single human, with `addressee` confidence 0.9.
   Two things followed: no Alex opportunity was minted, and
   `expectedHumanResponder` produced a held floor, which the router treats as an
   absolute veto. An explicit invitation became a prohibition. Fixed at both
   layers: the Observer prompt now states the plural-address rule, and
   `normalizeConversationObservation` resolves a second-person plural address to
   every other participant deterministically (repair code
   `plural_address_includes_alex`) — this is a structural fact about a
   three-participant room, not a reading of intent. Separately, a request whose
   addressees include Alex can no longer produce an exclusive human floor; it
   yields `expectedNext: [human, alex]` with the floor open. The narrower rule
   is unchanged: an ordinary human-to-human question still reserves that human's
   turn. Detector checked against all 23 human messages of the session: it fires
   on 28 and 30 and nothing else. **Known limit:** the deterministic half is
   English lexical matching, so a Korean-language session (`session.language`
   supports `ko`) is covered only by the prompt rule. If ko sessions are in
   scope, add the equivalent forms before running one.

**Deliberately not done.**

- **No cooldown bypass for a "focus shift + exact fact" turn.** Turn 10 is the
  case that motivates it, and turn 10 is downstream of defect 1: the Judge chose
  `C_n1` correctly there, and the only reason cooldown was spent was Alex's
  wrong-candidate broadcast at turn 9. The information reached the group anyway
  at turn 12. Cooldown also did real work at turn 7, blocking an `A_p1`
  contribution during a Candidate C exchange. Fix the ranking first, then
  measure; loosening a working safety gate to compensate for a fixed defect
  would be the wrong order.
- **Retry-forbids-silent** stays deferred (see Gate 2), now with a second reason:
  repair 3 removes the violation that caused every capitulation in this session.
- **Opportunity id keying** stays unchanged (see Gate 1).

**New finding for Gate 4, not fixed here.** In all four capitulations the Judge
asked to take up what the humans just said *and* carry a specific fact. The
contract splits those: `contribute` + `relevant_unsurfaced_information` carries a
fact with no uptake, `follow` + `conversation_grounded_synthesis` carries uptake
with no fact. The model reached for the combination four times in one session.
Gate 4 item 8 (permit a brief uptake opener on the substantive routes) is what
closes that gap; do not add a new evidence type before trying it.

Regressions in `test-conversation-ledger.ts` (Gates 3d–3f) and
`test-conversation-recovery.ts`, reproducing all four shapes from the observed
run. Each was verified to fail with its own fix reverted, including the
accumulation half of salience, which a naive revert would have left passing.

Verified: `build`, `test:conversation-ledger`, `test:conversation-recovery`,
`test:intervention-v2` all pass; `git diff --check` clean. Versions bumped:
observer `v9→v10` / prompt `v6→v7`, ledger judge `v3→v4` / prompt `v4→v5`.

Exit check (needs a live run, the user's call): on a comparable session, turn-2
style `ledger_judge_failure` and `..._capitulated_after_rejection:trait_present_for_non_trait_evidence`
should both reach zero, and a voluntary contribution should name the candidate
the group is actually on.

### Gates 4 and 5 (original) — RETIRED 2026-09-07

Superseded after two live runs (T-C1-020 Peer, T-C2-039 Leader) showed a
different bottleneck than the one those gates were written for. Disposition of
every original item, so nothing is lost by accident:

| Original item | Disposition |
| --- | --- |
| 8. uptake opener on address/followup | → **Gate D3** (folded, unchanged in intent) |
| 9. relax the "my notes" opener rule | → **Gate D5** (folded into the exception-clause trim) |
| 10. deterministic anti-repeat via `revealStats.aiSurfacedIds` | → **Gate D4** (now evidenced: C profile recited 4×, D 3× in one session) |
| 11. C2 task-grounding regex discards the Observer snapshot | → **Gate B6** (kept as its own item; it is a router defect, not prompt quality. Re-observed at T-C2-039 seq 5–6: the fixed sentence fired and the participant's candidate elimination went unanswered, exactly as at T-C2-034 seq 5) |
| 12. always emit a turn trace | **DONE** — `[pooling] coverage: …` now prints on every turn including zero results, plus `traceTurnEvent` |
| 13. separate failure from absence | **DONE for the human path** — `verifyHumanTraitCandidates` returns `no_candidates \| verified \| no_matches \| failed` with an error string, and logs a warning on `failed`. **NOT done for the AI path** → **Gate D2** |
| 14. deduplicate repeated evidence quotes | **DONE** — the deterministic path resolves same-phrase entries (`poolingExtractor.ts:274`); no loss observed across 70 human messages in the two runs |
| 15. wire the trait keyword registry | **DONE differently** — the runtime now imports `TRAIT_KEYWORD_REGISTRY` from `lib/traitKeywordRegistry.ts`, not from the YAML. `eval/trait_keyword_registry.draft.yaml` still says `runtime_enabled: false` and is now **stale and misleading**; delete it or mark it superseded. The TS registry's contents were not audited against the approved draft — do that before trusting extraction numbers in a paper. |

**Human-side extraction is retired as a workstream.** It is off the critical
path (`sockets/index.ts:298`, fired as `void`), deterministic-first with a
bounded verifier, and across the two runs it missed nothing in list-style
messages and correctly reported duplicates as `verified` / `no_matches`.
A vector/RAG retrieval layer was considered and rejected: the target is a fixed
closed set of 40 trait ids, where embedding search buys nothing over the
existing deterministic matcher and adds latency and nondeterminism. Revisit only
if the traces start showing misses.

---

## 4b. Second evidence base — T-C1-020 and T-C2-039 (2026-09-07)

Two live runs on the Gate 1–3R build. C1 = Peer, C2 = Leader.

| Metric | T-C1-020 (Peer) | T-C2-039 (Leader) |
| --- | --- | --- |
| Human messages / Alex messages | 51 / 18 | 19 / 11 |
| Decision turns | 51 | 19 |
| Median turn latency | 10.2 s | 12.7 s |
| Max turn latency | 31.1 s | 21.4 s |
| **Turns discarded as superseded** | **20 / 51 (39%)** | 2 / 19 |
| Alex words per message (mean / max) | 43.8 / 125 | 55.6 / 102 |
| Human words per message (mean) | 10.6 | 24.2 |
| Max traits revealed in one Alex message | **15** | 6 |
| Observer latency (mean / max) | 6.9 s / 14.3 s | 6.8 s / 11.9 s |
| Observer output tokens per turn | ~450 | ~450 |
| Observer input tokens (first → last) | 2,600 → 6,682 | 2,677 → 5,330 |
| Judge cached input tokens | **0 (always)** | **0 (always)** |
| Open opportunities (first → last) | 0 → 3, total 11 | — |
| Directive/procedural phrasing | 1 / 18 | 8 / 11 |

Latency decomposition per turn: **Observer 6.8 s (60%) → Judge 1.8 s (16%) →
Generation 2.3 s (20%) → floor 2–3 s.**

### What the two runs settled

1. **Gate 3R worked where it was aimed.** T-C2-039: the ledger Judge accepted on
   attempt 1 on 17 of 17 calls. Zero `ledger_judge_failure`, zero
   `ledger_judge_capitulated_after_rejection`. `trait_cleared_for_non_trait_evidence`
   fired 8 times as a repair — eight turns that the old validator would have
   turned into silence.

2. **Gate 3R's salience ranking regressed on its own terms.** At T-C2-039 seq 10
   Alex spoke about Candidate A while the group was on Candidate C, and the
   participant corrected it directly at seq 11 ("No this is Candidate C"). Two
   causes, both mine:
   - the literal-candidate regex in `conversationObserver.ts` only matches a bare
     `A` before `and/or/vs/,//`, so `"Okay let's lay out A first"` recorded **no**
     mention and salience never learned about A;
   - `candidateSalienceOrder()` puts `focusCandidate` first unconditionally, so
     an observer focus of `A` with basis `carried_thread` — an *announcement* —
     outranked salience `C: 5`, which was the candidate actually under discussion.
   Recency beat focus here. The ordering rule was wrong.

3. **The length contract is written and unenforced.** `outputDiscipline` already
   says "at most two short sentences … 40 words or fewer" and "share at most one
   trait". Measured: 44 and 56 words mean, 15 traits in one message.
   `outputScopeViolation()` checks trait counts but never length, and the
   `address` / `followup` routes carry **no `maxTraitIds` guard at all** unless a
   request scope supplies one — so T-C1-020 seq 4 revealing 15 traits on the
   third turn of the session was permitted, not a violation. That single message
   collapsed the hidden-profile manipulation.

4. **The Judge is not deciding anything.** T-C2-039: it answered `speak` on 18 of
   19 turns; every silence was `cooldown`, applied by the router *after* the
   Judge had already decided. The Judge is a rubber stamp and the cooldown
   counter is the real controller.

5. **Prompt caching is off.** The Judge reports `cachedInputTokens: 0` on every
   call and the Observer caches only its system block. Both prompts put the
   volatile ledger JSON *before* the append-only transcript, which is the exact
   inverse of what prefix caching requires.

6. **Opportunities never expire.** T-C1-020 accumulated 11 opportunities, ending
   with 3 invitations still open; `opp:9:invitation:alex` stayed open for 58
   turns. This inflates every downstream prompt and lets the Judge answer
   half-hour-old invitations.

7. **Condition orthogonality is holding.** Directive/procedural phrasing appeared
   in 8 of 11 Leader messages and 1 of 18 Peer messages. No mediation route fired
   in C1. **This is the one property that must survive the next four gates.**

---

## 4c. Repair gates, second series

Ordered. Gate A first because 39% of turns are currently thrown away, and no
later gate's effect can be measured through that much loss.

### Gate A — Latency and flow — A1–A4, A6, A7 DONE (uncommitted); A5 not needed

| # | Change | Where |
| --- | --- | --- |
| A1 | **Burst coalescing.** Debounce the decision path 600–800 ms and coalesce consecutive messages from the same speaker inside the window into one anchored turn. T-C1-020 contains messages 234 ms apart (seq 24/25, identical text). | `sockets/index.ts:352` (`enqueueConversationObservation`) and `:359` (`onHumanMessage`) |
| A2 | **Cancel in-flight work on supersession.** Supersession is already detected; the Observer/Judge calls are not aborted, so a discarded turn still burns its full latency and a queue slot. | `interventionEngine.ts`, `conversationObserver.ts` (both already build `AbortController`s) |
| A3 | **Prompt-cache ordering.** Reorder every prompt to `[static system + task] → [append-only transcript] → [volatile ledger/state last]`. Judge caching is currently 0%. Prefix caching needs ≥1024 stable leading tokens and breaks on any change before that point. | `interventionJudge.ts:700` (user prompt), `conversationObserver.ts`, `routeContext.ts:1569` (`developerPrompt` + `transcriptPrompt`) |
| A4 | **Never trim the transcript from the front.** A sliding window invalidates the cached prefix every turn. Cap by dropping *state* detail, not leading messages. | same |
| A5 | *(user decision)* `floorMs` 2000/3000 is 20% of the observed turn time and is an experimental design value. Not changed without approval. | `config/triggers.ts` |

Expected: Observer output cut (Gate B1) plus cache hits plus coalescing should
remove roughly two thirds of the wall-clock. Measure before claiming it.

**A1 pre-flight, checked 2026-09-07 — the risk is real, bounded, and now exact:**

- `waitForConversationObservation({ sessionId, anchorSeq })`
  (`conversationObserver.ts:1395`) looks up **one exact seq** and returns `null`
  when that seq has no observation, dropping the turn to the degraded path. So a
  coalescer must be a single upstream gate that picks the anchor seq **once**,
  and hand that same seq to both `enqueueConversationObservation` and
  `onHumanMessage`. Coalescing only one of the two silently disables the
  Observer for that turn.
- The Mongo index is `{ sessionId, anchorSeq }` **unique, not dense**
  (`models/ConversationObservation.ts:308`), so skipping intermediate seqs is
  schema-legal. No migration needed.
- **New finding, and it strengthens A1 and A2:** the observer queue is strictly
  serial per session — `enqueueConversationObservation` chains every job onto
  `tails.get(sessionId)` (`conversationObserver.ts:1347`). At 6.8 s each, a
  three-message burst puts ~20 s of backlog in front of the last message before
  it is even observed. **This is the mechanism behind the 31.1 s worst turn**,
  not a slow single call. Cancelling a superseded in-flight observation (A2)
  therefore returns its queue slot immediately, and is worth as much as A1.

Do the coalescer as one gate above both call sites, then run
`test:conversation-recovery` before anything else.

**Shipped 2026-09-07 (A1–A4).** The pre-flight above changed the design: a
timer-based debounce would have added 600–800 ms to every *isolated* turn to
save time only on bursts. What the queue actually needs is an invariant, not a
delay — **at most one live observation per session, always for the newest human
turn** — so no isolated turn pays anything.

1. `conversationObserver.ts` — `enqueueConversationObservation` keeps a
   per-session `liveObservation` handle; a **strictly newer** anchor aborts the
   older one, queued or in flight. Strictly-newer matters: a re-observation of
   the same anchor must not cancel the observation it is refining.
   `runObservation` returns at its first line on an aborted signal, before any
   database read, and returns `null` without persisting when the signal fired
   during the call — so a superseded turn leaves **no error row** in the audit.
   The signal is threaded to the OpenAI request, so an in-flight call is really
   aborted and the serial queue slot comes back immediately.
2. `interventionEngine.ts` — the supersession check that already existed *after*
   `waitForConversationObservation` now also runs *before* it. This adds no new
   rule; it moves an existing one earlier, so a discarded turn stops paying a
   full observation first.
3. `interventionJudge.ts`, `conversationObserver.ts` — prompts reordered to
   `[static system] → [append-only transcript] → [volatile ledger] → [instruction]`.
   Prompt versions bumped: observer prompt `v7→v8`, ledger judge prompt `v5→v6`.

**Deliberately not done: generator prompt reordering.** Its system block (task
environment + notes + policies) is already large enough to cache; moving the
transcript ahead of the developer block would buy roughly 700 tokens of caching
while changing the order instructions and evidence reach the model. Not worth
the behavioural risk. Revisit only with a measurement.

**Regressions** in `test-conversation-recovery.ts`: a burst superseded while
queued costs no model call; a burst superseded in flight is aborted and does not
block the newer turn; neither writes an audit row; and the observer prompt keeps
the transcript ahead of the volatile state. Each verified to fail with its own
fix reverted. One redundant guard was found and removed during that check — the
queue-level skip could not fail any test because `runObservation` already
returns on an aborted signal at its first line.

**Not covered by a regression:** the engine-side early supersession check (2).
It duplicates a check that already exists eight lines later, so its outcome is
unchanged and only its timing differs; testing it needs a full runtime harness.
Said plainly rather than left implied.

**Measured on T-C1-021 (2026-09-07), same script, first 10 turns:**

| | T-C1-020 (before) | T-C1-021 (after A1–A4) |
| --- | --- | --- |
| All turns, mean | 14.6 s | **11.5 s** (−21%) |
| Silent turns | 8.2 s | **6.8 s** |
| Spoken turns, median | 19.6 s | **13.2 s** |

Real, and not enough. The run also settled where the rest of the time is:
**a spoken turn costs 6.5 s more than a silent one on the same decision path**,
and `floorMs` is only 2 s of that. Two serializations account for the rest.

### A5 — `floorMs` — NOT NEEDED, superseded by A6

Cutting the floor would change an experimental design value to buy ≤2 s. A6
buys the same 2 s with no design change at all, so A5 is off the table unless
A6 and A7 together still leave the turn too slow.

### A6 — Overlap the floor pause with generation — DONE (uncommitted)

`reserveTurn` set `setTimeout(floorMs)` and only then ran generation, so the two
costs were additive — yet typing is already displayed from the moment the turn
is reserved, which means **the floor is a display delay and the server was idle
through it**. Generation now starts at reservation time and waits on a
`floorGate` immediately before the existing commit check in `routeTurn.ts`.
Participant-visible timing is unchanged: typing starts at the same instant and
no message can appear before the floor deadline.

Because generation now runs while the turn is still retractable, four things had
to move with it:

1. The `reservation` → `busy` transition moved from the top of `runReservation`
   into the floor timer. That transition *is* the moment the turn stops being
   retractable, so `humanArrivalAction` keeps returning `cancel_floor_then_evaluate`
   during the pause and `finish_generation_then_reevaluate` after it — unchanged
   semantics.
2. `cancelReservation` marks the reservation `abandoned` and opens the gate, so
   parked generation unblocks, fails `commitGuard` (the timer never set
   `activeGenerationId`) and commits nothing.
3. An abandoned turn's second audit record is suppressed at both sites it would
   have appeared — `AIIntervention` via `supersededRecordOwnedElsewhere`, and
   `finishTurnTrace` via an early return. Cancellation owns the record.
4. The summary route's `generating → pending` repair runs *before* that early
   return, so an abandoned summary still releases its status.

**Not covered by a regression.** There is no runtime harness for `reserveTurn` /
`executeRouteTurn` in this repository — `test-intervention-v2.ts` tests
`humanArrivalAction` as a pure function and never drives the engine. Building
one means mocking `io`, `Session`, `Message`, `allocSeq`, `AIIntervention` and
the model call; worth doing before Gate D (which needs generation-level
post-conditions), but not silently claimed here. **A6's timing and cancellation
behaviour is verified by reasoning and by build + the three suites only, and
needs a live smoke run to confirm.**

**Correction to the record:** A6 was proposed as having "no design impact",
which is true, and was described as ready to start immediately, which
understated it — it touches the reservation state machine at seven points. The
scope was read properly only after the proposal.

## 4d. Third measurement — T-C1-022 (2026-09-07)

Same opening script again, on the Gate A build. **Diagnosis only — nothing was
fixed from this run.**

| Turn class | C1-020 (baseline) | C1-021 (A1–A4) | C1-022 |
| --- | --- | --- | --- |
| Silent | 8.2 s | 6.8 s | **6.7 s** |
| Spoken | 19.6 s (med) | 13.2 s (med) | 18.3 / 19.0 / 12.1 / 9.2 s |

### A6 does not appear to have been in effect in this run — SUPERSEDED by §4e

Per-turn arithmetic from the export, anchor 12: observer 4.055 + judge 1.047 +
generation 2.017 = 7.1 s. Adding a **sequential** 2 s floor gives 9.1 s; the
turn measured **9.2 s**. With the floor overlapped it should have been ~7.3 s.
Anchor 9 fits the same way. The most likely explanation is that the server was
still running the pre-A6 build (the log shows T-C1-021's long-silence timer
still resident, i.e. no restart between runs). **Re-measure on a restarted
server before drawing any conclusion about A6.**

**Resolved.** T-C1-023 was run on a restarted server and the arithmetic fits the
overlapped form on every spoken turn. The server had indeed still been running
the pre-A6 build here. See §4e.

### A3 worked for the Observer and cannot work for the Judge as built

- Observer: `cachedInputTokens` **2432–2560** on 4 of 7 turns (was 512–1590).
- Judge: **0 on every call, again.**

The reason is structural, not an ordering mistake. The Judge's static system
block is ~3,141 characters ≈ **785 tokens**, and OpenAI only caches prefixes of
**1024 tokens or more**. Early in a session `system + transcript` sits under
that line, so those calls are uncacheable no matter how they are ordered. The
Observer's system block is ~1,815 tokens and caches immediately.
**Not worth chasing:** judge calls run 1.0–1.7 s on 1.2–1.7 k tokens. Record the
reason and move on.

### The Observer review path can double a turn

Anchor 3 set `observerReviewed: true` and made two calls — 5,797 + 6,372 ms =
**12.2 s of observer on one turn**. Anchor 6 took **13,875 ms in a single call**.
Observer latency now ranges 3.9–13.9 s. This is the remaining bulk of the turn
and Gate B1 (cut ~400 output tokens to ~100) is aimed at the wrong half of it if
the review path keeps firing. New item **B8**.

### Two speech-quality regressions, both traceable

**1. Alex greeted the room again at seq 10 ("Hi again — glad we're starting with
Candidate A").** Not a generation whim. The observer created `thread-1` rooted at
**seq 1, Alex's own greeting**, with `requestedAction: "greet participants"` —
and that string was still the thread's requested action on **all seven**
observations, through seq 12. It reaches the generator as
`selectedOpportunityRequestedAction`. At turn 9 the Judge selected
`opp:1:group_request:alex`, whose origin is Alex's greeting at seq 1, citing
`judgeEvidenceSeqs: [1, 9]`. The generator was handed "the requested action is:
greet participants" eight turns into a candidate discussion and did exactly that.

Two defects compose here:
- the thread's `requestedAction` is frozen at whatever the observer wrote when
  the thread was created and is never revised as the conversation moves on. In
  every earlier session the thread happened to be rooted at a human's proposal,
  so the string was "discuss candidates" and this stayed invisible. New item
  **B7**.
- `opp:1:group_request:alex` is the thread-root-keyed inferred opportunity that
  **Gate 1 deliberately left unchanged** on the grounds that "there is no
  evidence in the observed run that the dead id cost any speech". That
  attribution held for T-C2-034 and T-C2-037. It does not hold now: this is the
  first run where that id produced visible damage in the transcript. The Gate 1
  deferral should be revisited under **B4**, not left as an audit-only concern.

**2. Peer Alex directed the process at seq 13** — "that alignment means our
shared data on A is complete for now and we can move on when you're ready."
Route `followup`, evidence `conversation_grounded_synthesis`, and the Judge's
selected trait `A_n5` was **cleared by the Gate 3R repair**. The turn therefore
had no licensed information to carry and the model filled it with process talk.
Same shape at seq 4 and 7 ("Sounds good", "Sounds like a plan"). Three of five
Alex messages in this session carry no candidate information at all.

This is a **known side effect of Gate 3R**, now with data. Gate 3R noted that
whether a fact-less `follow` was worth saying "is a judgement the log cannot
settle". T-C1-022 settles it for the Peer condition: it is not — a contentless
follow reads as process direction, which is precisely what a Peer must not do.
The orthogonality assertions do not catch it because it is not the `mediation`
route. **Gate D is the fix; do not patch it before then.** If Gate D slips, the
cheaper interim is to make a fact-less `follow` silent again in C1/C3 only.

Length itself improved: Alex averaged **30.8 words** here against 43.8 in
C1-020. The failure moved from too long to empty.

## 4e. Fourth measurement — T-C1-023, restarted server (2026-09-07)

**A6 is in effect and works.** Per-turn arithmetic now fits
`observer + judge + max(floor, generation)` plus a constant tail:

| anchor | observer | judge | generation | sequential | overlapped | measured |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 | 6.40 s | 2.36 s | 5.14 s | 15.9 s | 13.9 s | **16.6 s** |
| 9 | 6.75 s | 1.30 s | 2.66 s | 12.7 s | 10.7 s | **13.2 s** |
| 14 | 5.18 s | 0.98 s | 0 (deterministic) | 8.2 s | 8.2 s | **11.7 s** |

Every spoken turn lands on **overlapped + 2.5–3.5 s**, not on sequential. The
constant excess is the pre-broadcast AI-side trait extraction (`routeTurn.ts:553`)
— clearest at anchor 14, where generation was deterministic (0 ms) and 3.5 s of
tail remained anyway. **A7 is now the single largest remaining item on the
spoken path**, and its size is measured rather than estimated.

**Silent turns regressed: 9.5 s mean (6.7 s in T-C1-022).** The Observer is the
whole of it — 4.7 to 10.5 s per call, and its *output* grew monotonically
through the session, 270 → 531 tokens, as unclosed opportunities and thread
revisions accumulated (`opp:3`, `opp:4`, `opp:5` all still open at the end).
This is B1 and B4 measured on live data: the Observer's cost is not flat, it
**grows with ledger clutter**, so the TTL and the schema cut are the same fix
seen from two sides. Observer caching held (2432–2816 on 7 of 11 turns).

### New defect: the ledger and the floor disagree inside one observation

Turns 3, 4 and 5 were three consecutive `ledger_router_human_floor_held`
silences on explicit invitations. The observation for each says, at once:

- `alexRelation: "explicit_addressee"` — which fires Gate 1's
  `alex_addressee_taken_from_explicit_relation` repair and **mints an Alex
  opportunity**;
- `addressees: ["humanY"]` — which is what the Gate 3D floor rule reads, so it
  does not see Alex, leaves `expectedHumanResponder: humanY`, and the router
  vetoes.

So the ledger records "Alex has an open invitation" while the floor records
"Alex may not speak", from the same observation, because the two rules dispatch
on **different fields for the same question**. Gate 1 established that
`alexRelation === "explicit_addressee"` is an equally valid signal that a turn
addresses Alex; Gate 3D should have used that same predicate and did not. Mine
to fix. New item **B9** — cheap, and it cost three turns in a row here.

### The leader-like behaviour is coming from a deterministic template

At seq 14 a participant asked "do you have any other positives or negatives
other than the ones listed?" — a request for Alex's *additional* items. The
Observer classified it `requestIntentKind: complete_all_candidates`, which
routed to `server-deterministic-peer-complete`, and Alex emitted a formatted
board recap ending "Still to cover: B, C, D".

Three separate problems, none of them generation quality:
1. intent misclassification — the question asked for an increment, not a recap;
2. the template emits a **bulleted, tabulated layout** that `outputDiscipline`
   explicitly forbids ("no Markdown bullets, labels, analysis") — deterministic
   routes bypass the output contract entirely;
3. "Still to cover: B, C, D" is **agenda-setting**, which is Leader behaviour
   appearing in a Peer session.

**Gate D will not touch this** — it is not the model's output. New item **D6**,
and it is the more likely source of the "Alex is mediating like a leader"
impression than the fact-less `follow` turns are.

The fact-less `follow` pattern from T-C1-022 also recurred (seq 10, "I'll stay
on A until we agree to move on"). Same Gate D item, unchanged.

### A7 — Take the model call off the broadcast path — DONE (uncommitted)

`routeTurn.ts` awaited `extractSurfacedTraits` — an LLM round trip — between
`Message.create` and the socket emit, so Alex's finished message sat unsent
while a second model decided what it had revealed. T-C1-023 measured that at
2.5–3.5 s on every spoken turn, and 3.5 s of a turn whose message had been
generated deterministically in 0 ms.

It now runs the deterministic closed-pool matcher (`extractHumanTraitsFast`)
synchronously and sends the bounded model verification to the background as the
same late correction the human path already uses. The ledger still settles
before the broadcast; it settles without a network call.

**The matcher is a better fit on Alex's text than on human text**, which is why
this is not a recall trade. The output contract requires Alex to "preserve the
key wording of a trait", so its phrasing stays close to the pool. Checked
against verbatim messages from the observed sessions:

| message | model extractor recorded | matcher |
| --- | --- | --- |
| T-C2-039 seq 15 (Candidate C, six traits) | C_p1, C_p6, C_p7, C_n1, C_n2, C_n3 | identical |
| T-C1-020 seq 11 (two A misses) | A_n5, A_n6 | identical |
| T-C2-039 seq 19 **and** seq 29 | D_p1–D_p4 only | D_p1, D_p3, D_p4, **D_n5, D_n6** + 1 queued |

The last row is a **correctness finding, not just latency**. Alex disclosed
"misses on being considered moody and having strong prejudices" in both
messages and the model extractor recorded neither, twice. `revealStats` was
under-counting Alex's own reveals — the exact input the anti-repeat work (D4)
depends on, and a plausible contributor to the repeated recitations seen in
T-C1-020.

Regressions in `test-pooling-extractor.ts` on those verbatim messages. **Not
covered:** that the broadcast now precedes verification — that needs the
`executeRouteTurn` harness this repository still lacks.

## 4f. Fifth measurement — T-C1-024, first run with A7 and B9 (2026-09-07)

C1 Peer, 14 messages, 9 intervention decisions, 5 spoken (56%).

### A7 is confirmed, and Gate A is done

Per-turn arithmetic still fits `observer + judge + max(floor, generation)`, and
the constant tail that A7 targeted has collapsed:

| anchor | observer | judge | generation | overlapped | measured | tail |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 11.22 s | 1.25 s | 0 (deterministic) | 14.48 s | 16.00 s | **1.52 s** |
| 6 | 10.22 s | 2.98 s | 3.13 s | 16.33 s | 17.60 s | **1.27 s** |
| 9 | 7.26 s | 1.27 s | 1.62 s | 10.53 s | 11.00 s | **0.47 s** |
| 12 | 4.15 s | 1.16 s | 1.64 s | 7.31 s | 8.50 s | **1.19 s** |

T-C1-023 measured that tail at 2.5–3.5 s on *every* spoken turn, including one
whose message was generated deterministically in 0 ms. It is now 0.17–1.52 s
across all nine decisions. **Superseded turns fell to 1 of 9 (11%)** from 39% in
T-C1-020, so A1–A2 hold as well.

Median turn latency is **9.6 s** against a ≤5 s target. The gap is entirely the
Observer: 4.15–11.22 s per call, **66% of mean turn time** and 49–86% per turn.

### B9 was not exercised — it remains unverified

Zero `ledger_router_human_floor_held` silences, but that is not confirmation.
Every observation in the session reported `floor.holder: open` and
`expectedHumanResponder: null`, and no observation produced the contradiction B9
fixes (`alexRelation: explicit_addressee` together with `addressees` excluding
Alex). **Do not record B9 as live-verified on this run.**

### Cooldown is now the only silence mechanism

All three non-greeting silences were `cooldown`, and in each the Judge had
already answered `contribute` with real evidence — `relevant_unsurfaced_information`
twice. Judge contract health is otherwise perfect: 8/8 first-attempt accepts,
zero `ledger_judge_failure`, zero capitulation, so Gate 3R continues to hold.
§4b finding 4 is now total rather than partial: **the Judge decides nothing and
the cooldown counter is the controller.** This is Gate C3, still blocked.

### The Observer's cost grows with the backlog, again

Output tokens rose **384 → 527** monotonically across the session and
`opp:5:invitation:alex` stayed open from seq 5 to the end. The review path fired
once, at anchor 3, and made it the second-slowest turn of the session (11.2 s of
observer in two calls). This is B1, B4 and B8 measured a second time on live
data. Caching was erratic — `cachedInputTokens` 0 on 4 of 8 turns, including
three consecutive — which is worth a look but is not on the critical path.

### Every Alex message carried a quality defect

| seq | words | defect |
| ---: | ---: | --- |
| 4 | 16 | **D6**, degenerate — see below |
| 7 | 74 | **D3/D5** — 5 sentences, 4 traits, against a 40-word / 2-sentence / 1-trait contract; `outputScopeRepaired: false` |
| 10 | 31 | within contract |
| 13 | 39 | **D4** — see below |

**seq 4 — D6 fired on Alex's first substantive turn, against an empty board.**
`deterministicCompleteResponse`'s `complete_all_candidates` branch called
`formatCoverageFromIds(ids)` with nothing surfaced, so `includeUntouched`
produced a header promising content followed only by an agenda line:
"Here is what is on the table so far: / Still to cover: A, B, C, D". The existing
regression asserts exactly this must not happen for a Peer, but only on the
`complete_single_candidate` path, which passes `includeUntouched: false`. The
all-candidates branch was condition-blind. **Fixed — see the Gate D table.**

**seq 13 contained zero new information.** Of its four items, `A_p1`, `A_n5` and
`A_n6` are verbatim repeats of seq 10, and `A_p4` had just been stated by humanX
at seq 11. This is the cleanest measurement D4 has yet had.

**New finding — reveal ranking ignores information uniqueness.** Checked against
`traitData`: seq 7's four traits are all `XYZ`, held by every participant. Alex's
only `Z`-exclusive items for Candidate A (`A_n5` unfriendly, `A_n6` transmits
restlessness) were spent at seq 10 and then repeated at seq 13. Across the whole
session Alex disclosed 8 distinct traits, **2 of them hidden-profile-unique**.
`eligibleTraitIdsForLedgerState` ranks by candidate salience; nothing weights by
uniqueness, which is the variable the hidden-profile manipulation turns on.
**Not treated as a defect** — stating shared traits may be intended
common-ground behaviour. Flagged for the user to adjudicate before any change.

### Gate B — Observer: read the facts, cheaply and correctly

| # | Change |
| --- | --- |
| B1 | **DONE (uncommitted), but the target was wrong — see §4g.** The model's output contract and the observation consumers read are now separate types, so the cut is confined to what the model is *asked* for and no saved observation, consumer, or replay fixture changes shape. Three fields removed from the model contract: `mentionedCandidates` (the normalizer already recomputed it by regex and overwrote the model's answer, so every token spent on it was discarded), `activeThread.participants` (the session roster in a fixed three-participant room), and `activeThread.evidenceSeqs` capped from 32 to 4 with the prompt stating that the thread's earlier evidence is already accumulated by the reducer. Observer `v10→v11`, prompt `v8→v9`. **Measured against T-C1-024's real observations, this is a 7% output reduction, not the ~78% the item assumed, and it barely dents the growth curve (+120 → +108 chars).** The remaining output is not padding: ~93% of it is content some consumer reads, and most of the growth is legitimate (the thread genuinely accumulates candidates and a longer `requestedAction`). |
| B2 | **Fix the literal-candidate regex** so a bare `A` is detected in ordinary positions ("lay out A first"). Salience accuracy depends on it. Guard against the English article "a" as the prompt already warns. |
| B3 | **Invert focus vs salience.** Focus wins only when `focusBasis === "current_explicit"`. A `carried_thread` focus is an inference about an announcement and must not outrank the candidate actually being named. Direct fix for T-C2-039 seq 10. |
| B4 | **DONE (uncommitted).** Two deterministic rules in `reduceConversationLedger`, both pure seq arithmetic over state the reducer already holds, so the Observer/reducer split is untouched. (1) *Alex answering a thread retires that thread's older standing invitations* — in T-C1-024 `opp:5` and `opp:6` were one invitation restated, the Judge selected `opp:6`, and `opp:5` outlived the request it stood for. (2) A TTL backstop (`OPPORTUNITY_TTL_SEQS = 8`) for the case rule 1 cannot reach, where Alex never speaks and no consumption ever retires the backlog — T-C1-020 held one invitation open for 58 turns that way. Neither rule touches a `direct_question` or a `required` expectation: an unanswered obligation is a failure to keep in the record, not clutter to sweep. Verified by replaying T-C1-024's **recorded** ledger deltas and consumption transitions through the reducer: rule 1 fires exactly once, at the seq where Alex answered, and the session ends with 0 live opportunities instead of 1. This also addresses the Gate 1 deferral without changing the keying — a thread-root-keyed id is now retired by the first consumption on its thread. |
| B5 | **Compact the carried state.** Keep the transcript whole (cache-friendly); pass the previous ledger as a compact delta rather than a full JSON dump. |
| B6 | *(from retired item 11)* Stop the C2 task-grounding regex from bypassing the Observer snapshot, and give C2 a question-form variant. Re-observed at T-C2-039 seq 5–6. |
| B7 | **Revise the thread's `requestedAction`.** It is written once when the thread is created and never updated, so a thread rooted at Alex's greeting told the generator "greet participants" for a whole session (T-C1-022, seq 10). It must track what the group is currently doing, or stop being passed to generation as an instruction. |
| B9 | **DONE (uncommitted).** One predicate for "this turn addresses Alex": the floor rule now accepts `alexRelation === "explicit_addressee"` exactly as Gate 1's opportunity derivation does, so a turn can no longer open an Alex invitation and close the floor against it at the same time. **This required changing an existing assertion** — `test-conversation-recovery.ts` asserted "addressing Alex cannot cancel the observed human floor". That invariant cannot coexist with Gate 1, and T-C1-023 cost three consecutive turns to the contradiction. The narrower invariant that replaces it is asserted instead: a turn addressing Alex makes the floor **shared** (`expectedNext: [human, "alex"]`, human first), and a turn that does *not* address Alex still leaves the human floor exclusive. Both directions have regressions; the new one was verified to fail with the predicate reverted. |
| B8 | **DONE (uncommitted).** Not capped — two of the three triggers turned out not to warrant a call at all. (1) *A floor reading `transition: "available"` with a named holder* is evaluated on the **normalized** observation, and normalization resolves every such floor to `open`, or to `unclear` when the holder is off-roster. The condition could not fire; it is deleted. (2) *A roster conflict* was computed on the **raw** model output while the normalizer filters every roster-typed field, so `observationRosterConflicts(normalized)` is always empty. The caller now passes the surviving conflicts, which retires the trigger without changing the rule, and the raw conflict is kept as a `roster_conflicts_normalized:<n>` repair code. **This also closed a degraded-mode path**: those same raw conflicts flowed into `observerConflicts` → a material reducer rejection → `degradedMode`, which forbids all inferred speech — the identical category error Gate 2 corrected for redundant rejections. What remains is the one contradiction nothing deterministic settles: a thread requiring Alex's participation on a turn judged not relevant to Alex. The review call now also records **why** it fired, because the review overwrites the initial observation in the stored record and reviewed turns in T-C1-022 and T-C1-024 can no longer be attributed. |

### 4f-bis. Sixth measurement — T-C1-025, first run with D6, B4 and B1 (2026-09-07)

C1 Peer, same opening script, 8 messages, 5 decisions, 2 spoken.

**Three fixes confirmed live.**

- **B4 fired in production.** The intervention record at anchor 6 carries
  `transition:opp:5:invitation:alex:superseded:answered_by_opp:6:invitation:alex`
  — the exact rule, at the exact turn, on the exact pair it was written for.
- **D6 changed the routing.** The turn that produced the degenerate board recap
  in T-C1-024 now classifies `requestIntentKind: none` (was
  `complete_all_candidates`) and generates instead of emitting the template.
- **B1 is live**, `conversation-observer-v11`, output 264–473 tokens.

**Observer caching went to 0 on all five calls**, where T-C1-024 cached on 4 of
8. Suggestive, not conclusive at n=5 given how erratic caching already was;
confirm on a longer run before treating it as a B1 side effect.

**And D6 caused a regression, which is the important finding.**

| seq | words | traits | new | Z-only |
| ---: | ---: | ---: | ---: | ---: |
| 4 | 144 | 16 | 16 | 6 of the 8 in the whole pool |
| 7 | 131 | 15 | **0** | 6 |

Where T-C1-024 answered that turn with a bounded 16-word template, the
fallthrough to generation disclosed most of Alex's private profile on the third
message of the session, then repeated it with nothing new. **The hidden-profile
manipulation collapsed on message 4.**

The attribution matters and is mine: D6 is right in itself, but it removed an
*accidental* cap that had been masking D3. `address` and `followup` carry no
`maxTraitIds` unless a request scope supplies one — a defect that predates this
work and already produced a 15-trait message in T-C1-020. **D6 must not ship
without D3**, and D3 was therefore done immediately rather than in gate order.

### 4i. Seventh measurement — T-C1-027, first full real session (2026-09-07)

C1 Peer, 81 messages, 50 observations, 49 decisions, 28 spoken (57%). First run
with D3/D4 and B8 live. **Contains real participant text — quote nothing from
the human messages into any tracked file.**

**Confirmed working.**

- **B8**: 49 of 50 observations made a single call (review rate ~10% → **2%**),
  and the one review recorded `reason: "unresolved_conflict"` — the attribution
  field added with B8, so reviews can now be explained after the fact.
- **Observer median 6.5 s → 5.3 s**, max 11.2 → 9.4 s. Caching recovered to
  33/51, so T-C1-025's 0/5 was the small-sample artifact flagged there rather
  than a B1 side effect.
- **Length**: Alex mean **34.7 words**, max 68 (T-C1-025: 138 / 144). No dumps.
- B4 and D6 continue to behave correctly.

**Two defects in this repair's own work.**

**1. B1 destabilized the Observer's Alex-relation fields — ROLLED BACK.**
`alexRelevance` came back `not_relevant` on **50 of 50** observations and
`activeThread.alexParticipation` `invited` on 50 of 50. **32 of those also report
`alexRelation: "explicit_addressee"`** — Alex directly addressed and
simultaneously judged not relevant, which is incoherent without needing a
baseline to compare against. The last v10 run of the same opening script was 7 of
8 `relevant`.

Both stuck fields sit immediately after a field B1 removed, and structured output
is generated in schema order, so the removed fields were doing work as reasoning
scaffold rather than only as data. This is not cosmetic: both reach the Judge and
the generator through `describeConversationSituation`. Against a measured saving
of 7% of observer output and no latency effect (§4g), there was nothing to trade.

`mentionedCandidates` and `activeThread.participants` are asked for again;
`evidenceSeqs` stays capped, since it is the last field of `activeThread`, nothing
semantic follows it, and it was the unbounded accumulator. Observer `v11→v12`,
prompt `v9→v10`. **Method note:** §4g measured the schema as output cost and did
not consider that a field can carry reasoning value after its own value is
discarded. Measure the fields you keep, not only the tokens you cut.

**2. D3/D4 were not actually enforcing — D2 was the reason.** Three messages
shipped carrying six to eight traits each on turns whose guard was correctly
`{maxTraitIds: 1, maxRestatedTraitIds: 2}` — verified by rebuilding that turn's
context — and recorded no violation. `extractSurfacedTraits` ends in
`catch { return [] }`, and an empty result is indistinguishable from "this
message revealed nothing", so **every scope guard passed whenever extraction
failed**. The length improvement above is the prompt working, not the guard.
Fixed by the same move A7 made: the deterministic closed-pool matcher replaces
the model extractor on the guard path. It is network-free, cannot time out, has
no failure mode that reads as absence, and it removes one or two synchronous
model calls from generation. All three shipped messages are now rejected.

**Speech quality is the open front, and the user's reading of it is recorded
here because it sets the requirement.**

- **Alex accepted a candidate label as its own name.** Asked whether to call it
  "C" or "Alex", it answered that either works. `C` is a candidate identifier;
  accepting it corrupts the board Alex is helping build. Nothing in the contract
  reserves A/B/C/D.
- **Four consecutive turns answered a direct request with another clarifying
  question** — asked for a table, Alex asked compact-or-full; told "full row", it
  asked which order; given the order, it asked exact-phrases-or-labels; and so
  on, until the participant wrote that they had hoped the AI could just make the
  table. At one point Alex promised to arrange pasted items and never did.
  Measured cause: the **Observer** classified all four as
  `new_information_request` while the lexical classifier reads the first as
  `complete_all_candidates`. With an opportunity selected, `routeContext.ts:1479`
  takes the Observer's intent and never consults the classifier — the same
  asymmetry D6 addressed, except D6 only ever *narrows*. Narrow scope plus the
  layout ban plus a one-trait cap leaves no legal way to comply, so the model
  asks instead.
- **Follow-up fragments lose the request.** "full row" and "alphabetical order
  A, B, C, D" classify as `none`: they answer a question *Alex* asked, and
  nothing carries the original request forward. Every turn is re-scoped from
  scratch.

**Decided with the user (2026-09-07), and this is the requirement for the fix:**
the layout ban **stays**. Alex must **decline honestly instead of asking another
question**. A request for a table is declined. A request to collate everything
posted so far is declined **in C1/C3** on the honest ground that Alex sees only
its own card — "I can't put together everyone's; here is mine." That is an
orthogonality point as much as a tone one: a Peer is not the group's aggregator,
and claiming a view of the whole board is false for a Peer.

### 4g. Gate B's premise does not survive the T-C1-024 measurement

B1 was written on the assumption that the Observer's ~450 output tokens are
mostly derivable padding, and that cutting them to ~100 cuts the Observer's
latency proportionally. Both halves were tested against the run. Neither holds.

**The output is not mostly padding.** Reconstructing every schema field from
T-C1-024's first and last observations: the fields sum to 1,001 and 1,121
characters — roughly 280 dense tokens against a measured 527, so a large part of
the "output" is JSON formatting, not content that removing a field can reclaim.
Removing every provably-free field (§ Gate B, B1) takes 1,121 → 1,041 characters,
**a 7% reduction**. Growth across the session falls only from +120 to +108
characters, because most of it is legitimate: the thread really does accumulate
candidates and a longer `requestedAction`.

`activeThread` alone is 34% of the output and 66% of the growth. Cutting it
further means not re-emitting the thread every turn — a delta contract, not a
field trim — which changes what the reducer can reconcile and needs its own gate.

**Latency does not track output size within the observed range.** Across the
nine Observer calls:

| relationship | r |
| --- | ---: |
| latency vs output tokens | +0.53 |
| latency vs input tokens | −0.11 |
| latency vs cached input tokens | +0.09 |

and the per-call ratio ranges **8.6 to 21.6 ms per output token**, a 2.5× spread.
Two calls emitting 488 tokens took 7,259 ms and 7,680 ms while a 481-token call
took 4,150 ms and a 384-token call took 6,056 ms. Caching makes no difference
either: cached calls averaged **6,752 ms** against **6,250 ms** uncached. With
n=9 and a 1.4× spread in output size, the +0.53 is not something to spend a gate
on. Mean 6,474 ms with a 2,063 ms standard deviation is consistent with the
variance being upstream API latency rather than anything in the payload.

**What this redirects.** B1 is still worth keeping — the removed fields were
genuinely discarded, and the `evidenceSeqs` cap stops an unbounded accumulator —
but it is a hygiene fix, not a latency fix, and B2/B3/B7 should be planned as
*accuracy* work with no latency expectation attached. The remaining levers on
Observer latency, in order:

1. **B8** — bound the review path. A second full call is the one mechanism that
   demonstrably doubles a turn (12.2 s in T-C1-022), and it is unaffected by any
   of the above.
2. **Overlap the Observer the way A6 overlapped the floor.** At ~6.5 s mean and
   ~2 s standard deviation, no payload change reaches the ≤5 s median target
   while the Observer is a blocking serial call. This is the structural analogue
   of A6 and is probably the only item that can reach the target.
3. **A faster observer model.** `gpt-4o-mini` at 4–11 s is the floor being
   measured; this is a cost/accuracy decision for the user, not a code change.

### 4j. Honest decline and label reservation (2026-09-07)

Built to the requirement agreed in §4i. Two layers, because a prompt rule alone
has now failed at this class of problem three times (length twice, clarification
questions once): a deterministic detector that injects a server-derived block,
plus the standing rule in the frozen prompt for turns no detector catches.

**The constraint that shaped both refusals.** `outputDiscipline` already forbids
Alex from saying that a prompt, rule, policy, or scope prevents it from
answering. Neither refusal needs to: Alex writes chat prose, and a Peer really
does hold only its own card. Both are true in character, which is why the
detector blocks state a fact about Alex rather than a restriction on it. There is
a regression asserting the blocks never reach for policy language.

| detector | fires on | effect |
| --- | --- | --- |
| `layoutRequestSignal` | table, chart, grid, matrix, spreadsheet, columns/rows, bulleted/numbered list, and the Korean equivalents | address/followup only: say plainly you cannot lay it out that way, give what you have in sentences, **ask nothing** |
| `collationRequestSignal` | arrange / organize / compile / collate / combine / put together, bound to *everyone's* items | **C1/C3 only**: say you hold only your own notes and cannot compile everyone's, then give your own for the current candidate |
| `candidateLetterAddressSignal` | addressed as a bare `A`–`D`, "call you C", "respond to C", "you're C" | say once that you are Alex, then answer the substance |

`collationRequestSignal` is deliberately Peer-only. A Leader assembling the board
is in role and already has the summary and closing routes for it, so gating this
on `isLeaderCondition` keeps the refusal an orthogonality property rather than a
global behaviour. There is a regression for both directions.

The detectors were checked against the verbatim requests from T-C1-027,
including the ones that must **not** fire: "Alex, can you add all your attributes
for candidate A…" is a legitimate single-candidate complete request Alex should
answer in full, and "Candidate C was my least favorite" is discussion, not a
naming collision. `"full row"` — the follow-up fragment — is caught by the layout
detector, so the refusal survives the fragment even though the request scope does
not (that gap is still open; see the next-steps list).

**Frozen prompt, `1.7.2 → 1.8.0`** (`npm run prompts:compile`, hashes regenerate):

- `taskEnvironment` reserves A–D as candidate labels and states that Alex's name
  is Alex, placed where the candidate letters are introduced.
- `unifiedInteractionPolicy` now distinguishes an ambiguous request from an
  impossible one: "A request you cannot carry out is not an ambiguous one:
  decline it plainly in the same message and give what you can instead. Never
  answer two requests in a row with a question, and never offer a menu of
  formats or orderings in place of an answer." The one-clarification-question
  licence was what four consecutive deferrals were drawing on.
- `outputDiscipline` carries both refusals in full, next to the layout ban.

**Not done, and worth stating.** This makes Alex refuse well; it does not make
the underlying scope right. The Observer still classified all four table turns
`new_information_request`, and a follow-up fragment still classifies as `none`,
so Alex is declining from a scope that was already too narrow. Both are in the
next-steps list.

### 4h. Observer overlap — design (2026-09-07)

§4g established that no payload change reaches the ≤5 s median target while the
Observer is a blocking serial call at ~6.5 s mean and ~2 s standard deviation.
This is the design for taking it off the critical path. **No code has been
written for this**; the two options below change routing behaviour and want the
user's decision first.

#### What the Observer is actually on the critical path for

`executeRouteTurn` awaits `waitForConversationObservation`
(`interventionEngine.ts:1784`) before anything else in the decision. But the
Observer produces two different kinds of output, and only one of them gates the
current turn:

| output | who needs it | when |
| --- | --- | --- |
| addressees, `alexRelation`, `speechAct`, `requestExplicitness`, floor, opportunity proposals | this turn's routing decision | **now** |
| thread revision, candidates, `candidateSalience`, `conversationPhase`, `requestIntent` detail, `activeThread` bookkeeping | the ledger, for later turns | before the *next* decision |

The whole call is awaited for the first row.

#### Option 1 — Split the call: a fast decision observation, a full one behind it

Two calls. A small one returns only the first row (~60 output tokens) and gates
the decision; the full one runs off the decision path and merges into the ledger
before the next turn.

**The Judge is the existence proof for the latency claim**, and it is worth being
precise here because §4g just showed that output size does *not* predict latency
within the Observer's own 384–527 token range. The Judge is the same model
(`gpt-4o-mini`), in the same sessions, on comparable input (1.1–1.9 k tokens),
emitting 36–46 output tokens: it runs in **1.0–1.7 s**. That is a measurement of
a small call, not an extrapolation from a large one.

- Critical path: ~6.5 s → ~1.5–2 s. Median turn **9.4 s → ~5 s**, and it is the
  only option that helps *spoken* turns, which is what participants experience
  as slow (13.6 s at T-C1-025 anchor 3).
- Cost: two observer calls per turn instead of one. The added call is small; the
  large one is unchanged and no longer blocks.
- Risk: the two can disagree. The rule has to be that the fast call is
  authoritative for the decision it already gated, and the full call is
  authoritative for state — never a retroactive re-decision, which would violate
  "successful broadcast is the only `consumed_by_alex` transition".
- Risk: if humans type faster than the full call returns, the next decision runs
  on a ledger one turn stale. A1/A2's supersession already handles the analogous
  case, and B4's TTL bounds how long a missed opportunity lingers.
- This is a gate, not a patch: new schema, prompt, version bump, reconciliation
  rule, and regressions.

#### Option 2 — Decide the deterministic vetoes before paying for the Observer

`cooldownAvailable` is `messagesSinceLastAI(docs) >= 2` — **pure arithmetic over
documents already loaded**, computed at `interventionEngine.ts:1806` and applied
as a veto at `:1937`, after both model calls have run. In T-C1-024 and T-C1-025
*every* silence was that veto: eight turns that each paid a full Observer and
Judge to reach a decision the counter had already made.

The turn's silence can be recorded immediately, with the observation still
running **off the decision path** so the ledger stays current. The work still
happens; it stops blocking a decision that does not depend on it. That is the
same move as A6.

- Silent turns: 6.3–10.3 s → **~0.2 s**. Three of five turns in T-C1-025.
  Median turn **9.4 s → ~6.4 s**. Does not help spoken turns.
- **This changes behaviour, which is why it needs a decision.** Cooldown is not
  an unconditional veto: `opportunityMayBypassCooldown` lets a `required`
  expectation, or an `uptake` invitation on the foreground thread, speak through
  it — and this turn's observation is what would mint either. Skipping the
  observation blindly would convert a direct question during cooldown into
  silence, which is exactly the conflation §7 forbids.
- The safe form gates the fast path on a conservative deterministic test that
  no bypass is possible: the message names no participant, asks nothing, and is
  not the first message after an Alex turn (an `uptake` cannot exist otherwise).
  Anything not provably exempt takes the normal path. That test is cheap and
  needs no model call.

#### Option 3 — A faster observer model

`gpt-4o-mini` at 4.5–11.2 s is the floor being measured. Nothing in the code
changes. This is a cost and accuracy decision for the user, and it interacts
with the IRB/pre-registration record of which models produced the behaviour.

#### Recommendation

**Option 2, then Option 1.** Option 2 is small, reversible, has the larger
effect on the median, and its risk is confined to a single well-understood
predicate. Option 1 is the only thing that helps the turns participants
experience as slow, and should follow once Option 2's measurement confirms the
Observer is the whole remaining budget.

#### What must not regress

- Silence must stay attributable: a turn skipped by Option 2 records
  `cooldown`, never `no_useful_move` — generation failure, floor, lifecycle and
  cooldown are already required to stay distinct (§7).
- The ledger must not silently fall behind: an off-path observation still
  persists, and a missed turn is still recoverable by the path
  `test-conversation-recovery` already covers.
- Option 1 must never re-decide a turn after the fact.
- Condition orthogonality is untouched by both; neither option reads the
  condition code.

#### How to measure

Per-turn arithmetic exactly as in §4e/§4f: `observer + judge + max(floor,
generation)` against measured elapsed. Success for Option 2 is silent turns at
≤1 s with the same `silenceReason` distribution; for Option 1, spoken turns at
≤6 s with no rise in wrong-candidate turns or ledger conflict codes.

### Gate C — Judge: a goal, not a rubber stamp

**This gate retires the "Judge is condition-blind" invariant in §7 and needs
explicit approval before any code moves.** It raises construct validity — a
leader differs in what they *decide*, not only in how they phrase it — but it
moves the manipulation upstream, which may touch how the manipulation is
described in the pre-registration and the IRB protocol.

| # | Change |
| --- | --- |
| C1 | **Inject a role goal** in the developer message. Leader: actively guide the group toward a well-considered collective decision — structure the conversation, keep it focused and moving, address disagreements, take responsibility for a clear outcome. Peer: contribute cooperatively as an equal team member — share relevant information, respond constructively, help evaluate options, without directing, managing, or mediating. |
| C2 | **Enforce orthogonality in the action space, not the prompt.** Remove `mediate` and directive acts from the Peer schema so they are unrepresentable rather than merely forbidden. The orthogonality assertions at `test-intervention-v2.ts:1317` must keep passing unchanged. |
| C3 | **Give the Judge something real to decide.** Expose cooldown to it as a budget it can see and spend. Today it says `speak` and the router silently discards the decision, which is why 18 of 19 decisions were `speak`. |
| C4 | Facts (Observer output) stay in the user message; the goal goes in the developer message; deterministic validation is unchanged. |

### Gate D — Generator: length as a post-condition, not a request

Two prompt-only attempts have failed. Enforce it.

| # | Change |
| --- | --- |
| D1 | **Set `text: { verbosity: "low" }`.** The GPT-5 family's own length control, currently unused. `reasoning: { effort: "minimal" }` is already set. No prompt edit required. |
| D2 | **DONE (uncommitted).** The deterministic closed-pool matcher replaces the model extractor on the guard path, the same move A7 made for the pre-broadcast ledger update: network-free, so it cannot time out, and with no failure mode that reads as absence. This also removes one or two synchronous model calls from generation. **It was not cosmetic** — T-C1-027 shipped three messages of six to eight traits on turns whose guard was correctly set to one new trait, because the empty extraction made the check pass. D3 and D4 have only actually been enforcing since this landed. |
| D3 | **DONE (uncommitted).** A turn on `address`/`followup` that carries **no request at all** now gets a default guard of one new trait. The scoping rule is deliberate: when the human asked something specific — a preference, a count, a full list, an explicit narrowing — the request-scope machinery already decides what Alex may say and is entitled to decide that no limit applies, so those paths are untouched and an explicit all-candidate request still answers in full. Violations go through the existing repair loop, which **fails closed** (a lost turn, not an unbounded one). **This required changing an existing assertion**, recorded per §6: `bareAddressContext` asserted `maxTraitIds` must be undefined under a `focus_depth` guard, on the design note that focus and trait-count limits are independent. That note is still right about scope — the candidate lock is unchanged and asserted — but it was wrong that anything else bounded the count: nothing did, so a bare "Alex?" could answer with every trait Alex holds. |
| D4 | **PARTLY DONE (uncommitted).** The hard half shipped with D3: `maxTraitIds` counts only *newly introduced* traits, so a message reciting nothing but already-surfaced ones passed every guard — T-C1-025 seq 7 restated fifteen and introduced none. Guards now also carry `maxRestatedTraitIds` (2 on the default budget), violated as `too_many_restated_traits`. **Still open:** injecting `revealStats.aiSurfacedIds` into the prompt as "already stated by you", which is the positive half — the bound stops the recital, it does not yet tell the generator what it has already said. |
| D5 | **Add a length post-condition** to `outputScopeViolation()` (sentence and word count), and trim the `outputDiscipline` exception clause ("explicitly requested full list or comparison") that is currently firing on ordinary turns. |
| D6 | **DONE (uncommitted).** Three changes in `routeContext.ts`, each revert-checked. (1) *An empty board is not recited* — the route exists to prevent omissions in a board that exists; with nothing surfaced it returns `undefined` and the turn falls through to generation, under the output contract. This is T-C1-024 seq 4. (2) *"Still to cover" is Leader-only* — it names what the group has yet to do, which is agenda setting; a Peer recites the board and stops. Both conditions still report identical facts. (3) *The deterministic bypass requires both readings of the request to agree* — when an opportunity is selected the intent comes from the Observer and `classifyRequestIntent` is never consulted (`routeContext.ts:1479`), which is how T-C1-023 seq 14's request for *additional* items routed to a full board recap; disagreement now falls through to generation, never to a wider template. **Two classifier corrections came with (3):** a complete/all marker inside a proposal about procedure is not a request that Alex enumerate anything (T-C1-024 seq 3 matched `EXPLICIT_ALL_SCOPE` on "each candidate"), and the same direction requirement had to be applied to `preference_request` — `FOCUS_SCOPE_OVERRIDE` matches a bare "best", so without it the same proposal degraded into a request for Alex's preference instead. Directed requests, including those without a question mark, are untouched. |

### Measurement targets

| Metric | T-C1-020 / T-C2-039 | T-C1-024 | Target |
| --- | --- | --- | --- |
| Median turn latency | 10.2 / 12.7 s | **9.6 s** | ≤ 5 s |
| Turns discarded as superseded | 39% (C1) | **11%** | ≤ 10% |
| Pre-broadcast tail (spoken turns) | 2.5–3.5 s (T-C1-023) | **0.2–1.5 s** | — |
| Observer share of turn time | — | **66%** | — |
| Judge cache hit rate | 0% | 0% | structurally impossible, see §4d |
| Observer output tokens | ~450 | 384 → 527 | ~100 |
| Alex words per message (mean) | 44 / 56 | **34** (T-C1-025: 138) | ≤ 30 |
| Max traits per Alex message | 15 | **4** (T-C1-025: 16, pre-D3) | ≤ 2 |
| Wrong-candidate turns | 2 (both corrected by a participant) | 0 | 0 |
| Alex messages with zero new information | — | 1 of 4 | 0 |
| Directive phrasing, Leader : Peer | 8/11 : 1/18 | — | unchanged |

### Open decisions blocking work

1. **Gate C — the only thing actually blocking work.** Approve retiring the
   condition-blind Judge invariant (§7)? Until then Gate C cannot start; every
   other open item can proceed.
2. ~~**Gate A5**: may `floorMs` be tuned?~~ **Withdrawn.** A6 recovered the same
   2 s by overlapping generation with the pause, so the design value stays at
   2000/3000 ms untouched. Reopen only if Gate B leaves turns too slow.
3. `eval/trait_keyword_registry.draft.yaml` is stale — delete, or keep as a
   record with a superseded marker? Cosmetic; blocks nothing. Note that the TS
   registry it was superseded by is now load-bearing for **A7** as well as the
   human path, and its contents have still never been audited against the
   approved draft.

## 5. How to verify

From `server/` in the root checkout (it already has `node_modules` and a real
`.env`):

```sh
npm run build --silent
npm run test:intervention-v2
npm run test:conversation-ledger
npm run test:conversation-recovery
npm run test:pooling-extractor
```

All five must pass. `test:pooling-extractor` joined the set with A7, which put
the deterministic matcher on Alex's own output as well as the humans'.

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
  C2/C4. **Under review (Gate C, 2026-09-07):** this invariant is proposed for
  retirement in favour of a role goal inside the Judge. It stands until the user
  approves. Whatever replaces it, the orthogonality assertions at
  `test-intervention-v2.ts:1317` remain binding — a Peer must never gain
  mediation or task-standard correction.
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

- 2026-09-07 — Honest decline and candidate-label reservation (uncommitted).
  Built to the requirement agreed after T-C1-027: the layout ban stays and Alex
  declines plainly instead of asking a fifth clarification question, and a Peer
  declines to compile the group's board because it holds only its own card.
  Three deterministic detectors plus the frozen prompt (`1.7.2 → 1.8.0`), because
  a prompt rule alone has failed at this class of problem three times. The
  collation refusal is Peer-only — a Leader assembling the board is in role —
  which makes it an orthogonality property with regressions in both directions.
  Detectors checked against the verbatim T-C1-027 requests including the ones
  that must not fire. Five regressions, each verified to fail with its own fix
  reverted. build + all four suites green. Does **not** fix the scope Alex
  declines from; that is next.
- 2026-09-07 — T-C1-027 measured (first full real session, 81 messages).
  **B8 confirmed live**: review rate ~10% → 2%, Observer median 6.5 → 5.3 s, and
  the one review carried the new `reason` field. **B1 rolled back**: it left
  `alexRelevance` at `not_relevant` on 50/50 observations, 32 of them alongside
  `explicit_addressee` — incoherent on its face — and `alexParticipation` stuck
  too; both fields follow a removed one in schema order, so the removed fields
  were reasoning scaffold, not just data. Observer `v11→v12`. **D2 done**, and it
  turned out to be load-bearing: D3/D4 were passing vacuously on empty extraction,
  so three messages of six to eight traits shipped against a one-trait guard.
  Four regressions, each verified to fail with its own fix reverted — one vacuous
  first attempt again (it pre-computed the ids instead of driving the real
  generation path) and was replaced with an end-to-end test through
  `generateScopedRouteMessage`. build + all four suites green. Speech quality is
  now the open front; the decline requirement is recorded in §4i.
- 2026-09-07 — T-C1-025 measured; D3/D4 and B8 completed (uncommitted).
  **B4 and D6 confirmed firing in production**, B4 by its exact transition code
  at the exact turn. **D6 also caused a regression and D3 was pulled forward to
  fix it**: with the template no longer bounding the opening turn, generation
  disclosed 16 traits — six of the eight notes Alex alone holds — on message 4,
  and repeated 15 of them with nothing new at seq 7. Attribution is mine; the
  underlying missing guard predates this work (T-C1-020, 15 traits) and D6
  removed the accident that was masking it. D3 adds a one-new-trait budget to
  request-less address/followup turns and D4's hard half bounds restatement;
  both were verified against the verbatim messages that failed. B8 found two of
  three review triggers unwarranted — one dead code, one already repaired by the
  normalizer — and closed a spurious `degradedMode` path on the way. Ten
  regressions; each **live** change verified to fail with its own fix reverted.
  Two vacuous first attempts are recorded rather than hidden: a B8 assertion that
  tested the normalizer instead of the call site (replaced with an end-to-end
  test that counts model calls), and one that cannot be covered at all because
  removing unreachable code is unobservable — said plainly in the test. One
  existing assertion changed, per §6. build + all four suites green.
  Observer overlap designed in §4h; no code written, awaiting a decision.
- 2026-09-07 — B1 completed (uncommitted). The model's output contract is now
  separate from the observation consumers read, so three fields the normalizer
  already discarded left the model contract without changing any downstream
  shape. Observer `v10→v11`, prompt `v8→v9`. Four regressions, each verified to
  fail with its own fix reverted — one was **vacuous on the first attempt** and
  is recorded as such: it asserted against the normalizer's roster filter rather
  than the widening step that actually fills the field, and was rewritten to
  exercise the real code. **Measuring B1 disconfirmed Gate B's premise** (§4g):
  the full field cut is 7% of output, growth falls only +120 → +108, and Observer
  latency does not track output size (r=+0.53 over a 1.4× range, with a 2.5×
  spread in ms per output token; cached calls average slower than uncached).
  B1 is kept as hygiene; the latency target moves to B8 and to overlapping the
  Observer. build + intervention-v2 + ledger + recovery + pooling-extractor green.
- 2026-09-07 — T-C1-024 measured, then D6 and B4 completed (uncommitted in the
  root checkout). **A7 confirmed live**: the pre-broadcast tail fell from
  2.5–3.5 s to 0.2–1.5 s and superseded turns from 39% to 11%, which closes
  Gate A. The Observer is now 66% of turn time and is the whole remaining
  latency budget. **B9 was not exercised** by this session and stays unverified.
  Every silence was `cooldown` over a Judge that had already chosen to
  contribute, which sharpens Gate C3. D6 fixed at three points plus two
  classifier corrections it exposed; B4 added consumption-supersession and a
  TTL backstop, verified by replaying T-C1-024's recorded deltas. Nine
  regressions across `test-intervention-v2` and `test-conversation-ledger`,
  **each verified to fail with its own fix reverted**; one of them caught an
  invalid fixture of mine rather than a code defect (an opportunity may only
  open at the current trigger seq) and was corrected. build + intervention-v2 +
  ledger + recovery + pooling-extractor green; `git diff --check` clean.
  New finding recorded in §4f: reveal ranking ignores information uniqueness —
  2 of 8 disclosed traits were hidden-profile-unique. Flagged, not changed.

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
- 2026-09-07 — Gate 3R complete (uncommitted in the root checkout; backed up on
  the repair branch). Diagnosed from session T-C2-037 (23 decisions, 6 spoken).
  Candidate salience replaces focus as the ranking signal; the decision
  projection drops cooldown-forbidden opportunities; an inert `selectedTraitId`
  is repaired instead of rejected; a second-person plural address resolves to
  every participant and no longer yields an exclusive human floor. Six
  regressions, each verified to fail with its own fix reverted. build + ledger
  + recovery + intervention-v2 green. Cooldown bypass deliberately not added —
  its motivating turn is downstream of the ranking defect. Measured effect
  pending a live replay.
- 2026-09-07 — B9 and A7 complete (uncommitted; backed up). B9 unified the
  "addresses Alex" predicate between the opportunity derivation and the floor
  rule, which required retiring an existing assertion — recorded in the B9 row
  with the narrower invariant that replaces it. A7 replaced the pre-broadcast
  LLM extraction with the deterministic matcher and moved verification to the
  background; on the way it surfaced that the model extractor had been dropping
  Alex's own disclosed misses (T-C2-039 seq 19 and 29), so this is an accuracy
  fix as well as a 2.5-3.5 s one. build + ledger + recovery + intervention-v2 +
  pooling-extractor green. Effect on turn latency not yet measured live.
- 2026-09-07 — T-C1-023 measured on a restarted server. **A6 confirmed
  working**: every spoken turn fits `observer + judge + max(floor, generation)`
  plus a constant 2.5–3.5 s tail, and that tail is the pre-broadcast AI-side
  trait extraction — A7 is now measured, not estimated, and is the largest
  remaining item on the spoken path. Silent turns regressed to 9.5 s because
  Observer output grew 270 → 531 tokens with ledger clutter, which is B1 and B4
  measured from live data. Two new items: B9 (the opportunity derivation and the
  floor rule dispatch on different fields for the same question and contradicted
  each other for three consecutive turns — my Gate 3D omission) and D6 (the
  leader-like agenda line comes from a deterministic template that bypasses the
  output contract, not from generation). No code changed.
- 2026-09-07 — T-C1-022 measured (diagnosis only, no code changed). Silent turns
  held at 6.7 s; spoken turns did not improve, and the arithmetic says A6 was
  not in effect — re-measure on a restarted server. A3 confirmed for the
  Observer (2432–2560 cached) and shown to be structurally impossible for the
  Judge, whose static block is ~785 tokens against a 1024-token cache minimum.
  Two speech regressions traced: a stale thread `requestedAction` frozen at
  "greet participants" made Alex greet the room again mid-session (new B7, and
  it revives the Gate 1 opportunity-keying deferral under B4), and a fact-less
  `follow` — the Gate 3R repair's own side effect — filled Peer turns with
  process direction (Gate D owns it).
- 2026-09-07 — Gate A1–A4 complete (uncommitted in the root checkout; backed up
  on the repair branch). One live observation per session, superseded work
  aborted instead of paid for, and both model prompts reordered for prefix
  caching. Four regressions, each verified to fail with its own fix reverted;
  one redundant guard removed after the check showed it could not fail. A5
  (`floorMs`) untouched pending the user's decision. build + ledger + recovery
  + intervention-v2 green. Measured effect pending a live run.
- 2026-09-07 — Gate 3R measured on two live runs (T-C1-020 Peer, T-C2-039
  Leader). Judge contract failures went to zero (17/17 first-attempt accepts,
  no capitulation, no `ledger_judge_failure`), confirming the repair-not-reject
  change. Salience ranking regressed: a `carried_thread` focus outranked a
  higher-recency candidate and Alex spoke about the wrong one, corrected by a
  participant in-channel. Original Gates 4 and 5 retired and their live items
  folded into a new gate series A–D; see §4b and §4c. Human-side extraction
  retired as a workstream; RAG/vector retrieval considered and rejected for a
  fixed 40-item closed set. No code changed in this session.
- 2026-09-06 — Gate 3 complete (uncommitted in the root checkout). 3a focus
  normalization no longer launders a contradicted focus; 3b trait eligibility
  reads the thread scope with focus as a ranking hint; 3c voluntary `follow`
  legalized with grounded-synthesis evidence. Prompt v4, observer v9. build +
  ledger + recovery + intervention-v2 green; all three fixes revert-checked.
  Diagnosis from T-C2-035: 8 of 10 silences were contract rejections, not
  absence of content. First draft of 3a over-fired and was corrected by an
  existing test — recorded above under Scope note.
