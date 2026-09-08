# Session measurements

Every live session run against the conversation repair, in one place and in one
shape. Twelve entries: three diagnostic sessions that the early gates were built from,
the seven measured rounds of the repair, one partial session run after them, and
one full baseline session run before the 2026-09-08 issues landed.

Each entry says what the session **confirmed**, what it **disconfirmed**, and
what it **did not exercise**. The three are kept apart on purpose. A record that
collapses them turns an expectation into a result, which is how three of the
findings below came to be believed before they were true.

**No participant text appears here, and none may be added.** Sessions are named
by id. Where a message matters, it is named by its seq and described.

Conditions: **C1/C3 = Member**, **C2/C4 = Chair**. Alex holds profile Z in all of
them.

## Summary

| | T-C2-034 | T-C2-035 | T-C2-037 | T-C1-020 | T-C2-039 | T-C1-022 | T-C1-023 | T-C1-024 | T-C1-025 | T-C1-027 | T-C2-041 | T-C2-043 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Condition | Chair | Chair | Chair | Member | Chair | Member | Member | Member | Member | Member | Chair | Chair |
| Messages | 28 | — | — | 51 human | 19 human | — | — | 14 | 8 | 81 | 10 | 50 |
| Decisions | 18 | — | 23 | 51 | 19 | — | — | 9 | 5 | 49 | 6 | 30 |
| Spoken | 10 (56%) | — | 6 (26%) | 18 | 11 | 5 | — | 5 (56%) | 2 | 28 (57%) | 4 | 20 (67%) |
| Median turn | — | — | — | 10.2 s | 12.7 s | — | — | **9.6 s** | — | — | — | 10.0 s |
| Turns superseded | — | — | — | **39%** | 2/19 | — | — | **11%** | — | — | — | 1/30 |
| Observer per call, mean | — | — | — | 6.9 s | 6.8 s | — | — | 6.5 s | — | 5.3 s *(med)* | 5.8 s | — |
| Observer max | — | — | — | 14.3 s | 11.9 s | 13.9 s | 10.5 s | 11.2 s | — | 9.4 s | 7.6 s | — |
| Pre-broadcast tail | — | — | — | — | — | — | 2.5–3.5 s | **0.2–1.5 s** | — | — | — | — |
| Alex words, mean | — | — | — | 43.8 | 55.6 | 30.8 | — | 34 | **138** | **34.7** | 34.5 | **56.0** |
| Max traits, one message | — | — | — | **15** | 6 | — | — | 4 | **16** | — | — | 8 † |
| Judge cache hits | — | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** | — |
| Judge first-attempt accepts | 12/18 | — | — | — | 17/17 | — | — | 8/8 | — | — | 4/5 | — |

A dash means the figure was not recorded for that run, not that it was zero.

† T-C2-043's single largest message carried 26 traits, but it answered an
explicit complete-summary request, which is entitled to the whole board. 8 is the
maximum over every other message.

### Targets

| Metric | Target | Best so far |
| --- | --- | --- |
| Median turn latency | ≤ 5 s | 9.6 s (T-C1-024) |
| Turns discarded as superseded | ≤ 10% | 11% (T-C1-024) |
| Observer share of turn time | — | 66% (T-C1-024) |
| Judge cache hit rate | — | structurally impossible; see T-C1-022 |
| Alex words per message, mean | ≤ 30 | 34.7 (T-C1-027) |
| Max traits in one message | ≤ 2 | 4 (T-C1-024) |
| Wrong-candidate turns | 0 | 0 (T-C1-024) |
| Alex messages with zero new information | 0 | 1 of 4 (T-C1-024) |
| Directive phrasing, Chair : Member | unchanged | 8/11 : 1/18 (first runs) |

The last row is not a target to improve. It is the orthogonality reading, and it
must stay where it is.

---

## T-C2-034 — the diagnostic baseline

Chair, 28 messages, 18 intervention decisions. A symptom sample, not a
specification.

**Confirmed.** Speech rate 10/18 (56%). Five silences had a structural rather
than a semantic cause — the router vetoed on turns where nothing about the
conversation warranted silence. Nine of eighteen turns routed onto an
opportunity id that was already terminal. `focusCandidate` was null at decision
time on 15 of 18 turns. Six of nine generated messages opened with a phrase
naming Alex's own notes as the source.

**Not exercised.** Everything later gates changed. This session predates them.

Recovering the five structural silences would have moved speech rate to 15/18
(83%). That arithmetic is what set the repair's first goal.

**The six root causes diagnosed from it**, each fixed by the gate named:

| | Root cause | Fixed by |
| --- | --- | --- |
| A | An opportunity's id was keyed to its thread's root, so a session could hold only one of a kind, and consuming it killed the whole derivation branch | Gate 1 |
| B | The Judge's retry loop converged on silence: a contract rejection was retried until the model capitulated to `stay_silent` | Gate 2 |
| C | With no focus candidate there was nothing to say, and focus was null on 15 of 18 turns | Gate 3 |
| D | A regex pre-empt ran ahead of the observation and swallowed the context that would have answered the message | Gate B6 (**still open**, issue 06) |
| E | Natural uptake was forbidden by the prompt contract, so Alex could not pick up what a human had just said | Gate 3 |
| F | Extractor miscounting was unobservable, and the agreed design was never wired up | Gate A7 and D2 |

**Measured effect of Gate 2**, which root cause B produced: redundant and
material reducer rejections were split, so an idempotent no-op stopped degrading
the controller — this also repaired a regression Gate 1 had introduced — and a
capitulated silence was given its own reason so it stops reading as a judgement
about content. Forbidding silence on retry was deliberately deferred pending
measurement, and that measurement never happened.

**Attribution correction, made during Gate 1 and kept here:** the first reading of
root cause A claimed nine turns of speech loss. The run shows it cost none. The
keying was left unchanged and instrumented instead, and the defect was later
retired by B4's consumption rule rather than by re-keying. **Check attribution
against the record before ranking a repair.**

## T-C2-035 — the session Gate 3 was built from

Chair, 10 silences examined. Diagnosis only.

**Confirmed.** **8 of 10 silences were contract rejections, not an absence of
anything to say.** That is the finding that turned Gate 3 from "give Alex more to
talk about" into "stop rejecting what it already had".

**Measured effect of the gate built from it (Gate 3):** focus normalisation
stopped laundering a contradicted focus; trait eligibility began reading the
thread's scope with focus as a ranking hint rather than a filter; and a voluntary
follow became legal on grounded-synthesis evidence. Its first draft over-fired
and was caught by an existing test.

**Not exercised.** No latency figures were taken from this session.

## T-C2-037 — the session Gate 3R was built from

Chair, 23 decisions, 6 spoken. Diagnosis only.

**Confirmed.** Speech rate 6/23 after Gates 1–3, which is what made a second
series necessary rather than more of the first.

**Measured effect of the gate built from it (Gate 3R):** candidate salience
replaced focus as the ranking signal; the decision projection began dropping
opportunities the cooldown forbids, so the Judge stopped being offered options it
could never take; an inert selected trait is repaired rather than rejected; and a
second-person plural address resolves to every participant instead of yielding an
exclusive human floor. **A cooldown bypass was deliberately not added**, because
its motivating turn was downstream of the ranking defect.

Gate 3R's effect was measured a session later, in T-C1-020 and T-C2-039 below:
17/17 first-attempt Judge accepts, no capitulation.

**Not exercised.** Nothing about latency, and nothing about the Chair-only
routes.

## T-C1-020 and T-C2-039 — the first two measured runs

Member and Chair on the Gate 1–3R build. 51 and 19 human messages.

**Confirmed.**

- **Gate 3R works where it was aimed.** T-C2-039's ledger Judge accepted on
  attempt 1 on 17 of 17 calls: no failures, no capitulation after rejection. The
  `trait_cleared_for_non_trait_evidence` repair fired 8 times — eight turns the
  old validator would have turned into silence.
- **Condition orthogonality is holding.** Directive phrasing appeared in 8 of 11
  Chair messages and 1 of 18 Member messages, and no mediation route fired in the
  Member session. This is the property every later change must preserve.
- **Turn cost breaks down as Observer 6.8 s (60%) → Judge 1.8 s (16%) →
  generation 2.3 s (20%) → floor 2–3 s.** The Observer is the cost.

**Disconfirmed.**

- **Salience ranking regressed on its own terms.** At T-C2-039 seq 10 Alex spoke
  about Candidate A while the group was on Candidate C, and a participant
  corrected it at seq 11. Two causes: the literal-candidate detector matched a
  bare `A` only before a conjunction or punctuation, so an ordinary sentence
  recorded no mention and salience never learned about A; and focus was placed
  first unconditionally, so a focus of A carried from an earlier thread — an
  inference about an announcement — outranked salience of C, the candidate
  actually under discussion. Recency should have beaten focus.
  → issue 05.
- **The length contract is written and unenforced.** The output contract already
  said at most two sentences, 40 words, one trait. Measured: 44 and 56 words
  mean, and 15 traits in a single message. The guard checked trait counts and
  never length, and the address and followup routes carried no trait bound at all
  unless a request supplied one. T-C1-020 seq 4 released 15 traits on the third
  turn of the session and **that single message collapsed the hidden-profile
  manipulation**. → issue 03.
- **The Judge is not deciding anything.** T-C2-039: `speak` on 18 of 19 turns,
  and every silence was the cooldown applied by the router afterwards.
  → issues 01 and 02.
- **Prompt caching is off.** Judge cached input tokens 0 on every call; the
  Observer cached only its system block. Both prompts placed volatile state
  before the append-only transcript, the inverse of what prefix caching needs.
- **Opportunities never expire.** T-C1-020 accumulated 11 and ended with 3 still
  open; one invitation stayed open for 58 turns.
- **39% of T-C1-020's turns were discarded as superseded.** No later measurement
  could be trusted through that much loss, which is why latency was repaired
  first.

**What these two runs changed about the plan.** The original Gates 4 and 5 were
retired here and their still-live items folded into a new series: latency and
flow, the Observer, the Judge, the generator. Human-side trait extraction was
retired as a workstream. Vector retrieval was considered and rejected for a fixed
40-item closed set — there is nothing to retrieve from.

## T-C1-022 — diagnosis only

Member, on the Gate A build. Nothing was fixed from this run.

**Confirmed.**

- **The Observer review path can double a turn.** One anchor made two calls,
  5.8 s + 6.4 s = 12.2 s of Observer on a single turn. → later fixed as B8.
- **Prefix caching cannot work for the Judge as built.** The Judge's static block
  is ~785 tokens and the provider caches prefixes of 1,024 tokens or more, so
  early-session calls are uncacheable however they are ordered. The Observer's
  block is ~1,815 tokens and caches immediately. Judge calls run 1.0–1.7 s;
  **this is recorded so it is not chased again.**
- **Length improved and the failure moved.** 30.8 words mean, against 43.8. Three
  of five Alex messages carried no candidate information at all.

**Disconfirmed.**

- **A thread's requested action is frozen at creation.** The thread was rooted at
  Alex's own greeting with the action "greet participants", and that string was
  still the thread's action on all seven observations. At seq 10 the generator
  was handed it eight turns into a candidate discussion and Alex greeted the room
  again. In every earlier session the thread happened to be rooted at a human's
  proposal, so the defect was invisible. → issue 07.
- **A thread-root-keyed opportunity id did cost speech.** Gate 1 had deferred it
  on the ground that no observed run showed damage. This run shows it.
- **A contentless follow reads as process direction.** Member Alex directed the
  process at seq 13 on a turn whose selected trait had been cleared by a repair,
  leaving nothing licensed to say. The orthogonality assertions do not catch it,
  because it is not the mediation route. **This settles a question Gate 3R had
  left open**: for a Member, a fact-less follow is not worth saying.

**Not exercised.**

- **A6's overlap could not be measured.** The per-turn arithmetic fit the
  sequential form, not the overlapped one — but the server had never been
  restarted, so the run was on the pre-A6 build. Re-measured in T-C1-023, where
  it fits. **The lesson is procedural: restart the server before a measurement,
  or the measurement is of the previous build.**

## T-C1-023 — restarted server

Member. The first run whose build is known to match the code.

**Confirmed.**

- **A6 is in effect.** Every spoken turn fits `observer + judge + max(floor,
  generation)` plus a constant tail, not the sequential form.
- **The constant tail is the pre-broadcast model call**, measured at 2.5–3.5 s on
  every spoken turn — including one whose message was generated deterministically
  in 0 ms and still carried 3.5 s of tail. Its size is measured, not estimated.
  → later fixed as A7.
- **The Observer's cost grows with ledger clutter.** Output rose 270 → 531 tokens
  monotonically across the session as unclosed opportunities accumulated. Silent
  turns regressed to 9.5 s mean, from 6.7 s.

**Disconfirmed.**

- **The ledger and the floor disagreed inside one observation.** Three
  consecutive turns were vetoed on explicit invitations, because one observation
  said at once that Alex was the explicit addressee — which mints an Alex
  opportunity — and that the addressees were a human only, which is what the
  floor rule reads. Two rules dispatching on different fields for the same
  question. → fixed as B9.
- **Chair-like behaviour came from a deterministic template, not the model.** A
  request for Alex's *additional* items was classified as a request for the whole
  board, routed to a template, and answered with a formatted board recap ending
  in an agenda line. Three problems at once: the intent was misread; the template
  emits a layout the output contract forbids, because deterministic routes bypass
  that contract; and naming what the group has yet to cover is agenda-setting,
  which is Chair behaviour in a Member session. **This is the more likely source
  of the "Alex is mediating like a Chair" impression than the contentless follow
  turns are.**
- **The model trait extractor was under-counting Alex's own reveals.** Checked
  against verbatim messages from two sessions, the deterministic matcher found
  two traits the model extractor had missed in both of two messages. That
  under-count is the exact input the anti-repeat work depends on.

## T-C1-024 — A7 and B9 land

Member, 14 messages, 9 decisions, 5 spoken.

**Confirmed.**

- **A7 works and Gate A is done.** The tail fell from 2.5–3.5 s to 0.2–1.5 s
  across all nine decisions. Turns superseded fell to 11%, from 39%.
- **The Observer is the whole remaining gap.** Median turn 9.6 s against a 5 s
  target; the Observer was 66% of mean turn time and 49–86% per turn.
- **Cooldown is the only silence mechanism.** All three non-greeting silences
  were the cooldown, and in each the Judge had already answered `contribute` with
  real evidence. Judge health otherwise perfect: 8/8 first-attempt accepts.
  → issues 01 and 02.
- **The Observer's cost grows with the backlog, a second time.** Output 384 → 527
  tokens; one invitation open from seq 5 to the end.

**Disconfirmed.**

- **Every Alex message carried a quality defect.** seq 4 was a degenerate
  template output against an empty board — a header promising content followed
  only by an agenda line, because the all-candidates branch was condition-blind
  where the single-candidate branch was not. seq 7 ran 5 sentences and 4 traits
  against a 40-word, 2-sentence, 1-trait contract and recorded no violation.
  seq 13 contained **zero new information**: three of its four items repeated
  seq 10 verbatim and the fourth had been stated by a human two turns earlier.
- **Reveal ranking ignores information uniqueness.** All four of seq 7's traits
  are held by every participant. Alex's only two Z-exclusive items for that
  candidate were spent at seq 10 and repeated at seq 13. Across the session Alex
  disclosed 8 distinct traits, **2 of them unique to its own profile** — and
  uniqueness is the variable the hidden profile turns on. **Not treated as a
  defect**: stating shared traits may be intended common-ground behaviour. This
  is Sumin's to adjudicate, and no change should be made before that.

**Not exercised.**

- **B9 was not verified.** Zero floor-held silences, but no observation produced
  the contradiction B9 fixes, so the absence is not evidence. **Do not record B9
  as live-verified on this run.**

### What this run disconfirmed about the Observer gate itself

Gate B assumed the Observer's ~450 output tokens are mostly padding, and that
cutting them to ~100 cuts latency proportionally. Both halves were tested against
this run's real observations. Neither holds.

- **The output is not mostly padding.** Reconstructing every schema field: 1,001
  and 1,121 characters, roughly 280 dense tokens against a measured 527 — so much
  of the "output" is JSON formatting, which removing a field cannot reclaim.
  Removing every provably-free field gives **7%**. Growth across the session
  falls only from +120 to +108 characters, because most of it is legitimate.
- **Latency does not track output size in this range.** Across nine calls,
  correlation with output tokens +0.53, with input tokens −0.11, with cached
  input +0.09. The per-call ratio spans 8.6–21.6 ms per output token, a 2.5×
  spread: two 488-token calls took 7.3 s and 7.7 s while a 481-token call took
  4.2 s. Cached calls averaged 6.8 s against 6.3 s uncached. Mean 6.5 s with a
  2.1 s standard deviation is consistent with the variance being upstream API
  latency.

**This is the measurement that killed a gate's premise**, and it is why the
Observer accuracy items carry no latency expectation, and why compacting the
carried state was declined (issue 08).

## T-C1-025 — D6, B4 and the schema cut

Member, same opening script, 8 messages, 5 decisions, 2 spoken.

**Confirmed.**

- **B4 fired in production**, at the exact turn and on the exact pair of
  opportunities it was written for: Alex answering a thread retired that thread's
  older standing invitation.
- **D6 changed the routing.** The turn that produced the degenerate recap in
  T-C1-024 now classifies as no request at all and falls through to generation.

**Disconfirmed.**

- **D6 caused a regression, and this is the important finding.** Where T-C1-024
  answered that turn with a bounded 16-word template, the fallthrough to
  generation disclosed **16 traits in 144 words on the third message of the
  session**, six of them from Alex's own profile — then repeated 15 of them with
  nothing new. **The hidden-profile manipulation collapsed on message 4.**

  The attribution matters: D6 is right in itself, but it removed an *accidental*
  cap that had been masking a defect predating this work — the address and
  followup routes carry no trait bound unless a request supplies one. **D6 must
  not ship without D3**, which is why D3 was done immediately rather than in gate
  order.

**Not exercised.**

- **Observer caching went to 0 on all five calls**, where T-C1-024 cached on 4 of
  8. Flagged as suggestive only at n=5, given how erratic caching already was.
  T-C1-027 later recovered to 33/51, so this was the small-sample artifact it was
  flagged as, not an effect of the schema cut.

## T-C1-027 — the first full real session

Member, 81 messages, 50 observations, 49 decisions, 28 spoken (57%). Contains
real participant text; nothing is quoted from it anywhere.

**Confirmed.**

- **B8 holds.** 49 of 50 observations made a single call — review rate ~10% → 2%
  — and the one review recorded why it fired, which earlier reviews could not.
- **Observer median 6.5 s → 5.3 s**, max 11.2 → 9.4 s.
- **Length is solved.** Alex mean 34.7 words, max 68, against 138 and 144 in
  T-C1-025. No dumps.
- B4 and D6 continue to behave correctly.

**Disconfirmed — two defects in this repair's own work.**

- **The Observer schema cut destabilised the Alex-relation fields, and was rolled
  back.** `alexRelevance` came back `not_relevant` on **50 of 50** observations,
  and **32 of those simultaneously reported Alex as the explicit addressee** —
  incoherent on its face, without needing a baseline. The last run before the cut
  was 7 of 8 relevant. Against a measured 7% output saving and no latency effect,
  there was nothing to trade. The two removed semantic fields were asked for
  again; the evidence-sequence cap stayed, since it is the last field of its
  object and was the unbounded accumulator.

  **The explanation given at the time was wrong. See T-C2-041 below.**

- **The reveal guards were passing vacuously on every turn.** Three messages
  shipped carrying six to eight traits each on turns whose guard was correctly
  set to one new trait, and recorded no violation. The model trait extractor ends
  in an empty-array catch, and an empty result is indistinguishable from "this
  message revealed nothing", so **every guard passed whenever extraction failed**.
  The length improvement above is the prompt working, not the guard. Fixed by the
  same move A7 made: the deterministic matcher replaces the model extractor on
  the guard path — network-free, cannot time out, and with no failure mode that
  reads as absence. All three shipped messages are now rejected.

**Re-read 2026-09-08, for issue 01.** Fifteen of the 49 decisions were staged
`cooldown`. **Every one of the fifteen had exactly one human message since Alex
last spoke** — that is, every cooldown-blocked turn in this session was the first
message after an Alex turn.

That kills half of the Observer overlap design. Its fast path was gated on a
conservative test that the turn is *not* the first message after an Alex turn,
because an uptake — which speaks through the cooldown — cannot exist otherwise.
But the cooldown only blocks below two messages since Alex, and a decision turn
always has at least one, so **the only turns the cooldown blocks are exactly the
turns the test excludes**. The fast path would have fired on 0 of 15 here, and on
0 of 2 in T-C2-041. It is arithmetic, not bad luck: with the current cooldown
constant the test can never fire, and it was not built.

What could be taken off the model path is the Judge, which on those same fifteen
turns cost **20.2 s in total, mean 1.34 s** — against **80.5 s of Observer on the
same turns**, which still has to be paid. So the saving on a blocked turn is
about **20%**, not the near-total the gate predicted, and 15 model calls per
session.

**Speech quality, as Sumin read it. This sets the requirement.**

- **Alex accepted a candidate label as its own name.** Asked whether to call it
  "C" or "Alex", it answered that either works. `C` is a candidate identifier;
  accepting it corrupts the board Alex is helping build.
- **Four consecutive turns answered one request with another clarifying
  question**, until the participant wrote that they had hoped the AI could just
  make the table. At one point Alex promised to arrange pasted items and never
  did. Measured cause: the Observer classified all four as a new-information
  request while the lexical classifier read the first as a whole-board request,
  and with an opportunity selected the Observer's reading wins and the classifier
  is never consulted. A narrow scope, plus the layout ban, plus a one-trait cap,
  leaves no legal way to comply — so the model asks instead.
- **Follow-up fragments lose the request.** A two-word answer to a question *Alex*
  asked classifies as no request at all, and nothing carries the original request
  forward. Every turn is re-scoped from scratch.

**Decided with Sumin, and this is the requirement:** the layout ban **stays**.
Alex declines honestly instead of asking another question. A request to collate
everything posted is declined **in the Member conditions** on the honest ground
that Alex sees only its own card. That is an orthogonality point as much as a
tone one — a Member is not the group's aggregator, and claiming a view of the
whole board is false for a Member.

## T-C2-041 — partial session, after the decline and scope work

Chair, 10 messages, 5 observations, 6 decisions, 4 spoken. Session status
`in_progress`; treat every count as partial.

**Confirmed.**

- **The rollback is live.** Observer `v12`, and the re-added field is populated
  where candidates are named.
- **Cooldown pays full price for nothing, now in a Chair session.** Two of six
  decisions were cooldown silences, and **both ran a full Observer (4.9 s, 6.5 s)
  and a full Judge**, which answered `contribute` with a real trait in each case.
  → the direct case for issue 01.
- **The unenforced half of the Judge's cooldown rule is visible here.** Both of
  those Judge calls were voluntary contributions with no selected opportunity —
  the one path where the validator has no cooldown rule at all. The prompt asks
  for the cooldown in prose, nothing checks it, and the Judge answered `speak`
  both times. → the direct case for issue 02.
- **The literal-candidate detector missed a third time, and this time in a Chair
  session.** The observation anchored at seq 6 reported no mentioned candidates,
  while seq 6 names a candidate by a bare letter in an ordinary position. Focus
  fell back to the thread's carried candidate, which **happened to be the same
  letter** — so the miss was masked by an inference that was right by accident.
  → issue 05, which is why both halves are one issue.
- **Gate 3R still holds.** 4 of 5 Judge calls accepted on attempt 1; the fifth
  failed validation on an act that did not match its opportunity's kind and was
  accepted on attempt 2.
- **B8 still holds.** The review path fired 0 of 5. Observer 4.1–7.6 s, mean
  5.8 s.
- **Judge caching is still 0 on every call**, exactly as T-C1-022 explained
  structurally. Not a defect; recorded so it is not re-investigated.

**Disconfirmed.**

- **The explanation for the schema-cut rollback is wrong.** T-C1-027 concluded
  that the removed fields were doing work as reasoning scaffold, because both
  stuck fields sat immediately after a removed field and structured output is
  generated in schema order. If that were the cause, restoring the fields would
  restore the behaviour. **It did not.** With the rollback in effect,
  `alexRelevance` is `not_relevant` on **5 of 5** observations, and **4 of those 5
  simultaneously report Alex as the explicit addressee** — the same incoherence,
  at the same rate, on the restored schema.

  So the schema cut is not the cause. The rollback is still defensible on its own
  terms — the fields cost 7% of output and bought no latency — but **the field is
  stuck for some other reason, and that reason is unknown.** The T-C1-027 text
  has been corrected to say so.

**Not exercised, and not checkable from the export.**

- **The reveal budget could not be audited.** seq 4 is a 59-word Alex message
  naming all four candidates on the second Alex turn — the shape D3 exists to
  prevent — but the intervention record persists no guard fields. `maxTraitIds`,
  the restated bound, and the extracted trait ids are all absent, so there is no
  way to tell from a session export whether the guard was set and passed, set and
  violated, or never set. **The suspicion is recorded as unverified and must stay
  that way until the record carries the guard.** → issue 09.
- The session did not run to completion, so nothing about mediation, summary or
  closing — the three Chair-only routes — was exercised.

---

## T-C2-043 — full Chair session, on the pre-repair build

Chair, 50 messages, 30 decisions, 20 spoken (67%). Ran to completion. Median
turn **10.0 s** over 28 logged turns — **10.9 s spoken** against **7.4 s
silent**, the split issue 01 exists to collapse and issue 10 is waiting on. One
turn superseded (seq 37).

**This session did not run any of the nine issues closed on 2026-09-08.** Every
intervention row carries `promptVersion: 1.8.0`, none carries `outputGuard`, and
the cooldown silences each report a Judge answer — so issues 01–11 are all
absent. It is a **baseline**, and every improvement in it belongs to the build
that preceded them.

**Confirmed.**

- **Salience holds a candidate across turns where focus is null.** At seq 8 the
  observation reported `focusCandidate: null` and the group had named nobody for
  two turns; Alex nevertheless opened seq 9 on Candidate C, the candidate last
  named at seq 5. This is the T-C2-037 failure shape — Alex speaking about A
  while the group eliminates C — not recurring. Salience was already live before
  this branch; the branch changed only its precedence against focus and the
  bare-letter detector, neither of which ran here.
- **Issue 06's defect, reproduced exactly.** seq 5 both drifts from the task
  standard *and* eliminates Candidate C. Alex answered seq 6 with the fixed
  grounding sentence alone, `model: server-deterministic-task-grounding`, and the
  elimination went unanswered — the third occurrence of this shape after
  T-C2-034 seq 5 and T-C2-039 seq 5–6.
- **Length and recital are unenforced, and it shows.** Alex's mean is **56.0
  words** against T-C1-027's 34.7, with a 145-word maximum and 6 of 20 messages
  running over three sentences. **13 of 20 messages exceed the per-turn reveal
  budget** (>1 new or >2 restated traits). One seven-trait set is broadcast
  **three times verbatim** (seq 28, 31, 44) and a second, eight-trait set twice.
  seq 41 restates eight traits and introduces none. → the direct case for issues
  03 and 04, neither of which ran.

**Disconfirmed — a new defect, and the one the operator noticed.**

- **Alex asked a question, was answered, and said nothing.** At seq 16 Alex asked
  an either/or question. seq 17 answered it by naming both options. The turn was
  lost to `ledger_judge_failure`, and the root cause is a chain of three:

  1. **The Observer misread the reply target.** It set `replyToSeq: 15` — the
     human's own earlier message — instead of 16, and
     `relationToPendingAlexQuestion: "unrelated"`, with `addressees: []`.
     Confidence 0.85.
  2. **So no opportunity was minted**, because opportunities require a human
     message that targets Alex. Open opportunities: none.
  3. **The Judge chose an interaction act anyway.** Twice it answered
     `speak / participate / evidence: selected_open_opportunity` with
     `selectedOpportunityId: null`, on a turn whose available-moves block said
     there were none. The validator rejected both
     (`interaction_act_missing_opportunity`, `voluntary_act_evidence_invalid`)
     and the turn was spent.

  **The same observation contradicted itself.** `floor.expectedNext` was
  `["alex"]` — the Observer knew Alex was next — while `addressees` was empty. A
  ledger that says "Alex speaks next" and "nothing here is for Alex" at once is
  the B9 shape again, on a different pair of fields.

  **The deterministic evidence was available and unused.** Alex's immediately
  preceding message was question-like, which `pendingAlexQuestion` already
  computes without a model, and seq 17 is the very next human message. → issue 12.

- **The identical shape succeeded 30 messages later**, which is what makes this a
  model reliability problem rather than a missing feature. At seq 46 Alex asked
  the same kind of either/or clarification; seq 47 answered it; the Observer set
  `replyToSeq: 46`, `direct_answer`, `addressees: ["alex"]`, an opportunity was
  minted, and Alex answered. One field, read two ways, on two instances of one
  pattern.

**Not exercised.**

- Every guard, budget and audit field this branch added. The export cannot show
  whether the 13 budget-exceeding messages would have been caught, because the
  build that produced them had no enforcement and no record — which is issue 09's
  argument, stated by a session rather than by an issue.

---

## Notes on the record itself

**One run is missing.** T-C1-021 appears in T-C1-022's comparison table as the
A1–A4 build and has no entry of its own. Its numbers survive only in that one
row.

**Restart the server before measuring.** T-C1-022's conclusion about A6 was
wrong because the process had hot-reloaded across the change without restarting.
The current working tree has hot-reloaded through roughly ten edits, including
five deliberate breakages made to check that assertions fail. **Restart before
the next measurement.**

**Measure the fields you keep, not only the tokens you cut.** The schema-cut
analysis measured output cost and never asked whether a field carries value after
its own value is discarded. That reasoning turned out to be wrong too — see
T-C2-041 — but the method note stands on its own.
