# Session measurements

Every live session run against the conversation repair, in one place and in one
shape. Thirteen session entries: three diagnostic sessions that the early gates were built
from, the seven measured rounds of the repair, one partial session run after
them, and one full baseline session run before the 2026-09-08 issues landed. One
further entry records a golden baseline, which is not a session.

> **Count out of date (2026-09-14).** The entries run past T-C2-045, and this
> paragraph and the summary table were not kept up with them. T-C2-051 and
> T-C2-052 are not recorded here.

One further entry, T-C3-003, is a message export rather than a measured session
and is the only aci material in this record. T-C2-047 is the first Chair session
run on a repaired build, and it did not reach its closing.

Each entry says what the session **confirmed**, what it **disconfirmed**, and
what it **did not exercise**. The three are kept apart on purpose. A record that
collapses them turns an expectation into a result, which is how three of the
findings below came to be believed before they were true.

**No participant text appears here, and none may be added.** Sessions are named
by id. Where a message matters, it is named by its seq and described.

Conditions: **C1/C3 = Member**, **C2/C4 = Chair**. Alex holds profile Z in all of
them.

## Summary

| | T-C2-034 | T-C2-035 | T-C2-037 | T-C1-020 | T-C2-039 | T-C1-022 | T-C1-023 | T-C1-024 | T-C1-025 | T-C1-027 | T-C2-041 | T-C2-043 | T-C2-045 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Condition | Chair | Chair | Chair | Member | Chair | Member | Member | Member | Member | Member | Chair | Chair | Chair |
| Messages | 28 | — | — | 51 human | 19 human | — | — | 14 | 8 | 81 | 10 | 50 | 49 |
| Decisions | 18 | — | 23 | 51 | 19 | — | — | 9 | 5 | 49 | 6 | 30 | 29 |
| Spoken | 10 (56%) | — | 6 (26%) | 18 | 11 | 5 | — | 5 (56%) | 2 | 28 (57%) | 4 | 20 (67%) | 20 (69%) |
| Median turn | — | — | — | 10.2 s | 12.7 s | — | — | **9.6 s** | — | — | — | 10.0 s | 10.4 s |
| Turns superseded | — | — | — | **39%** | 2/19 | — | — | **11%** | — | — | — | 1/30 | 1/29 |
| Observer per call, mean | — | — | — | 6.9 s | 6.8 s | — | — | 6.5 s | — | 5.3 s *(med)* | 5.8 s | — | — |
| Observer max | — | — | — | 14.3 s | 11.9 s | 13.9 s | 10.5 s | 11.2 s | — | 9.4 s | 7.6 s | — | — |
| Pre-broadcast tail | — | — | — | — | — | — | 2.5–3.5 s | **0.2–1.5 s** | — | — | — | — | — |
| Alex words, mean | — | — | — | 43.8 | 55.6 | 30.8 | — | 34 | **138** | **34.7** | 34.5 | **56.0** | **39.4** |
| Max traits, one message | — | — | — | **15** | 6 | — | — | 4 | **16** | — | — | 8 † | 8 |
| Judge cache hits | — | — | — | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** | — | — |
| Judge first-attempt accepts | 12/18 | — | — | — | 17/17 | — | — | 8/8 | — | — | 4/5 | — | 11/11 |

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
| Alex words per message, mean | ≤ 30 | 33.3 (T-C4-023) |
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

## T-C2-045 — the same script, on the new build

Chair, 49 messages, 29 decisions, 20 spoken. **The controlled comparison this
repair never had**: the operator re-ran T-C2-043's human script almost message
for message, two hours later, on the build with issues 01–11 in it. Every row
carries `promptVersion 1.9.0` and an `outputGuard`.

| | T-C2-043 (old) | T-C2-045 (new) |
| --- | ---: | ---: |
| Alex words, mean | 56.0 | **39.4** | **39.4** |
| Alex words, max | 145 | **72** |
| Sentences, mean | 2.9 | **1.9** |
| Messages over the reveal budget | 13/20 | **4/20** |
| Same trait set broadcast verbatim | **3×** | none |
| Messages over 80 words | 2 | **0** |
| Median turn | 10.1 s | 10.4 s | 10.4 s |
| Median silent turn | 7.4 s | **6.4 s** |
| Median spoken turn | 10.8 s | 11.0 s |

**Confirmed.**

- **Issues 03 and 04 work.** Mean length fell 30% and the maximum by half, on the
  same script, and the verbatim recital — one seven-trait set broadcast three
  times in T-C2-043 — did not happen once.
- **Issue 09 works, and immediately earned itself.** Every spoken turn now says
  which guard held it. Six turns ran under `route_reveal_budget` (1 new / 2
  restated / 3 sentences / 80 words) and **five ran with `inForce: false`** —
  including seq 44, which disclosed eight traits under no guard at all. That is
  the T-C2-041 seq 4 shape, and this time it is legible from the export rather
  than needing the turn rebuilt by hand. No violation was recorded on any turn.
- **Issue 01 works.** Every one of the nine cooldown silences has an empty
  Judge-attempt list. Median silent turn 7.4 s → 6.4 s; the remainder is the
  Observer, which is issue 10's subject.
- **Issue 06's mechanism works.** seq 5 is the drift-plus-elimination message
  again. The fixed sentence stood aside as designed and the turn went to
  generation under the mediation guard.

**Disconfirmed.**

- **Issue 06's mechanism fired and the content still missed.** Alex's seq 6
  stated the standard and then said A, C and D were "still to cover" — it did not
  acknowledge that a participant had just eliminated C. The route no longer
  discards the observation; the generated turn simply did not use it. **The
  acceptance criterion "a message that both drifts and contributes gets both
  handled" is not met by the fix that was built for it.**
- **An explicit request to Alex was silenced and then abandoned.** seq 16 Alex
  offered a choice; seq 17 answered it ("a concise comparison"), and the
  Observer read it correctly — addressed to Alex, explicit, floor expecting Alex,
  confidence 0.9 — and minted an opportunity. Cooldown vetoed the turn without
  the Judge seeing it, and on seqs 18, 21 and 25 the Judge had that opportunity
  in its selectable list and chose a voluntary act each time. The request was
  never answered. → issue 13.
- **A count request ignores its own source.** seq 46 asked how many attributes
  "we've discussed together". The Observer classified it correctly, with
  `source: "visible_board"`. `deterministicKnownCountResponse` never reads that
  field: it answered Alex's *known* count, 4 matches and 3 misses, where the
  board actually held 3 and 3. → issue 14.
- **Issue 12's Observer defect did not recur, and did not need to.** The seq 16-17
  pair is the same shape as T-C2-043 seq 16-17, and this time the Observer got
  every field right. The turn was lost anyway, one layer further down. Reading
  the reply correctly is necessary and was never sufficient.

**Not exercised.** Issue 05's bare-letter detector — no turn in this script names
a candidate by a bare letter in a position the old detector missed. Issue 07's
change is invisible from an export; the thread's requested action is absent from
prompts by construction now.

---

## Golden baseline 2026-09-08 — first run on the gateway model

Not a session. 11 cases × 4 conditions = 36 pairs, all `ok`, no empty outputs.
Recorded because the model changed underneath the previous baseline, which is the
one reason a golden re-run was actually owed: `openai.ts` had carried the note
"파일럿의 gpt-5.4-mini에서 교체 — golden 재실행 필요" since the U-M gateway
migration, and the last baseline (2026-06-09) predates it.

| | 2026-06-09 | 2026-09-08 |
| --- | --- | --- |
| Model | gpt-5.4-mini-2026-03-17 | **gpt-5-mini** (U-M gateway) |
| Outputs identical to previous | — | **0 of 36** |
| Words, mean | 47.9 | 51.1 |
| Words, max | 80 | 110 |
| Latency, median | — | 2.0 s |

**Confirmed.** The gateway model answers every case, in every condition, with no
failures. Median 2.0 s for a single generation, which is the figure to hold
against the Observer's 5–7 s when issue 10 is finally measured.

**Disconfirmed — about the record, not the model.** The checkpoint said the 1.9.0
route-prompt bump made a golden re-run necessary. **It does not.** `run-golden`
prompts through `buildSystemPromptForTask` → `compiled-prompts.json`, the path
`aiTurn.ts` uses and describes as "LEGACY EVALUATION PATH ONLY"; live turns read
`route-prompts.snapshot.v1.json`. The 1.9.0 text appears in all 30 route keys and
zero times in `prompts.ts`. The claim was written into the checkpoint and acted
on before it was checked.

**Not exercised.** The live route prompts, by anything offline. The golden set
covers the legacy path only, and the three longest outputs here (110, 109, 101
words on mediation and closing) come from prompts the live server never loads —
so they say nothing about whether issue 03's length bound works.

## T-C1-021 (2026-09-08) and T-C2-046 — the first two sessions on the half-B build

**Read the id warning below first: this `T-C1-021` is not the 2026-09 one in
T-C1-022's table.** Member/xai, 47 messages, and Chair/xai, 24 messages, both on
`conversation-ledger-judge-prompt-v8`, route prompts 1.9.0.

| | T-C1-021 | T-C2-046 |
| --- | ---: | ---: |
| Condition | Member | Chair |
| Messages (Alex / human) | 15 / 32 | 10 / 14 |
| Decision records | 33 | 14 |
| Broadcast | 15 | 10 |
| Silent — cooldown | 7 | 2 |
| Silent — `output_violation_after_repair` | **10** | 0 |
| Silent — `ledger_judge_failure` | 0 | 2 |
| Alex words, mean / max | 32.6 / 58 | 43.7 / 97 |
| Max traits, one message | 6 | 18 † |

† answering an explicit all-candidate request, where the reveal budget is lifted
by design.

**Confirmed — issue 13 half B, on its first live outing.** T-C1-021 seq 24 opened
an `invitation`, the cooldown silenced the turn, and Alex **took it on seq 25** —
`opp:24:invitation:alex`, selected one turn after it was made. On the previous
build that opportunity was unreachable from seq 25 onward. It is one instance,
and it is the instance the issue was written from. `owedRequestIds` recorded the
pairing on both sessions' cooldown silences.

**Confirmed — the Judge never chose silence.** Across both sessions, every turn
that reached the Judge came back `speak`: 21/21 in T-C1-021, 9/9 in T-C2-046.
Judge-chosen silence is currently an unexercised branch, which is the fact any
argument about removing the cooldown has to start from.

**Disconfirmed — that the reveal budget's cost is bounded.** T-C1-021 lost **ten
turns to its own output guard, against seven to the cooldown**. Eight were one
question: seq 34 asked for a candidate's misses, that candidate has three, and
`maxRestatedTraitIds: 2` rejected the honest answer. The repair reworded the same
three traits and was rejected again. Because a `direct_question` stays open, Alex
re-attempted the identical answer on seven later turns and was dropped every
time — the whole endgame. The request classified as `none`, so neither the scope
block nor the guard exemption applied; `EXPLICIT_COMPLETE_SINGLE` needs an
"all/every/complete/full" quantifier, and "What misses do we have for A?" has
none.

**Disconfirmed — that a prompt rule can hold the no-question line.** Every C1 and
C2 route prompt says "Do not ask a question, end with a question mark, or
request information", and T-C2-046 answered three requests with a menu of
options (seq 9, 15, 17), two of them consecutively — which the same prompt
separately forbids. That is the fourth failure of this rule, counting T-C1-027.
It is a condition-orthogonality problem, not a style one: question-led prompting
is the aci strategy, and these are xai sessions.

**Not exercised.** Anything aci — both sessions are xai, so neither says whether
C3/C4 behave. The generation-side wiring of the two fixes made after these
sessions, for want of an engine harness. And whether the Judge would choose
silence if the cooldown stopped filtering for it, which is unanswerable while
the branch stays at 0/30.

## T-C1-023 (2026-09-08) — the guard fixes, against a near-identical script

Member/xai, 45 messages, on the build carrying issues 13B, 14, 15, 18, 19, 20 and
21. The human script closely follows the 2026-09-08 `T-C1-021` run, which makes
this the cleanest A/B the repair has had since T-C2-043 → T-C2-045.

| | T-C1-021 | T-C1-023 |
| --- | ---: | ---: |
| Broadcast | 15 | 16 |
| **Silent — output guard** | **10** | **3** |
| Silent — cooldown | 7 | 8 |
| Silent — other | 1 | 1 |
| Repair attempts that saved the turn | 3 of 13 | **4 of 7** |
| Alex words, mean / max | 32.6 / 58 | 34.1 / 67 |
| Observer latency, median / max | 7.7 s / 13.3 s | 7.5 s / 13.5 s |

**Confirmed — issues 18 and 20.** The two questions that cost T-C1-021 its whole
endgame were both answered here: "What misses do others have for Candidate C?"
(seq 33) and "What misses do we have for Candidate A?" (seq 38) each produced a
broadcast. In T-C1-021 the first of those was re-attempted and dropped on six
separate turns.

**Confirmed — guard cost fell by 70%** on the same script, and the repair's
success rate went from 23% to 57%.

**Disconfirmed — that the remaining deaths are the same defect.** They are three
different things, and only one is a fault in the bound:

- **seq 22** — Alex took up a participant's two D misses and added its own two.
  Four counted against a cap of two, and the rewrite repeated it. Two of the four
  were the participant's own words. → **issue 22**, fixed; both drafts now pass,
  the initial one without a repair call.
- **seq 24** — a ten-trait draft, repaired to five, still over a cap of one. The
  bound doing its job on a turn where nobody asked for a list.
- **seq 23** — an eight-trait draft, repaired to **one**, then rejected for
  `internal_metadata_leak`. The rewrite ended *"My current read is
  NO_CURRENT_PREFERENCE"*: the model reported the preference cue's own label as
  the value it had been told to state. → **issue 23**.

**A suspicion that was raised here and is now disconfirmed.** This entry first
recorded that issue 21 — which began stating every bound in the repair
correction — might have caused that leak, and pointed at the phrase *"I can
share one additional trait"*. Neither holds. That phrase passes the detector on
its own; the sentinel is the only thing that fired, and it predates issue 21 by
the whole life of the prompt. The suspicion was formed from a log line truncated
at ninety characters, before the detector was run on the text. **Run the checker
before naming the cause.**

**Not exercised.** Anything aci. The engine-side wiring, as ever. And the
comparison is only as clean as the script: the two runs share a script closely
but not exactly, so treat single-turn differences as illustrative and the totals
as the result.

---

## T-C3-003 — the first aci session in this record

**Member + aci, 66 messages (Alex 15, humans 51), 2026-09-08.** Supplied as a
message export, not as a full session record. **The build is unverified**: it is
described as the pushed production version, which is pre-repair, and nothing in
the export names a `promptVersion`. Treat every figure here as pre-repair and do
not compare it with the half-B sessions.

No intervention rows accompany the export, so there are no silences, no guard
events, no latencies and no route kinds — only messages and `sharedInfoIds`.

| | |
| --- | ---: |
| Alex words per message, mean | **28.3** |
| Human words per message, mean | 9.2 |
| Ratio | **3.1×** |
| Alex messages ending in the same confirmation-request form | **12 / 15** |
| Alex messages containing a question mark | 12 / 15 |
| Alex messages disclosing exactly one trait | 11 / 15 |
| Final coverage, distinct traits on the board | A 10, B 9, C 10, **D 7** |

**Confirmed — the aci strategy is intact but has collapsed into one sentence
frame.** Twelve of fifteen messages disclose a single trait and close with the
same request to confirm it. This satisfies the aci manipulation and satisfies the
one-trait reveal budget, and it makes Alex's contribution formally identical from
turn to turn. Recorded as a rate to watch, not as work: see the deferred item in
`.scratch/leader-decision-frame/spec.md`.

**Confirmed — mean length is inside the target and the ratio is not.** 28.3 words
clears the ≤30 target, while remaining 3.1× the humans in the same room. The
target and the thing it was a proxy for have come apart on this session.

**Confirmed — a peer performed a leader's move, and it decided the session.** At
seq 4 a participant proposed eliminating a candidate, before any trait for any
candidate had reached the board. Alex answered by conceding the point and then
disclosing one of its own traits for that candidate, which is blocking premature
closure. The group's final choice was that same candidate, and three of its six
positives had come from Alex. Following the group at seq 4 would have ended it
there. This is the observation `.scratch/leader-decision-frame/issues/06` is
written from.

**Confirmed — already-surfaced information was offered as a new contribution.**
At seq 47 a participant asked what *other* misses Alex held for a candidate. Alex
answered with three trait ids that a human had already put on the board ten turns
earlier, framed as its own notes: zero new, three restated. The claim was not
false — those traits are plausibly shared across profiles — and the participant
accepted it. No guard applied: the turn carried a request, and the restated bound
is reached only on turns carrying none. See issues 07 and 08.

**Disconfirmed — that a peer's silence reads as restraint.** Alex was silent from
seq 36 to seq 48, 3.2 minutes. At seq 43 and seq 46 participants remarked on the
absence and proposed working around it. The closing arrived 14.9 minutes after
the last human message. Whatever the passive peer is meant to look like, on this
session it looked like a fault. This is the evidence against the proposal to
remove long-silence filling from the peer conditions.

**Not exercised.** Everything Chair-only — mediation, summary, closing as a
generated turn. Every guard, because none is recorded. The narrowing trajectory
the leader frame is designed for: the group swept A, B, C, D in order and
tallied, so no candidate was ever set aside mid-discussion.

**What it says about the removal rule.** *(The rule applied below was withdrawn
the same day by `docs/adr/0009`; the reading is kept because it is what the
session was read against at the time. Against the replacement — a candidate
leaves the list at coverage 5, where something beyond the shared four must be on
the board — this session says: at seq 4 no candidate had anything at all, so the
group's move to eliminate would have met a coverage shortfall; and at the close
all four stand at 7 or more, so nothing was outstanding and the leader would have
had nothing to raise.)* Applying
`docs/adr/0008`'s clauses retrospectively: at seq 4 no candidate reaches
coverage 4, so none could be set aside — the group's own move would have been
resisted. At the close, D stands at coverage 7 against a best of 10, so D remains
within the coverage clause's reach and a leader would have raised it once before
the group finished. Both are the intended behaviour, on a session where neither
happened.

---

## T-C2-047 — the first Chair session on a repaired build

**Chair + explanatory, 36 messages (Alex 13, humans 23), 2026-09-08.** Build is
verified in the record: `promptVersion` 1.9.0, one `promptHash` across all 24
intervention rows, model `gpt-5-mini`. **It did not reach closing** — the session
is still `in_progress` after 7 minutes of a 30-minute discussion, so
`mediation`, `summary` and `closing` remain unexercised end to end and issue 01's
first criterion is only half met.

| | |
| --- | ---: |
| Alex words per message, mean | **34.2** |
| Human words per message, mean | 25.6 |
| Ratio | **1.3×** |
| Alex messages containing a question mark | **0 / 13** |
| Turns lost to a guard | **1 / 24** |
| Turns lost to cooldown | 9 |
| Distinct traits on the board at the end | **16 / 40** |
| Traits only Alex held, disclosed | **1 / 8** |

**Confirmed — length and the question ban hold.** 1.3× the humans, against 3.1×
in T-C3-003, and not one of thirteen leader messages asked a question. The two
output properties that cost the most turns earlier are now cheap.

**Confirmed — the output guards have stopped eating turns, and the one death was
not the guard's fault.** One guard death in 24 records
(`selected_trait_missing` at turn 9), against eight in T-C1-021. Turn 9 was
later traced: Alex stated the required trait twice, in the wording of its own
card, and the matcher held a different wording for the same trait. Four copies of
the trait text had drifted apart on 11 of 40 traits. See
`.scratch/conversation-repair/issues/23`; the fix bumps the prompt version to
1.10.0, so this session's figures are the last on 1.9.0.
`answered_with_a_question` was raised three times and repaired successfully every
time. `maxRestatedTraitIds` was in force on four turns and was never violated:
it still fires as a bound and did not bite, which answers the question issue 01
asked about it.

**Confirmed — the group eliminates the pooled answer immediately, and this is the
second session to show it.** At seq 2, the first human message of the session,
humanY eliminated Candidate C. At seq 5 humanX eliminated it again. The board
held one trait at the time. C is the pooled answer, and it was never reconsidered.
T-C3-003 seq 4 is the same move on a board of zero traits. Two sessions, so the
coverage shortfall on a narrowing move clears the bar the checkpoint's sixth
method rule sets.

**Confirmed — Alex claimed exhaustion twice while holding cards.** At seq 15 it
said it had no new facts, with sixteen of its twenty-four traits unsurfaced. At
seq 36 — answering a direct request for information the others might not have —
it named two traits and said those were the only new facts it had, with thirteen
unsurfaced, seven of them held by no other participant. Both statements were
false when made. Recorded as `.scratch/conversation-repair/issues/22`.

**Disconfirmed — that Alex selects shared traits over its own.** Alex disclosed
one unique trait in six new disclosures, which reads as a bias until the hand is
counted: at those six moments the unique share of Alex's unsurfaced notes ran
36%, 42%, 41%, 44%, 50%, 54%, so 2.7 unique disclosures were expected by chance.
One of six at n=6 is inside chance and demonstrates nothing. Nothing on the board
distinguishes a shared note from a unique one for whoever holds both, and the
estimate a participant can make — own notes minus the board — is already what the
code computes and already sharpens on its own as the session runs. The rate is
the open question, not the selection: six new traits from a hand of twenty-four
across thirteen messages, under `maxTraitIds: 1` on every trait-bearing turn.

**Confirmed — the reveal budget is checked against a source that misses traits.**
Turn 35 carried a budget of one trait and a recorded `traitIds` of none, while
the broadcast message's `sharedInfoIds` are `A_p4` and `B_p3`: the fast extractor
found nothing at check time and the async extractor found two afterwards. The
same asymmetry runs the other way at seq 31, where a human stated `A_n1` in plain
words and the verifier declined it. The board under-counts and the guard
over-passes, from one cause. Recorded as
`.scratch/conversation-repair/issues/23`.

**What it says about the candidate list.** This is the first session read against
`docs/adr/0009`, and on real extractor output rather than a keyword replay. For
29 of 36 turns every candidate was live: nothing beyond the shared four had
reached the board for anybody. A cleared the bar at seq 30 and B at seq 36. C and
D never cleared it — C ended at coverage 4 and D at 2 — so at the close the list
still said the group owed attention to the candidate it had eliminated first.
Both of the group's eliminations, C at seq 2 and D at seq 25, happened while
those candidates were far below the bar, so the shortfall move would have fired
twice and both times correctly.

The withdrawn rule was replayed against the same board for comparison. It sets C
aside at seq 27 and B at seq 29, leaving A and D live — the two candidates with
the least on the board, neither of them the answer, at a point where the humans
were choosing between A and B. That is the failure `0009` was written from,
reproduced on a live session rather than argued from the dataset.

**Not exercised.** Closing, summary and mediation as completed routes. The
long-silence path. Every Chair-only behaviour that depends on the discussion
reaching its end.

---

## T-C4-022 — the first aci session on a verified build

**Chair + aci (C4), 55 messages (Alex 24, humans 31), 2026-09-09.** Build is
verified in the record: `promptVersion` 1.10.0, one `promptHash` across all 29
intervention rows, model `gpt-5-mini`. **It did not reach closing** — the session
is still `in_progress`, so `summary` and `closing` remain unexercised end to end
and issue 01's first criterion stays open. `mediation` fired once, at anchor 5.

This is the session `.scratch/leader-decision-frame/issues/01` asked for as its
second criterion: an aci session on the current build, with `outputGuard`,
`routeKind` and latency present. T-C3-003 was aci but pre-repair and unverified.

| | |
| --- | ---: |
| Alex words per message, mean | **32.6** |
| Human words per message, mean | 20.8 |
| Ratio | **1.6×** |
| Alex messages containing a question mark | **22 / 24** |
| Alex messages ending in an either/or question | **14 / 24** |
| Alex messages ending in an offer to add a trait | **14 / 24** |
| **Alex messages carrying no new trait** | **18 / 24** |
| Max traits in one message | 6 |
| Turns lost to a guard | **2 / 29** |
| Turns lost to cooldown | 3 |
| Turns superseded | 4 |
| Median turn | 10.3 s |
| Distinct traits on the board at the end | **21 / 40** |
| Traits only Alex held, disclosed | **4 / 8** |
| Alex's own card still unsaid at the end | 7 / 24 |

**Confirmed — the aci collapse T-C3-003 recorded is neither pre-repair nor a
peer artefact.** T-C3-003 closed twelve of fifteen messages with the same
confirmation-request form. Here the frame is different but the shape is
identical: **the last twelve consecutive Alex messages all end by offering to add
a trait**, and eight messages ask which candidate to cover next. One build later,
the other status, on a verified build. That is the second observation, so the
deferred item in `.scratch/leader-decision-frame/spec.md` clears the two-session
bar the checkpoint's sixth method rule sets, and stops being a rate to watch.

**Confirmed — length came inside the target for the first time, and the
information left with it.** 32.6 words is the lowest mean in the record and 1.6×
the humans, against T-C3-003's 3.1×. In the same session **eighteen of
twenty-four Alex messages carry no new trait at all**, against a target of zero.
The two figures are one result: `ROUTE_REVEAL_BUDGET` reached a live turn for the
first time on this build (issue 03), and it applies to `address` and `followup`
whenever the request intent reads `none` — 20 of Alex's 24 turns here. The bound
did what it was built to do and the turns had nothing left to carry.

**Confirmed — a count bound killed an explicitly requested recap, twice, and the
Chair had no route to answer it with.** At seq 53 a participant asked for a
summary and for no follow-up question; at seq 54, for a retry. Both turns routed
to `address`, extracted 19 and 25 traits, and died `too_many_traits` after
repair against `maxTraitIds: 1`. Both are the count bound the 2026-09-08 guard
audit already identified as the one that almost never repairs. Three causes
compound, and each is separately true: `summary` is unreachable on the live
controller (`.scratch/conversation-repair/issues/26`); no request-intent pattern
matches the word *summary*, so the reveal budget applied to a recap request; and
1.9.0 removed the output-discipline clause that had excused an explicitly
requested list, leaving the request-scope machinery as the only source of that
licence. The group then heard nothing for 62 seconds and a `long_silence` turn
at seq 55 repeated the same offer.

**Confirmed — the group eliminates the pooled answer on the first human message.
Third session.** humanY eliminated Candidate C at seq 2, the first human message,
on a board of one trait; humanX did so again at seq 5. T-C2-047 seq 2 and
T-C3-003 seq 4 are the same move. C was reconsidered only as a request for
Alex's notes, never as a candidate.

**Disconfirmed for this session — that Alex withholds the traits only it holds.**
Four of Alex's eight unique traits reached the board, against one of eight in
T-C2-047. n is still small and nothing here separates selection from rate, but
the direction that reading pointed in is not present.

**What it says about the candidate list.** Second session read against
`docs/adr/0009`, on real extractor output. C cleared the bar at seq 17 and A at
seq 24, both immediately after an Alex disclosure; B cleared at seq 46; **D never
cleared, ending at coverage 3.** The group's two eliminations — C at seq 2 on
coverage 0, D at seq 35 on coverage 2 — both happened far below the bar, so the
shortfall move would have fired twice and both times correctly. That is the third
consecutive session in which it would have.

**Observed, and not yet routed: the shortfall behaviour is already leaking, in
the worst available form.** The list is log-only by issue 02 and did not reach
Alex. But the unsaid-notes context block, shipped 2026-09-08, lists Alex's
unsurfaced notes on every trait-bearing route, and D dominated that list from seq
29 to the end. Alex responded by asking permission to disclose a D trait on every
one of its last twelve turns and disclosing one on none of them. The behaviour
issues 03 and 04 propose to build is therefore already occurring — through a
context block written for a different purpose, with no route obliged to discharge
it, in an interrogative the aci style makes cheap. Under `followup`, which took
11 of 24 turns, nothing requires the turn to carry anything.

**Not exercised.** `summary` and `closing`. Mediation past a single turn. Every
Chair behaviour that depends on the discussion reaching its end — the same gap
T-C2-047 left, for the same reason.

**One gap in the export itself.** The session export's `messages` carry five
fields and neither `sharedInfoIds` nor `declinedTraitIds`, so information release
cannot be counted from `T-C4-022.json` alone; every trait figure above is read
from the `messages` collection. Commit `5f616f8` covered the intervention rows
and not this one.

---

## Notes on the record itself

**One run is missing, and one id is now used twice.** The original T-C1-021
appears in T-C1-022's comparison table as the A1–A4 build and has no entry of
its own; its numbers survive only in that one row. A **second, unrelated session
reused the code `T-C1-021` on 2026-09-08**, and it is the one recorded below.
The two share nothing but the string. Say which you mean, and prefer the date.

**Restart the server before measuring.** T-C1-022's conclusion about A6 was
wrong because the process had hot-reloaded across the change without restarting.
The current working tree has hot-reloaded through roughly ten edits, including
five deliberate breakages made to check that assertions fail. **Restart before
the next measurement.**

**Measure the fields you keep, not only the tokens you cut.** The schema-cut
analysis measured output cost and never asked whether a field carries value after
its own value is discarded. That reasoning turned out to be wrong too — see
T-C2-041 — but the method note stands on its own.

**A model swap can break a call the tests never make.** Only `openai.callAIStructured`
handled reasoning models; the Observer, the three Judge entry points, the three
small judges and the trait verifier each built their own request and sent
`temperature: 0` unconditionally. `gpt-5-mini` rejects that field, so moving the
Judge to it left three call sites that would have failed on their first live
request — with every suite green, because nothing in the test tree makes a model
call. `openai.modelRequestParams` now decides those fields from the model name
and the same value is what gets recorded, so the provenance line cannot claim a
setting the request did not send. **A green suite says nothing about a request
shape no test builds.**

**A field can be dead and still be read.** `alexRelevance` was described here as
having no live consumer. It had two: one sentence in the paragraph the Judge
reads, and half the condition that bought a second full observation. Both were
reading a value that came back `not_relevant` on 50 of 50 and 5 of 5 — a constant
the Judge was told every turn and a "contradiction" that was really the constant
meeting a thread flag. Removing it is right, and the reason to remove it is the
opposite of the one first given. **Check the consumers before calling a field
unused; a constant is not the same as absent.**

---

## T-C4-023 — 2026-09-09, Chair + aci, first session on the rewired build

promptVersion `1.11.0`, `gpt-5-mini` for Observer, Judge and generator, 48 human/Alex
messages, 29 intervention rows, 15 spoken and 14 silent.

**Latency is fixed.** Median turn 1.6 s, max 7.1 s, against 10.3 s median in
T-C4-022. The Observer and the Judge both moved to `gpt-5-mini` with
`reasoning.effort: "minimal"`, and the fear that reasoning tokens would make the
Observer slower did not materialise.

**Length did not move.** Alex 33.3 words per message against the humans' 19.6
(T-C4-022: 32.6 against 20.8). The target of ≤ 30 is still missed, and no check
enforces it — `sentenceCount` and `wordCount` are exported and called by nothing. (Both were deleted on 2026-09-14; length is read from the export.)

**The either/or question is gone; the question is not.** 1 of 15 messages ends in
an either/or, against 14 of 24 in T-C4-022. 13 of 15 still carry a question mark.
The C4 prompt of this session still carried the three either/or examples; they
were replaced after this run, so the improvement is not yet attributable to them.

**Seven of twenty-nine turns were lost, to four different causes.**

| Cause | Turns | Which |
|---|---:|---|
| `current_required_opportunity_not_selected` | 3 | seq 13, 46, 48 — all direct questions to Alex |
| output scope check after repair | 3 | seq 7, 15, 44 |
| ordinary cooldown | 1 | seq 2 |

Six further turns were vetoed before the Judge by the human floor, and five were
superseded by a newer human message.

**The largest cause was a rule the prompt never stated.** Validation demands the
opportunity opened by the message being judged; the prompt offered "Unanswered
requests addressed to Alex, oldest first" and named no required id. On seq 13,
46 and 48 the Judge selected an older backlog question, was rejected, guessed
again from the same list, and the turn was lost. **Two of the three were the
group asking "Alex can you give us a summary?", once and then again.** Each loss
added another unanswered question to the backlog that caused the next one, so
the failure compounds: seq 44 lost, then 46, then 48, and the session ended with
four unanswered direct questions open.

**The Judge's brief was never delivered.** `docs/adr/0010` gives the Judge what
the turn must accomplish; the generator received the fact list and not the
sentence. `judgeBrief` was declared on the reservation, threaded through
`routeTurn`, injected by `routeContext` — and never set at the one call site
that reserves a live turn. Validation could reject a decision over that field
(`brief_missing`, `brief_too_long`) while nothing downstream read it.

**Alex named who said what.** Seq 39 and 41: "Participant Y says they don't have
those", "Participant X and Participant Y do not have those two misses". The
prompt forbids this — "Do not say who supplied which information" — and no check
reads for it. The reading was correct; the attribution is the violation.

**The count answer is deterministic, and unverifiable from the export.** Seq 43,
"we have 4 matches and 4 misses for Candidate B", came from
`deterministicKnownCountResponse`, not the model. Reconstructing the board from
the transcript gives 4 matches and 3–4 misses, so it is plausibly right — but
`revealStats` is still absent from the session export, so it cannot be checked
from `T-C4-023.json` alone. That is the same export gap T-C4-022 recorded.

**Method note — a green suite proved nothing about the half-built decision.** The
brief was validated, threaded and injected, and every test passed, because no
test follows a value from the Judge to the generator. **Wiring is not covered by
checking that each end compiles.**

---

## T-C2-049 — 2026-09-10, Chair + xai, cooldown on and the output checks off

promptVersion `1.11.0`. `disabledGuards: ["outputScope", "humanFloor", "judgeBrief"]` on all 19
rows — the inverse of T-C4-024's single disabled cooldown, and the pairing that
makes the two comparable.

**The question ban held on its own.** C2 is explanatory, where any question is a
post-condition violation. **0 of 14 messages carry a question mark** — not
because the check killed them, but because none was written.

**The counting answer is exact.** Asked for a whole summary with match and miss
counts, Alex gave A 4·2, B 4·3, C 3·3, D 4·3. Reconstructing the board from
`sharedInfoIds` gives the same four pairs. **All four correct.**

**Four turns lived that the scope check would have killed** — seq 9, 18, 25, 28,
each logged `delivered message broke trait_outside_selected_contribution`. One of
them, seq 28, is the answer to "Alex can you help us decide?".

**Cooldown and the scope check cost about the same.** T-C4-024 (cooldown off,
checks on) broadcast 15 of 19; T-C2-049 (cooldown on, checks off) broadcast 14 of
19. The two builds silence a similar number of turns by different means, so the
question is not how many turns survive but which ones.

**The invented decision criterion is not a C4 problem.** T-C4-024's "stopping
rule" reappears here in different words: seq 18 proposes weighing "interpersonal
misses against safety and performance matches", seq 20 calls a trait "a miss
against our interpersonal requirements", seq 28 argues one candidate's misses are
"fewer than D's and less likely to undercut core flight duties". Categories the
task does not contain, ranked against each other. **Two conditions, two sessions,
same defect — equal weighting is a control variable, so this is validity, not
style.**

**Method note — the trait leak was not a leak.** T-C4-024 and T-C2-049 both
record `B_n5` in `declinedTraitIds` on the summary turn, and this log previously
read that as a trait Alex said and the record lost. It is not. `B_n5` is on the
board in both sessions (T-C4-024 seq 4, T-C2-049 seq 31). `B_n5` and `D_n1` carry
byte-identical text — "Is considered arrogant" — and are the only such pair in
the 40; naming one proposes the other, which the verifier then declines. Feeding
all 40 traits' own card wording through the matcher fails for **zero**. The
pooling DV is intact. **A decline next to a correct disclosure is the twin, not a
loss** — and reading `declinedTraitIds` as "said but not recorded" produces a
false positive on every arrogance turn.

**What does lose a trait is dropping one word.** "B's seen as arrogant" defers
`B_n5` and accepts nothing. The simulation scripts under `docs/simulation-result/`
use exactly that wording, so anything measured from them undercounts.

**Method note — a comparison `.env` reached the test suites.** The offline suites
load `server/.env` through dotenvx, so `HAIT_GUARD_HUMAN_FLOOR=off` left over
from this session made `test:conversation-ledger` fail on a floor assertion whose
message said nothing about flags. The inverse is the real hazard: a suite that
passes only because a check was disabled reads exactly like a suite that passes.
Every offline entry point now calls `forceGuardsOnForTest()` first.
**A flag that changes the build must not be able to change what the tests prove.**

---

## T-C2-050 — 2026-09-10, Chair + xai, the brief fence in place

**Build:** `conversation-ledger-judge-prompt-v10`, `gpt-5-mini` on Observer, Judge
and speech. Guards off: `outputScope`, `humanFloor`, `judgeBrief`. Cooldown on.

26 intervention rows, 17 broadcast. Median latency 2.1 s, max 4.1 s. Nine
silences: 4 cooldown, **3 human floor**, 1 judge failure, 1 superseded.

**The brief fence held.** No invented decision rule in 45 messages — the defect
that ran through T-C4-024 (ten consecutive briefs carrying "propose a clear
criterion") and T-C2-049 does not appear once.

### The floor flag was gating half its check

All three floor silences — seqs 26, 27 and 41 — are
`ledger_router_human_floor_held`, and every row of the session records
`disabledGuards: ["outputScope", "humanFloor", "judgeBrief"]`. **The run asked for
the floor veto to be off and lost three turns to it anyway.**

The floor is read at two sites: before the Judge is called, and again after it has
decided. Only the first read the flag. So on those three turns the turn reached
the Judge, the Judge chose to speak, and the second read threw the decision away.
A flag that silences one of a check's two sites does not measure that check.
Fixed 2026-09-10; `test:conversation-ledger` now pins both sides.

### Two turns lost inside the Judge's trait list

**seq 14 — a spent id, then an invented one.** A participant asked Alex directly.
Two C traits were still eligible (`C_n2`, `C_n3`). Attempt 1 answered
`["C_p1", "C_n2"]`; `C_p1` had been on the board since seq 11, so the decision
was rejected for the spent id. The retry was handed the rule name
`disclose_trait_not_eligible` and nothing else, and answered `["C_p1", "C_p2"]` —
the same spent id plus **`C_p2`, which is on no card Alex holds**. Turn lost to
`ledger_judge_failure`. This is the `ledger_judge_failure` that looked, from the
transcript, like Alex being called and not answering.

**seq 19 — the bare candidate letter.** All six of Alex's A traits were on the
board by seq 17. The group came back to A. The Judge set `focusCandidate: "A"`
and, for the trait ids, emitted **`["A"]`** — the candidate letter where a trait
id goes. No A id was left in the eligible list and nothing in the prompt said so.
Rejected as ineligible; the turn broadcast an empty message.

Both are the same shortage from opposite ends: the eligible list carries what
Alex may name, and carries what Alex has *run out of* only as an absence. The
Judge answered the absence with a letter. Two fixes, 2026-09-10 — the prompt now
names the spent candidates in a sentence, and a retry that trips a trait rule is
handed the eligible ids rather than only the rule name.

### What `outputScope` was holding

With the scope check off, the gap between what the Judge authorised and what Alex
said is visible directly. On six turns the Judge named nothing and the generator
spoke anyway, twice reciting most of the card:

| seq | Judge authorised | extracted from the message |
| --- | --- | --- |
| 17 | `A_n5, A_n6` | all six A traits |
| 22 | `D_n5, D_n6` | all six D traits |
| 32 | — | 25 traits |
| 34 | — | `D_p1, D_n6, D_n4` |
| 42 | — | `A_n5, B_p2, B_n3, B_n6` |
| 44 | — | 25 traits |

The seq 32 and 44 rows are whole-board recaps and may be legitimate; the rest are
not. **The scope check is the only thing standing between `discloseTraitIds` and
what reaches the board,** which is the measurement this comparison run was for.

**Method note — a claim corrected.** The seq 14 and seq 19 events above were first
written up against **T-C2-049**, which is the wrong session: T-C2-049 seq 14 is a
plain cooldown silence, and its one rejected trait choice (seq 12) emitted the
literal placeholder strings `"C_p?"` and `"C_n?"`. The ids and the seqs were
right and the session was wrong. Comments and `ARCHITECTURE.md` were corrected
before the fixes were finished.

---

## Judge replay — 2026-09-14, prompt v12 against v13 on recorded turns

**What was run.** The live Judge function, offline, on 27 human turns rebuilt from
the T-C2-050 to 053 exports: the transcript to that seq, the ledger state the turn
saw (the post-broadcast consumption the export stores was undone), the board
rebuilt from `sharedInfoIds`, and the eligible list recomputed. Fifteen are turns
where Alex spoke past what the humans had just said; twelve are questions it
answered in the right shape. Prompt v12 once each, v13 three times each.
`gpt-5-mini`, no database writes, a one-off script not kept in the repository.

**The rebuilt inputs reproduce the failures.** v12 wrote a brief that passed over
what the humans had just said on 14 of the 15 — "bring new facts about A, B, and
D" after X's clarification (053 seq 12), a brief asking how to weigh teamwork
against safety (052 seq 23) — and selected the recorded request on all 12
answered questions.

**Request turns did not move.** v13 selected the same opportunity with the same
act on 36 of 36 runs of the answered questions. Failed Judge attempts: 3 in 12
runs on v12, 7 in 36 on v13; none lost a decision.

**Voluntary turns now start from what was said.** On the eight problem turns with
no request to answer, v12's brief took up the humans' point on 1 of 8 and v13's
on 13 of 24 runs, by a reading of each brief. Clearest: 052 seqs 23 and 29 and
051 seq 27, 3 of 3 each.

**What v13 did not fix.**
- 053 seq 27 and 050 seq 28, 0 of 3: with Alex's card empty on the candidate being
  discussed, the turn still added facts about other candidates.
- 053 seq 33: 3 of 3 named the room's question for top choices (seq 32, never
  observed) and 0 of 3 answered it; each added A and B traits instead.
- 051 seq 45 and 052 seq 47: answers to "could anything change my mind?" still
  steer back to deciding between A and B, and one run of 051 seq 45 asks outright
  for a final ranking.

**Three sentences were tried in two rounds and withdrawn**: answering an unlisted
question to the room (both rounds), staying off other candidates' facts (round
one), naming the candidate being dropped (round two). On the six turns they
targeted, take-up went from 11 of 18 runs on v13 to 8 of 18, then 5 of 18.

**Method note.** Three runs per turn shows a direction and cannot rank close
wordings, so the withdrawn sentences may be noise rather than harm. Only the
Judge's brief was replayed, never the writer's message; the next Chair session is
still the measurement.

---

## 2026-09-15 — S-C2-002, the first live session

C2 (Chair × XAI), two participants, 56 messages, 20 of them Alex's. Team chose B
unanimously; the pooled answer is C. Judge prompt v13, prompt snapshot 1.12.0,
comparison build (`outputScope`, `humanFloor`, `judgeBrief` off).

**Alex asked nothing and requested constantly.** 0 question marks in 20 messages,
and 8 of the 19 model-written ones carry an imperative next step — "state which
candidate handles it better", "please state for each scenario", "vote which
candidate handles each" (the greeting is deterministic and is not counted).
The XAI question ban held in punctuation and not in function.

**Alex wrote 72% of the words on 36% of the turns**: 1,239 words across 20
messages against the humans' 478 across 36. Average 62 words to their 13. The
whole overrun sits on `followup` turns after seq 39 (113, 193, 79, 52 words) where
the shared discipline asks for 40.

**Alex stated a preference once** (seq 50, "my read is B looks stronger"), on a
`followup` with no preference cue supplied — so it chose from its own judgment,
which the refinement forbids — and it said it immediately after X and Y had both
settled on B. The cue reaches only `closing` and an explicit preference request;
`closing` never ran, and one turn in twenty carried such a request.

**Mediation ran zero times** while its evidence latch was on from seq 16.

**The extractor missed four traits that were said aloud** — A_n3, B_p1, C_n3
(twice), B_n4 — and invented one, D_n1, which then printed in the seq 53 board
recap. Y's unique-reveal count read 2 of 8 against an actual 4 of 8.

### Replays behind the three fixes

**Extractor, offline, 1,094 messages from 21 sessions.** Old matcher vs new:
nothing lost from either the accepted or the deferred set, 18 newly accepted. The
four S-C2-002 misses all now fire; the D_n1 attribution check rejects the invented
miss and keeps B_n5 on the same sentence.

**Mediation, offline, S-C2-002's 34 recorded turns** with `mediate` listed as a
move and availability taken from the session's own latch. Three turns flipped to
`mediate` (anchors 49, 52, 55) and **no other turn changed act**. Two of the three
briefs name the gap the session never closed — that nobody had brought their own
notes on C. One of the three took the turn the Chair had spent on its recap.

Not measured: the writer's message on a mediation turn, and whether the
direct-reply procedure ban changes what seq 39 and 41 would have written. Only
the Judge was replayed. The next Chair session is still the measurement.

---

## 2026-09-20 — S-C4-003

C4 (Chair × ACI), 43 messages, 20 of them Alex's. Team chose D unanimously; the
pooled answer is C. Judge prompt v14, comparison build.

**The hidden profile was over by minute three.** At seq 6 a participant asked for
"a short overall for each candidate's strengths and weaknesses" and the Judge
named twenty trait ids for one turn. From seq 14 the eligible list was empty for
**fourteen consecutive turns**. The humans pooled two traits all session
(C_n2, C_n3, both at seq 18); `revealStats.byCandidate` is empty for A, B and D.

**With nothing left, four turns asked for evidence that does not exist.** Seqs
30, 32, 34 and 36 asked for "concrete examples", "specific incidents", "concrete
evidence" of a trait's operational impact. The briefs show the Judge as the
origin, not the writer. A participant answered: "We have to use what we currently
have at hand".

**Mediation was never offered.** `detectMediationEvidence` returned `[]` on every
window. At seq 14 it missed by one match: the leading "A" of "**A** short overall
for each candidate's…" counted as Candidate A, putting the window at three
distinct candidates against a threshold of two. Lowercasing that one word in the
same window returns `["candidate_concentration"]`.

**The recap was never available either** — it needs a non-empty human board, and
the humans had put nothing up until seq 18.

### Replays behind the v15 fixes

**S-C4-003, 20 turns.** Briefs asking for something outside the notes: 4 → 2.
Both survivors follow Alex's own earlier example-asking in the transcript, which
the fix removes upstream. Briefs that ask the group for their own notes on an
uncovered candidate appear at anchors 14, 16, 18 and 27, where none did before.

**Mediation is offered and not taken in C4.** With the detector fixed, the move
was available on 10 of the 20 turns and the Judge chose `follow` every time:
ACI's question at the end of each turn draws a human reply, which mints an uptake,
and taking up the reply beats a voluntary mediation. Nothing forces that
ordering — it is the Judge's free choice — so it is a prompt-weight question, not
a block.

**S-C2-002 re-replayed on v15, 34 turns.** Mediation taken at anchors 11, 43, 49,
52 and 55, against three on v14; anchor 11's brief is the one this work was for —
"note that nobody has added their own notes on any candidate, and ask the group
what they still have on A, C and D". Four of the five name the same gap (C), which
the prompt tells the Judge not to do. The replay cannot model the engine clearing
the latch after a mediation broadcast, nor that the first mediation changes the
conversation, so live frequency will be lower than five. **This is the number to
watch in the next Chair session.**

### Extractor on S-C4-003

**Human side clean.** Two traits were stated from a participant's own card all
session (C_n2 and C_n3, both at seq 18) and both were recorded. Nothing was
missed: the other human lines about a candidate are inferences from what Alex had
already said, or restate a Z-only note the speaker does not hold.

**The precision fix worked live.** D_n1 was offered by the verifier at seqs 7 and
41 for a sentence that said "considered arrogant" about B, and rejected both
times. That is the S-C2-002 defect, caught in the field.

**It also cost a true positive, now fixed.** The same sentences carry B_n5, and
the duplicate-quote rule rejected it alongside D_n1 because both ids came back on
one quote. Alex said B was arrogant at seq 7 and the board recorded it at seq 12.
Attribution now runs before the duplicate count; replayed over seqs 7, 12 and 41
of S-C4-003 and seqs 9 and 39 of S-C2-002, the pair resolves to B_n5 every time,
an explicitly attributed D claim still counts for D, and a genuinely reused
generic quote is still rejected for both ids.

---

## 2026-09-22 — S-C4-004, and the v16 wording

C4, 50 messages, 20 of them Alex's. Team chose B; the pooled answer is C. Judge
prompt v15, comparison build.

**The card again went in two turns.** seq 3 carried all fifteen matches, seq 5 all
nine misses — Alex's whole card by minute three. The second was not even a
request: *"but they also all have their offsets aswell"*.

**The ban held on its own words and not on the class.** From seq 16 to seq 38,
eleven of twelve replies asked for "mitigation steps", "steps to manage those
flaws", "specific, implementable measures"; seq 24 supplied its own — *formal
feedback, coaching, behaviour codes … monitoring mood impact, diversity training,
clear escalation paths*. None of that is on anybody's card. The v15 rule listed
examples, incidents, anecdotes, sources and witnesses, and a remedy is none of
those.

**The closing was the Stop AI button, not the model.** `AI closed and muted
reason=manual` at 14:49:28; seq 42 is the deterministic closing route. The 30-minute
deadline would have fired at ~14:56 and did not. No elapsed-time or time-remaining
signal exists anywhere in the generation context, and the Judge is told never to
reason about elapsed time. The wrap-up tone from seq 33 on is Alex taking up the
humans' own convergence words; every one of those turns still ended in a question.

**Two leader moves were available and unused.** `recap` from seq 7 (A_n4 gave a
non-empty human board) and `mediate` from seq 21 (the fixed detector latches
`candidate_concentration` on the real windows from there). Neither was taken —
see the cooldown finding below.

### v15 vs v16, S-C4-003, three runs of nine turns

| | off-task ask | asks for their own notes |
|---|---|---|
| v15 | 6 / 27 | 1 / 27 |
| v16 | 7 / 27 | **7 / 27** |

The off-task column does not move, and the reason is visible turn by turn. On
anchors 14, 16, 18, 27 and 29 both versions are **0 of 15**. All of it sits on
anchors 31, 33, 35 and 37 — the turns that follow Alex's own example-asking at
seqs 30, 32, 34 and 36, which the Judge is dutifully taking up ("*They asked for
examples of A's restlessness…*"). Rewriting those four Alex messages as v16 would
write them and replaying the same four anchors gives **0 of 12 off-task, 5 of 12
asking for their notes**. The tail is contamination from the build being fixed,
not a failure of the wording.

### Why no recap ever appears

`recap` and `mediate` are voluntary acts and both are listed available only when
the cooldown is open — two human messages since Alex spoke. An ACI Chair answers
a selected opportunity on nearly every message, and an opportunity bypasses the
cooldown, so `messagesSinceLastAI` stays at 1. Over S-C4-003's twenty-one turns
**both moves were selectable on one** (anchor 27). Zero recaps in every replay of
that session at every prompt version follows from the gate, not from the Judge's
judgement. Ungating is a pacing change; filed as an open thread in `ARCHITECTURE.md`.

### S-C2-003, 2026-09-22 — the first session where mediation fired

Ten mediations, the first in any recorded session, and the humans pooled notes on
all four candidates. Three of the ten asked for a candidate that was already
covered, all three the same one.

| seq | list at that turn | what Alex asked for |
|---|---|---|
| 10 | uncovered B, C | (no candidate named) |
| 16 | uncovered C | (no candidate named) |
| 19 | uncovered C | notes on **C and B** |
| 22 | uncovered C | notes on **B** |
| 26 | uncovered C | notes on **B** |
| 29 | uncovered C | notes on C |
| 48, 51, 54, 57 | no gap left | named A and D as the two finalists, asked for no notes |

The last four are the v16 wording working: with nothing uncovered, Alex stopped
asking for notes and mediated about where the discussion stood. Nothing was
invented on any of the ten.

`pooled` reads A2 B2 C0 D2 from seq 13 to the end. The arithmetic is correct on
every turn in the table; what differed was which picture each side of the turn
read. Fix and reasoning in `ARCHITECTURE.md`, "One sentence says who still owes
notes".
