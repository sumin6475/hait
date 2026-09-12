# Architecture

What this system is made of, what runs when, and where the same fact is written
down more than once.

`CONTEXT.md` defines the vocabulary and `docs/adr/` holds the decisions. This
file is the map: it says what exists and how the pieces reach each other. It is
descriptive — where the code and this file disagree, the code is right and this
file is stale.

Read §7 before changing anything that counts traits.

**Audited at** `07b0728`, 2026-09-09. Prompt snapshot `1.10.0`.

---

## 1. The experiment, only as much as the code needs

Three participants discuss four airline-pilot candidates and pick one. Two are
human; the third, **Alex**, is the AI under study. Forty traits exist, ten per
candidate, and each participant is dealt a 24-trait **profile** — X, Y or Z.
Alex always holds Z.

The dataset is a hidden profile, and these are the numbers every derived
quantity depends on:

| Candidate | Traits | Shared by all three profiles | Score from shared alone | Score from all forty |
|---|---|---|---|---|
| A | 10 | 4 | **+4** | −2 |
| B | 10 | 4 | **+4** | −2 |
| C | 10 | 4 | **−2** | **+4** |
| D | 10 | 4 | **+4** | −2 |

Each profile holds 24 traits, 8 of them unique to it. **C is the pooled answer,
and the board ranks it last until unshared traits arrive.** Any measure that
reads the board as merit is therefore inverted during the early phase — this is
the whole substance of `docs/adr/0009`, and the reason the candidate list reads
neither score nor coverage. It counts what the humans have pooled
(`docs/adr/0011`) — the board's total cannot tell a leader anything, because Alex
alone can run it up.

Four AI conditions cross role with communication strategy:

| | XAI (states its reasoning) | ACI (asks rather than tells) |
|---|---|---|
| **Peer** | C1 | C3 |
| **Chair** | C2 | C4 |

`CTRL` is a three-human session with no AI; every AI code path checks for it and
returns early.

**Condition orthogonality is the property every change must preserve.** If a
mechanism fires more often in one condition than another for a reason that is
not the manipulation, the comparison is gone. Concretely: the reveal budget,
the extractors, the board, and the candidate list must all be
condition-invariant, and several tests assert exactly that by comparing C1 and
C2 byte for byte.

---

## 2. Processes and topology

Two npm installs, no workspace.

```
client/   React + Vite + Tailwind      → :8080
server/   Express + Socket.IO + tsx    → :3001
                    │
                    ├── MongoDB (mongoose)
                    └── OpenAI-compatible gateway (U-M GPT Toolkit)
```

`server/src/index.ts` is the only entry point. It connects Mongo, mounts five
Express routers, attaches Socket.IO, and calls `registerSocketHandlers`. There
is no queue, no worker, and no cron: **everything happens inside the socket
handler for a human message, or on a timer armed by it.**

### Models used at runtime

| Model | Written by |
|---|---|
| `Session` | sockets, `poolingDV`, `poolingTally`, `seq`, `koPilot`, `codeGen`, `routeTurn`, `interventionEngine`, `routes/sessions` |
| `Participant` | sockets, `conversationObserver`, `routes/participants`, `routes/sessions` |
| `Message` | sockets, `routeTurn`, `interventionEngine`, `conversationObserver`, `routes/sessions` |
| `AIIntervention` | `interventionEngine`, `routeTurn`, `routes/sessions` |
| `ConversationObservation` | `conversationObserver`, `interventionEngine`, `routes/sessions` |
| `Condition`, `InfoItem` | **nothing** — see §8 |

### Language models

| Call | Model | Where |
|---|---|---|
| Alex's visible message | `gpt-5-mini` | `openai.callAIStructured` default |
| Conversation Observer | `gpt-5-mini` | `conversationObserver` |
| Main Judge / ledger judge | `gpt-5-mini` | `interventionJudge` |
| Follow-up, uptake, signal judges | `gpt-4o-mini` | respective files |
| Bounded trait verifier | `gpt-4o-mini` | `poolingExtractor.verifyHumanTraitCandidates` |

## Comparison-run guard flags

Five checks that change what a turn may be can be switched off for a paired run,
via `server/.env` — `HAIT_GUARD_OUTPUT_SCOPE`, `HAIT_GUARD_COOLDOWN`,
`HAIT_GUARD_HUMAN_FLOOR`, `HAIT_GUARD_JUDGE_BRIEF`, `HAIT_GUARD_IMPLICIT_REQUEST`,
all defaulting to on (`server/src/lib/guardFlags.ts`). The first four each cost
Alex a turn; the fifth costs it a *reason* to take one. T-C4-023 lost seven of twenty-nine turns to
four different vetoes; which of them earn their cost is a measurement, not an
argument. Whatever is off is written to every intervention row as
`disabledGuards` and printed at startup, so a comparison transcript always says
so.

**A flag has to reach every site of its check.** The human floor had four
readers, and only one of them was flagged:

| reader | what it decides | was flagged |
| --- | --- | --- |
| `deterministicVetoBeforeJudge` | whether the Judge is called at all | yes |
| `ledgerSpeechBlockedByHumanFloor` | whether the Judge's decision survives | no |
| `opportunityMayBypassCooldown` | whether an invited opportunity is offered | no |
| the leader drift gate (inline read) | whether a Chair corrects task drift | no |

T-C2-050 ran with `HAIT_GUARD_HUMAN_FLOOR=off` and still lost three turns (seqs
26, 27, 41) to `ledger_router_human_floor_held`: the turn reached the Judge, the
Judge chose to speak, and the second reader threw the decision away. The other
two were found by review afterwards — the third attributes its loss to the
cooldown in the silence audit, and the fourth used a different definition
entirely (`transition === "held"` regardless of holder, so Alex's own floor
counted).

There is now one predicate, `floorHeldForDecisions` in `conversationLedger.ts`,
and `humanFloorHeld` is the unflagged reading it wraps. `test:conversation-ledger`
asserts that no module outside `conversationLedger.ts` calls the unflagged form,
so a fifth reader cannot appear silently.

`docs/adr/0005` forbids swapping the speech model for latency; it says nothing about the
Observer or the Judge, both of which moved to `gpt-5-mini`.

A reasoning model rejects `temperature` and needs output headroom for its hidden reasoning
tokens. `openai.modelRequestParams(model, maxOutputTokens)` decides those fields from the model
name, and every direct call site uses it — so a model swap can no longer break a request shape,
and the recorded parameters cannot disagree with what was sent.

---

## 3. What happens when a human sends a message

`sockets/index.ts` `send-message`, in order. Everything after the broadcast is
deliberately off the visible path.

```
 1  validate (non-empty, ≤2000 chars)
 2  reserveLedgerTurn(sessionId)      serialize deterministic persistence only
 3  allocHumanSeq                     atomic seq + conversationEpoch
 4  Message.create                    sharedInfoIds: []
 5  io.emit("new-message")            ← the humans see it here
 6  startTurnTrace
 7  noteHumanMessageArrival           (awaited: lets a live turn cancel/queue)
 8  extractHumanTraitsFast            synchronous, network-free
 9  ── detach ──────────────────────────────────────────────
      a  updateRevealStats(accepted)  board + firstBy;  release the ledger turn
      b  verifyHumanTraitCandidates   model call, late
      c  updateRevealStats(verified) + Message.declinedTraitIds
10  enqueueConversationObservation    async, serial per session
11  onHumanMessage                    the speech decision (§4)
```

Two things about this order carry weight:

- **The humans never wait for trait accounting.** The fast matcher is
  deterministic and cannot time out, so its result is available at step 8; the
  verifier's correction lands whenever it lands.
- **`onHumanMessage` receives `pendingHumanTraitIds`** — the fast ids as a
  current-turn overlay — because the board write in (a) may not have committed
  when the speech decision reads it.

---

## 4. How Alex decides to speak

`interventionEngine.ts` holds one in-memory `RuntimeState` per session code.
It is not persisted; a server restart re-derives it in `initializeRuntime`.

### Controller modes

`CONVERSATION_CONTROLLER_MODE` selects one of three. **`ledger_active` is the
default and the live path.**

| Mode | Behaviour |
|---|---|
| `ledger_active` | The ledger judge decides. Deterministic vetoes apply. |
| `ledger_shadow` | The ledger runs and is recorded; live speech uses the legacy rules. |
| `legacy` | Pre-ledger routing only. Rollback path. |

`CONVERSATION_OBSERVER_MODE` is `active` / `shadow` / `off`, default `active`.

### The ledger path

```
onHumanMessage
  ├ superseded?                    latestPushSeq moved on → drop
  ├ busy?                          queue as pendingPostGenerationSeq → re-enter later
  ├ waitForConversationObservation  gpt-5-mini, serial per session (~7 s)
  ├ updateMediationState / armSummaryIfEligible
  ├ task-grounding drift + Chair → mediation, and return
  └ judgeLiveLedgerTurn
        ├ observerDeltaFromTurn      threads + opportunities, deterministic
        ├ deterministic veto         human floor held | cooldown   (ADR 0001)
        └ ledger judge               act + evidence + selectedOpportunityId
             → reserveTurn(routeKind, floorMs, …)
```

`reserveTurn` starts a **floor timer** rather than the work. During the pause
the turn is still retractable (`ai-typing` is already true); when the timer
fires, `reservation` clears and `busy` is set, and the turn is committed to
generation. This is what makes a consecutive AI turn structurally impossible
rather than merely improbable.

#### Where Alex's lean is decided

Alex's read of the candidates is computed from Alex's whole card plus the board,
every requirement weighing the same (`decidePreferenceFromKnownCoverage`). It
reaches two places, and they read the same function on the same board, so they
cannot name different candidates:

| reader | what it gets | when |
|---|---|---|
| the Judge's turn facts | the whole order, tied candidates grouped, no numbers | every turn a board exists, every condition |
| the generator's preference cue | the leaders, with wording | closing; address/followup on four request kinds; peer build-on |

**The Judge's line was added because the cue's gate is narrow.** In T-C2-051 seq
24 a participant asked *"Alex, why do you think D is the best?"*. Alex had never
said D was best. It answered "My current read is Candidate D", taking the lean
from the question's premise, while the server had A and D level at that moment
and A ahead by seq 37. The cue did not disagree with that turn — it was absent:
the turn was classified as no request at all, and across the whole session the
cue fired zero times. Nothing carried a lean, so the model supplied one.

**The whole order, not the top of it,** because narrowing is the Judge's call. At
seq 27 the group narrowed to A and B; the leader alone says nothing about which
of those two Alex is closer to.

Condition-blind, unlike the coverage note. Holding a view of the candidates is
not owning the discussion procedure — the role goal already decides whether Alex
offers it unasked or waits to be asked.

#### What the leader's list counts

A candidate leaves the live list when a **human** has put something about it on
the board that Alex does not hold — one trait off a participant's own card
(`POOLED_ENOUGH`, `humanPooledIds`). Coverage and score are computed beside it,
recorded, and decide nothing.

The bar this replaced was coverage 5 over the whole board (`docs/adr/0009`).
Alex holds six traits per candidate, so Alex clears five alone, and it did:
across T-C2-050 and T-C2-051 all eight removals were Alex's own disclosures and
none was a human's. At T-C2-051 seq 23 the Chair's Judge was therefore told there
was no coverage gap to name while fifteen human-held traits were unsaid, and Alex
passed that on to the room. Under the rule now in force, C — the pooled answer,
and the one candidate the humans pooled nothing about — stays on the list to the
end of both sessions. See `docs/adr/0011`.

**The list is no longer shadow.** `leaderCoverageNote` turns it into one line of
the Chair's Judge input; peers receive null from the same function, which is the
status manipulation and not an optimisation. `test:intervention-v2` pins the set
of files allowed to read the list at all.

#### What opens a request

A question addressed to Alex or to the room opens one. A proposal opens one only
when the Observer marked it an **explicit** request; an implicit proposal is an
opinion and opens nothing (`proposalOpensRequest`). Both readers now agree — the
Observer's own obligation snapshot has always required `explicit`
(`pendingAlexObligationFromObservation`), and only the ledger branch did not.

The drift was not cosmetic. At T-C2-051 seq 29 a participant said that being
moody is not something you can neglect when lives are at stake; the turn minted
an invitation, and because the Judge must say what a selected request wants, the
brief read *"They asked why D would be the best"* — a question nobody asked.
Replaying both sessions' recorded observations through the reducer, the rule
removes four requests from T-C2-051 (seqs 18, 21, 29, 33) and three from
T-C2-050 (seqs 19, 30, 36) and adds none; every one of the seven is a statement
of opinion or of the speaker's own choice.

**The cost is the act, not the wording.** Five turns were built on a request
nobody made (T-C2-051 seqs 23, 31, 34; T-C2-050 seqs 20, 31) and in all five the
writer dropped or repaired the false half on its own, because the generator is
handed the source utterance rather than the brief alone — `requestedAction` was
removed from both the opportunity block and the Judge's prose situation for that
reason. What does not repair is the choice: a listed request outranks every
voluntary act, so while one stands the Judge cannot take up what the humans just
said. At T-C2-051 seq 22 a participant argued that A's danger-recognition matches
B's composure, and the reply engaged with none of it.

#### What the Judge is told about Alex's own card

The Judge receives the unsurfaced part of Alex's card that falls inside the
foreground thread's scope, ranked by what the group is currently on
(`eligibleTraitIdsForLedgerState`). That list carried one fact only as an
absence: which candidates Alex has **nothing further** on. In T-C2-050 seq 19 all
six of Alex's Candidate A traits were already on the board, the group came back
to A, and the Judge emitted `["A"]` — the bare candidate letter — where a trait
id goes; the decision was rejected and the turn broadcast nothing.
`exhaustedCandidateNote` now states the absence as a sentence beside the other
per-turn facts ("Your card: …"). It is gated on `liveForegroundThread`, the same
test the eligible list is built under: the list is *also* empty when the
foreground thread has been resolved or superseded, and reading that emptiness as
exhaustion told the Judge every candidate was spent while Alex still held all
twenty-four of its traits. One accessor, so the sentence and the list it
describes cannot disagree.

**Both board-derived sentences require a board.** `revealStats` has been
documented as "absent means no note is added" since it was added and did not do
it: coverage zero for all four candidates reads as *the group has said little
about every candidate*, so an absent board produced a fabrication rather than a
silence. A live session always has one (`Session.revealStats` is defaulted at
creation), so nothing on the speaking path loses a note. The caller that passes
nothing is the offline replay eval — and its corpus records `sharedInfoIds` as
empty on **all 1451 messages of all 41 sessions**, because the pilot export it
was built from never carried the field's contents. That run now reports how many
turns carried a board (zero today) and says in its own report that decisions
turning on which trait Alex may name are not scoreable from it. Separately, a retry that trips a
trait-eligibility rule is handed the eligible ids rather than only the rule code:
at T-C2-050 seq 14 the first attempt named a trait spent eight seqs earlier, and
the retry — given only the rule name — repeated it and added `C_p2`, which is on
no card Alex holds, losing the turn to `ledger_judge_failure`. Both are condition-blind: this is Alex's own card, which
every condition already receives in full. `leaderCoverageNote` on the adjacent
line reports the *group's* coverage and is the leader's alone — that asymmetry is
the manipulation and stays.

### Route kinds

`address · followup · long_silence · build_on · mediation · backchannel ·
greeting · summary · closing`

**Three of them are Chair-only, and that asymmetry is part of the manipulation.**
The prompt registry holds 6 routes for each peer condition and 9 for each chair
condition — 30 in total — because `mediation`, `summary` and `closing` exist
only for C2 and C4. The boundary is re-established at three separate places so
a peer can never reach them:

- `armSummaryIfEligible` returns immediately unless the condition is a Chair
- `ledgerRouteKindForAct` maps a `mediate` act to `build_on` for a peer, with
  the comment that the Judge is deliberately condition-neutral and the boundary
  belongs at the routing seam
- `triggerClosing` sends a Chair through `executeRouteTurn` and a peer through
  `broadcastPeerClosing`, a fixed string with no model call

Four route kinds **do not move the board** — a greeting and a backchannel carry no
trait, and the summary and closing recite what is already up. That set is
`NON_CONTRIBUTING_ROUTES` in `server/src/types.ts` and is the single source for
three separate decisions (§7c).

### Other ways Alex speaks

Not every turn comes from a human message:

- **long silence timer** — `scheduleLongSilence`, capped at 3 broadcasts and 5
  minutes apart
- **summary** — armed by elapsed time, human-message count and surfaced count
- **closing** — deadline or manual `stop-ai`, with `broadcastClosingFallback`
  and `broadcastPeerClosing` as deterministic fallbacks that bypass generation

---

## 5. Generating one message

`routeTurn.executeRouteTurn` is the only path that puts an AI message on the
board in the live system. In order:

```
  session / lifecycle / anti-double-post checks
  buildRouteUserContext            → developerPrompt + transcriptPrompt + guard
  previouslySurfacedTraitIds       revealStats ∪ every message's sharedInfoIds
  candidateListAudit               computed, recorded, read by nothing (ADR 0009)
  deterministic response?          → skip the model entirely
  generateScopedRouteMessage       ≤1 repair attempt
  commitGuard / lifecycle re-check
  broadcastExtraction              fast matcher OR the guard's ids + leftovers
  Message.create → AIIntervention.create
  io.emit("new-message")           ← the humans see it here
  ── after the broadcast ─────────────────────────────
  updateAiSurfaced + Message.sharedInfoIds
  verifyHumanTraitCandidates → the same two writes again
  recordSurfaced                   AIIntervention.surfacedTraitIds (+ violation)
  onBroadcastSuccess               ledger consumption
  AIIntervention → outcome "broadcast"
```

**A turn becomes real at the broadcast, not at generation.** Nothing that
records a disclosure runs before the emit. Every earlier exit — a failed guard,
a supersession, a lifecycle cancel — returns before `Message.create`, so an
opportunity stays open and nothing is counted as said.

### The three prompt layers

| Layer | Source | Changes per turn |
|---|---|---|
| System | frozen snapshot, 30 keys, sha256-checked at import | no |
| Developer | `buildRouteUserContext` blocks | yes |
| User | transcript + "return only Alex's next message" | yes |

The system prompt is compiled: `src/prompts/blocks/*.ts` →
`npm run prompts:compile` → `route-prompts.snapshot.v1.json`.
`routePromptRegistry` recomputes every hash at import and throws on mismatch,
and asserts there are exactly 30 entries — 6 routes × 2 peer conditions plus
9 routes × 2 chair conditions. **Those 30 entries hold four distinct prompts.**
Every route within a condition compiles to byte-identical text, and the route
contracts in `blocks/route-contracts.ts` are enumerated but never appended, so
what differs by route is built per turn by `buildRouteUserContext` and nothing
else. Editing a prompt therefore changes
`promptVersion`, and **sessions on either side of the change are not directly
comparable.**

### The output guard

`buildRouteUserContext` returns at most one `RouteOutputScopeGuard`, chosen in
this precedence:

```
requestScope.guard                          an explicit request sets its own scope
  ?? withRouteRevealBudget(
       selectedContributionGuard            build_on with a chosen note
       ?? routeSinglePointGuard             build_on under focus depth
       ?? mediationNoNewTraitsGuard         mediation introduces nothing
       ?? focusGuard)                       stay on the focus candidate
```

`ROUTE_REVEAL_BUDGET` is `maxTraitIds 1 · maxRestatedTraitIds 2 ·
maxSentences 3 · maxWords 80`, applied only to `address`/`followup` turns whose
request intent is `none` — an ordinary turn nobody asked anything on.

`outputScopeViolation` is checked against the draft; a violation triggers one
repair attempt, and a second failure **costs the turn** rather than broadcasting
an oversized message.

---

## 6. Trait accounting

Two extractors, on purpose.

| | `extractHumanTraitsFast` | `verifyHumanTraitCandidates` |
|---|---|---|
| Kind | keyword + lexical near match | bounded model call |
| Sync | yes, network-free | no |
| Cannot | be wrong about an exact quote | time out silently into "nothing" |
| Returns | `acceptedIds` + `verificationCandidates` | confirmed ids |

The split exists because **an extractor that can fail is an extractor whose
failure reads as "this message was fine"** — that is what let three oversized
messages ship in T-C1-027 — and because T-C1-024 measured the model extractor at
2.5–3.5 s on the broadcast path. So: the deterministic one decides, the bounded
one corrects afterwards.

### Open vs closed question

A human's sentence could be about any of the forty traits or none, so a near
match is referred to the verifier. **Alex's own message is a different
question**: the turn named what Alex was permitted to say, so a near match on
one of those ids has no rival reading and is accepted outright
(`routeScopedGeneration.disclosedTraitIds`). Near matches on ids the turn was
*not* permitted to say are carried through to the post-broadcast verifier.

### Where "a trait was said" is written down

Eight places. This is the largest seam in the system.

| Field | Who writes it | Scope |
|---|---|---|
| `Message.sharedInfoIds` | both paths | per message, final |
| `Message.declinedTraitIds` | both paths | matcher found, verifier declined |
| `revealStats.byCandidate[c].revealedIds` | **human path only** | per candidate |
| `revealStats.humanConfirmedIds` | human path | the group's shared knowledge |
| `revealStats.aiSurfacedIds` | **AI path only** | Alex's contribution (DV) |
| `revealStats.firstBy[traitId]` | both | who said it first, and when |
| `AIIntervention.outputGuard.traitIds` | AI path | the guard's pre-broadcast evidence |
| `AIIntervention.surfacedTraitIds` | AI path | what the message actually carried |

The last two are deliberately separate and answer different questions (§7b).
`revealStats.byCandidate` and `aiSurfacedIds` are deliberately separate because
Alex's disclosure rate is a dependent variable and must not be mixed into the
humans'.

**Nothing reconciles them.** No job checks that `Message.sharedInfoIds` for AI
messages equals `aiSurfacedIds`, or that `firstBy` agrees with either.

---

## 7. The seams

A seam is one fact written in more than one place with nothing checking that the
copies agree. Every bug found in the conversation-repair work so far has been
one. They are listed with what they cost, because the cost is the argument for
the lock.

### 7a. The wording of a trait — **locked**

Four copies: the cards participants read (`client/src/lib/mockData.ts`), the
card in Alex's system prompt (the frozen snapshot), `TRAIT_DB` (what everything
is matched and counted against), and the approval record
(`server/src/eval/trait_keyword_registry.draft.yaml`).

They had drifted on **11 of 40 traits**. T-C2-047 turn 9: Alex was told to
contribute `C_p6`, wrote its own card's wording twice, and the matcher was
looking for a sentence nobody had ever been shown. The turn died as
`selected_trait_missing` — Alex's only unique note about the pooled answer.

Locked by a three-way comparison in `test-intervention-v2`, entry by entry, and
`trait_keyword_registry.draft.yaml` has its own approval check. A trait's own
canonical text is now always the first phrase in its matcher entry, so quoting
the card verbatim can never match nothing.

### 7b. The guard's evidence vs. the record of a message — **locked**

The guard decides before the broadcast, where only the deterministic matcher may
run; the board is written afterwards, once the verifier has settled the near
matches. One field held both answers.

T-C2-047 seq 36 named `A_p4` in the pool's own words and `B_p3` in near ones.
The turn's record said one, the board said two. And on a **guarded** turn the
near matches were discarded entirely, so the verifier never ran on the one class
of turn where Alex actually discloses — that turn only escaped because it
happened to carry no guard.

Now `outputGuard.traitIds` (evidence) and `surfacedTraitIds` (record) are
separate fields, the leftovers reach the verifier, and a delivered message that
breaks a bound is recorded as `postBroadcastViolation`. Counted by
`npm run report:budget`. Locked by source-order assertions that no model call
moved in front of the emit.

### 7c. The routes that do not move the board — **locked**

Three hand-written copies of one four-element list, deciding three different
things. The third copy was written an hour after the second, in the session
that was fixing 7.1. It made the reveal-budget report count every summary and
closing as a turn missing its record.

Now `NON_CONTRIBUTING_ROUTES` / `contributesToBoard` in `types.ts`, and a test
refuses any list in `src` that names all four. A list naming only *some* of them
is a different question and is left alone — `routeTurn` skips the observer wait
on three of them, and a backchannel does wait.

### 7d. "The board" spelled out six more times — **locked**

`allSurfacedIds` (informationPools) is the definition of the board. Six other
places spelled it out again: `countSurfaced`, `surfacedByCandidate`, `floorMet`,
`leastCoveredCandidate` and `computeTally` in `poolingTally`, and
`computePoolingDV` in `poolingDV`. None of them read `informationPools`. They
were not wrong — they were the shape that cost T-C2-047 turn 9, one edit away
from being wrong.

All six now read `allSurfacedIds`, `humanSurfacedIds`, `aiSurfacedIds` or the
new `coverageByCandidate`. A test refuses any file outside `informationPools.ts`
that reads `revealStats.aiSurfacedIds` or `revealStats.byCandidate` off a plain
object, and checks every reader agrees on a board where a human and Alex have
both said the same trait.

**The one place the two sets are deliberately not unioned is the pooling DV.**
Alex's contribution rate is a dependent variable; mixing it into the humans'
would destroy the measure. `computePoolingDV` now names the two sets instead of
spelling them out, so the separation is explicit rather than incidental.

### 7e. The discussion duration — **locked**

The server closes the session on `DISCUSSION_DURATION_MS` and the client counts
down on `DISCUSSION_DURATION_MINUTES`. Both files carried a comment saying they
must match and nothing checked it; divergence is visible to the participants,
whose on-screen timer would stop agreeing with the turn Alex closes on.

`client/` and `server/` are separate npm installs with no shared package, so
neither can import the other. `test:intervention-v2` reads the client file and
compares, the same way the trait wording is locked against the participants'
cards. `MIN_DISCUSSION_MINUTES` next to it is client-only and has no server
counterpart to disagree with.

### 7f. The admin test-chat is a second, divergent pipeline — **open**

`POST /api/conditions/test-chat` hand-assembles its own `revealStats`, calls the
**retired** `extractSurfacedTraits` (the LLM extractor) for AI messages while the
live path uses the fast matcher, and passes the combined `userPrompt` where the
live path passes `developerPrompt` + `transcriptPrompt` separately.

So the admin preview does not reproduce live behaviour, and its output should
not be read as evidence about the live system.

### 7g. Alex's declined candidates — **locked**

On the human path a candidate the verifier declines has been written to
`Message.declinedTraitIds` since issue 15, after T-C2-045 lost two traits to a
silent decline. Alex's own near matches only began reaching the verifier in
issue 25, and arrived with the same blind spot.

Both paths now write the same field with the same meaning, after the broadcast.
A test asserts the write exists on both and that Alex's is behind the emit.

### 7h. The export projection vs. the schema — **locked**

`GET /api/sessions/:code/export` is a hand-written projection of the intervention
schema, and nothing checked the two against each other. Five recorded fields
never reached it: `owedRequestIds` (issue 17 added it so the largest silence
class would say what the group was still waiting for), `outputGuard`,
`surfacedTraitIds`, `postBroadcastViolation` and `candidateList`. The server
wrote all five and every analysis that reads the export saw none of them.

All five are exported now. A test compares the projection against the schema:
a field is either named in the projection or named in the test's not-exported
list with a reason, and adding one to the schema and neither place fails.
`routes/sessions.ts` joins the shadow-only allowlist for `candidateList` — it may
copy the recorded value out, which is what a shadow derivation is written for,
and a second assertion forbids it computing one.

### 7i. `Session.metadata` counters — **open**

`totalTurns` / `humanTurns` / `aiTurns` / `durationSeconds` exist on the schema
as cached counters. They are a second copy of what counting `Message` rows
gives, and the legacy `candidateStats.positiveRevealed` / `negativeRevealed`
next to them are already marked as no longer written. Read carefully before
trusting either in an analysis.

---

## 8. Code that is not used

Ten files and about twenty exports were deleted on 2026-09-08 (`-786` lines).
What remains is listed here so the next reader does not have to re-derive it.

### Deleted

| What | Why it was misleading |
|---|---|
| `lib/aiTurn.ts` | A complete second AI speech path (`handleAITurn`, 319 lines), imported by nothing. It still called the retired `extractSurfacedTraits` and wrote `aiSurfacedIds` **without** updating `Message.sharedInfoIds`, so a board built from its turns and one built from messages would not have agreed. A grep for "how does Alex speak" returned two answers. |
| `triggers/` (7 files) | The pre-`interventionEngine` trigger system. |
| `models/Condition.ts`, `models/InfoItem.ts` | Conditions live in the prompt snapshot; traits live in `TRAIT_DB`. |
| ~20 exports | `AIResponseSchema`, `ALEX_Z_UNIQUE_IDS`, `TRAIT_KEYWORD_BY_ID`, `splitAiContribution`, `recordFollowupObservation`, `formatMainJudgeSignal`, four `…FromVisibleCoverage` / `…FromConfirmedCoverage` aliases, and — once `aiTurn` was gone — `computeTally`, `formatTally`, `anyCandidateMentioned`, `countSurfaced`, `floorMet`, `leastCoveredCandidate`, `underCoveredCandidates`, `maybeKoLang`, `getSessionLang`. |

Deleting `aiTurn.ts` orphaned a second layer, which is the point: half of
`poolingTally` was alive only because the dead path called it.

### Still present and not reached from `index.ts`

| File | Why it stays |
|---|---|
| `lib/questionUptakeJudge.ts` | Not wired into the controller, but `npm run uptake:cases` and `uptake_cases.yaml` exercise it. Deleting it would delete a working measurement, which is a different decision from removing dead code. |
| `lib/prompts.ts` | The pre-snapshot prompt system. Three eval harnesses still import from it — `eval-scenarios`, `test-prompts`, `run-golden` — so it is quarantined rather than dead. Six of its exports (`buildNaturalPrompt`, `buildLeaderDepth`, `buildPeerDepth`, `buildCalloutTail`, `buildSummaryPrompt`, `buildUserPrompt`) are referenced by nothing and can go with the goldens whenever those are retired. |

### Exported for tests only — intentional, not dead

Roughly sixty exports are used by `scripts/` or `eval/` and by no other runtime
file. That is generate-or-lock-with-tests working: a pure function is exported
so a test can pin it. `NON_CONTRIBUTING_ROUTES`, `POOLED_ENOUGH`,
`DERIVED_COUNTS`, `coverageByCandidate`, `evaluateDraft`, `outputGuardAudit` and
the judge validators are all in this group and should stay exported.

A further handful — `FOLLOWUP_WINDOW`, `PARTICIPANT_LABEL`, `deterministicRateGate`,
`isRedundantRejection`, `buildCueSnippet`, `wordCount`, `knownTraitIds`,
`NO_REQUEST_INTENT` — are used only inside their own file. Over-exported, not
unused. (`ledgerSpeechBlockedByHumanFloor` left this group when the floor flag
reached it: `test:conversation-ledger` now pins both sides of that flag.)

## 9. Modes, flags and environment

| Variable | Default | Effect |
|---|---|---|
| `MONGODB_URI` | required | |
| `OPENAI_API_KEY` / `OPENAI_API_BASE` | required | U-M GPT Toolkit gateway |
| `ADMIN_TOKEN` | required | `x-admin-token` on every admin route |
| `PORT` | 3001 | |
| `CORS_ORIGIN` | all | comma-separated |
| `CONVERSATION_CONTROLLER_MODE` | `ledger_active` | §4 |
| `CONVERSATION_OBSERVER_MODE` | `active` | `shadow` records without steering |

---

## 10. What is locked, and by what

Offline, no network, no database:

| Command | Locks |
|---|---|
| `npm run test:intervention-v2` | 5 184 lines. Routing, guards, the trait-wording three-way comparison, the candidate list and who may read it, broadcast ordering, the non-contributing route list, transcript replays of real sessions |
| `npm run test:pooling-extractor` | The fast matcher against pinned real messages |
| `npm run test:conversation-ledger` | The deterministic reducer |
| `npm run test:conversation-gold` | Gold-corpus schema and attribution |
| `npm run docs:check` | Cross-references resolve; the glossary is well-formed |
| `npx tsc --noEmit` | |

Network or corpus:

`npm run eval:traits:corpus` · `judge:cases` · `observer:cases` ·
`uptake:cases` · `eval:followup` · `golden` · `eval:conversation:smoke`

Reporting: `npm run report:budget` — reveal-budget violations per session and
per condition, ids and counts only.

Three source-level assertions in `test-intervention-v2` deserve naming, because
they lock *structure* rather than behaviour and are the only defence against the
class of bug in §7:

1. **shadow-only** — no file outside an allowlist may read `candidateList`
2. **broadcast ordering** — every pooling write and every model call appears
   after the emit in `routeTurn.ts`
3. **one list** — no file may test a hand-written copy of
   `NON_CONTRIBUTING_ROUTES`

---

## 11. Decisions this architecture assumes

| ADR | In one line |
|---|---|
| 0001 | The condition reaches the judge; deterministic vetoes sit off the model path |
| 0002 | Trait matching is deterministic |
| 0003 | Decline rather than defer |
| 0004 | Salience ranks opportunities |
| 0005 | No model swap for latency |
| 0006 | A request outlives its turn |
| 0007 | Status is ownership of the candidate list |
| 0008 | The list is computed from the board |
| 0009 | The list measures attention, not merit |
| 0010 | The Judge owns what a turn may spend |
| 0011 | The list counts what the humans pooled |

---

## 12. Open threads

- **Nothing since prompt 1.10.0 has been observed in a live session.** The trait
  wording, the closed-question accounting, the unsaid-notes block and the
  record/evidence split are all locked by offline tests only.
- Seams §7f and §7i above.
- `.scratch/conversation-repair/issues/` and `.scratch/leader-decision-frame/`
  hold the open work items; `docs/measurements.md` holds what has actually been
  measured.
