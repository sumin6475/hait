# Conversation System Repair — Checkpoint

Branch: `claude/hait-conversation-system-errors-0f5e58`
Baseline: `5263f0f` (= `origin/main` at time of writing = production)
Snapshot commit: `362416b` — relocated prior uncommitted work off the `main` checkout.
Last updated: 2026-09-07 (second series)

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

### Gate A — Latency and flow (target: 13 s → 4–5 s median)

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

### Gate B — Observer: read the facts, cheaply and correctly

| # | Change |
| --- | --- |
| B1 | **Shrink the output schema.** The model should return only what is judgeable *this turn*: addressees, speechAct, requestIntent, alexRelation, floor, thread status change, focus. Everything else — roster, participants, scopeCandidates, threadId/rootSeq, and `mentionedCandidates` — is derivable deterministically; `mentionedCandidates` is *already* recomputed by regex in the normalizer, so the model is paying ~450 output tokens per turn to emit fields that are then overwritten. Target ~100 tokens. |
| B2 | **Fix the literal-candidate regex** so a bare `A` is detected in ordinary positions ("lay out A first"). Salience accuracy depends on it. Guard against the English article "a" as the prompt already warns. |
| B3 | **Invert focus vs salience.** Focus wins only when `focusBasis === "current_explicit"`. A `carried_thread` focus is an inference about an announcement and must not outrank the candidate actually being named. Direct fix for T-C2-039 seq 10. |
| B4 | **Opportunity TTL.** Expire an unconsumed `invitation` after N turns or one epoch. Fixes prompt bloat and stale selection together. |
| B5 | **Compact the carried state.** Keep the transcript whole (cache-friendly); pass the previous ledger as a compact delta rather than a full JSON dump. |
| B6 | *(from retired item 11)* Stop the C2 task-grounding regex from bypassing the Observer snapshot, and give C2 a question-form variant. Re-observed at T-C2-039 seq 5–6. |

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
| D2 | **Close the silent guard bypass.** `extractSurfacedTraits` (`poolingExtractor.ts:426`) ends in `catch { return [] }`, and an empty result reads as "this message revealed nothing", so every scope guard passes. It is also called *synchronously on the generation path* (`routeScopedGeneration.ts:213,351`). Represent failure as unknown and fail closed; move or cache the call. |
| D3 | **Per-turn reveal budget as a hard guard.** Give `address` and `followup` a `maxTraitIds`; they currently have none. This is what permitted the 15-trait message. Violations go through the existing repair loop. *(absorbs original item 8 — a permitted brief uptake opener is part of this rewrite)* |
| D4 | **Deterministic anti-repeat.** Inject `revealStats.aiSurfacedIds` as "already stated by you" and forbid restatement outside an explicit full-list request. C profile was recited 4× and D 3× in T-C1-020. |
| D5 | **Add a length post-condition** to `outputScopeViolation()` (sentence and word count), and trim the `outputDiscipline` exception clause ("explicitly requested full list or comparison") that is currently firing on ordinary turns. |

### Measurement targets

| Metric | Now | Target |
| --- | --- | --- |
| Median turn latency | 10.2 / 12.7 s | ≤ 5 s |
| Turns discarded as superseded | 39% (C1) | ≤ 10% |
| Judge cache hit rate | 0% | ≥ 60% |
| Observer output tokens | ~450 | ~100 |
| Alex words per message (mean) | 44 / 56 | ≤ 30 |
| Max traits per Alex message | 15 | ≤ 2 |
| Wrong-candidate turns | 2 (both corrected by a participant) | 0 |
| Directive phrasing, Leader : Peer | 8/11 : 1/18 | unchanged |

### Open decisions blocking work

1. **Gate C**: approve retiring the condition-blind Judge invariant?
2. **Gate A5**: may `floorMs` be tuned? It is 20% of turn time and an experimental design value.
3. `eval/trait_keyword_registry.draft.yaml` is stale — delete, or keep as a
   record with a superseded marker?

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
