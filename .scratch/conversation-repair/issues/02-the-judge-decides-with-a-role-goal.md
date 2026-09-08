# 02: Give the Judge a role goal, and stop asking it about time

**What to build:** The Judge decides *which act, on what grounds*, and the
condition reaches that decision. Today the condition reaches only the generator,
so a Chair and a Member decide identically and merely word it differently — which
understates the manipulation, because a chair differs in what they decide to do.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

In **T-C1-024**, 18 of 19 Judge decisions were `speak`, and every non-greeting
silence came from the router's cooldown veto applied afterwards. In each of those
the Judge had already answered `contribute` with real evidence. Judge contract
health was otherwise perfect — 8/8 first-attempt accepts, zero capitulation — so
this is not a reliability problem. **The Judge decides almost nothing, and the
cooldown counter is the controller.**

## Four changes

**A. Inject a role goal** into the developer message.
*Chair* (`leader` in the code): actively guide the group toward a well-considered
collective decision — structure the conversation, keep it focused and moving,
address disagreements, take responsibility for a clear outcome.
*Member* (`peer` in the code): contribute cooperatively as an equal team member —
share relevant information, respond constructively, help evaluate options,
without directing, managing, or mediating.

**B. Enforce orthogonality in the action space, not in the prompt.** Remove
`mediate` and the directive acts from the Member schema so they are
unrepresentable rather than merely forbidden. A rule the schema enforces cannot
be talked out of.

**C. Stop giving the Judge the clock.** Remove `Messages since Alex` and
`Ordinary cooldown available` from both Judge prompts, and remove the prose rule
that voluntary acts require the cooldown. Pacing is the router's, and the Judge
answering a question it does not own is what makes its answer discardable.

The channel that replaces them already exists and is already correct: an
opportunity the cooldown makes untakeable is **filtered out of the selectable
list** before the Judge sees it. Extend that pattern to voluntary acts — tell the
Judge what is takeable, never how much time has passed. A filtered option set is
a fact about the choices; a counter is a fact about time.

There is a real asymmetry to close here. The validator enforces the cooldown for
a selected opportunity (`selected_opportunity_requires_cooldown`) and does not
enforce it at all for a voluntary `contribute`. The prompt asks in prose, nothing
checks, and the model ignores it — which is the mechanical cause of the 18-of-19
above. Do not close the gap by adding a symmetric validator rule: that makes a
blocked turn *slower*, because the rejection triggers a retry. Close it by
removing the question.

**D. Keep the message split.** Observer facts stay in the user message, the role
goal goes in the developer message, and deterministic validation is unchanged.

## What must not regress

- **`when` is not the Judge's.** The condition may govern which act Alex selects
  and on what grounds. It must never govern the moment Alex speaks. The cooldown
  and the floor delays are condition-invariant arithmetic and must stay so. See
  `docs/adr/0001-condition-reaches-the-judge.md`.
- **The orthogonality assertions must keep passing unchanged.** Specifically the
  assertions covering Chair/Member prompt separation and the Member task-drift
  refusal, in the intervention test suite. A Member never gains mediation or
  task-standard correction. If a change requires editing one of these, the change
  is wrong.
- Three routes — mediation, summary and closing — exist only in the Chair
  conditions, so "identical triggers across conditions" already holds of the
  shared routes and not of these three. That is the pre-existing state; this work
  must not widen it.
- Authority over the group's final candidate submission stays with the human
  participants in every condition. "The AI's decisions are manipulated" means its
  own evaluation and intervention policy, never the group's outcome.

## Before the next run, not before the code

Two descriptions of the study need re-examining, and neither is an implementer's
to settle: that the AI's status is manipulated via the system prompt (true but
incomplete — the participant-facing role framing is the other half), and that the
manipulation affects how the AI communicates (now too narrow — it affects
candidate evaluation and intervention selection as well). The code can land
first; a live session must not run before these are checked.

- [x] The role goal reaches the Judge's developer message and differs by condition
- [x] `mediate` and the directive acts are absent from the Member schema, not
      merely forbidden in its prompt — `mediate` was the only one
- [~] Neither Judge prompt carries a message counter or a cooldown flag — **the
      live one does not; the legacy one is left frozen**, see below
- [x] Voluntary acts are offered to the Judge only when takeable, by the same
      filtering the opportunity list already uses — and now rejected when taken
      anyway, which this issue originally argued against; see below
- [ ] The share of Judge decisions that survive to broadcast rises; measure it
      the same way the 18-of-19 was measured — **needs a live run**
- [x] The orthogonality assertions pass unchanged, with no edits to them —
      `test-intervention-v2.ts` has a zero-line diff
- [~] A Chair and a Member are blocked and released on identical turns; verify by
      running the same transcript under both conditions and comparing the turns
      on which Alex was silent, not the words — **the criterion as written is
      wrong**, see below. What holds, and is verified by construction, is that no
      rule about when Alex may speak reads the condition

## Comments

Landed 2026-09-08. Judge `v4 → v5`, prompt `v6 → v7`, schema `v2 → v3`.

### What went in

**The role goal is its own message.** `ledgerJudgeRoleGoal(conditionCode)`
returns a developer message, placed between the fixed rules and the turn's facts.
It varies with status only — Chair or Member — because the communication strategy
is the other axis of the design and is applied at generation.

The goal's last paragraph is ADR-0001's constraint written into the prompt
itself: *this role decides which act is the right one and on what grounds; it
does not decide when Alex speaks.* The system prompt says the same from the other
side, and the opener no longer calls the Judge condition-blind.

**Orthogonality moved into the action space.** There are now two schemas, and the
Member's has no `mediate`. The act is unrepresentable rather than forbidden. It
was the only directive act in the set; the rest are shared. The wide schema stays
as the decision type, because the legacy Judge still uses it and the engine still
maps a `mediate` from that path down to `contribute`.

**The clock is gone from the live Judge's prompt.** `Messages since Alex` and
`Ordinary cooldown available` are removed, along with the two prose rules about
bypassing the cooldown. What replaces them is a *Moves available on this turn*
block listing the selectable opportunity ids, whether voluntary acts are
available, and whether `acknowledge` is. The distinction is not cosmetic: a
counter can be read as a budget, and a Judge with a condition-dependent role goal
plus a budget decides *when* differently by condition. An availability flag has
nothing to spend.

The user message is now built by an exported pure function, because what it does
and does not contain is the substance of a decision rather than an
implementation detail — and it is the only way to test it without a network call.

### One decision in this issue was reversed, by issue 01 landing first

This issue argued **against** adding a validator rule for voluntary acts: a
rejection costs a retry, so on a blocked turn it would make things slower for
nothing.

That reasoning depended on the Judge being called on turns where nothing was
takeable. After issue 01, it is not: such a turn never reaches the Judge. **Every
turn that gets here is one a retry can still win** — the bypassing opportunity is
open and the turn is winnable — so the objection is gone and the rule is in:
`voluntary_act_unavailable_this_turn`.

This closes the asymmetry that was the whole mechanical cause of the gate. The
validator enforced the cooldown for a selected opportunity and not at all for a
voluntary contribution; the prompt asked in prose and nothing checked. Both
T-C2-041 cooldown silences were voluntary contributions taken on turns the router
then discarded, and nothing rejected either one.

### One acceptance criterion is wrong as written, and this is the important part

*"A Chair and a Member are blocked and released on identical turns"* is not what
this change preserves, and it cannot be.

Once the role goal reaches the Judge, a Chair may find a mediating move on a turn
where a Member finds nothing worth saying. **The two conditions can therefore
differ on whether Alex speaks at all on a given turn.** That is not a timing rule
reading the condition — no timing rule does — but it is a difference in when Alex
speaks, and pretending otherwise would be the kind of tidy claim this repair has
already had to retract twice.

The claim that is true, and verified by construction: **no rule about when Alex
may speak reads the condition.** The cooldown is message arithmetic against one
constant; the floor delays are route constants; `deterministicVetoBeforeJudge`
takes only ledger state and that arithmetic. None of them is given the condition
code.

The looser claim was never true anyway — mediation, summary and closing are
Chair-only routes — and it is now false for a second reason, by design. Recorded
in ADR-0001 rather than left in a commit message, because it changes which
sentence the pre-registration should be defending.

### Left alone, deliberately

**The legacy Judge is frozen.** It still carries the counter, the cooldown flag
and the condition-blind opener. It is the explicit rollback and comparison mode,
and a rollback that has been quietly modernised is not a rollback. The criterion
says both prompts; one of them is a baseline and stays a baseline.

**`evidence: "cooldown"` stays in the schema.** The Judge can no longer ground it,
so it should probably go — but removing an enum value means two live branches in
the engine become dead, and that is a separate change from this one. Noted rather
than done.

**No caching win to claim.** The developer message adds roughly 90 tokens to the
static prefix, taking it to about 875 against the provider's 1,024-token minimum.
Still under. The structural explanation from T-C1-022 is unchanged.

### Verification

Tested at the existing deterministic seam, as pure functions: the built user
message, the per-condition schema, the role goal, and the validator rule. Five
breaks confirmed the assertions fail — putting the cooldown flag back in the
prompt, removing the validator rule, giving a Member the wide schema, making both
conditions share one goal, and dropping the timing boundary from the goal text.

`test-intervention-v2.ts` has a **zero-line diff**: both orthogonality assertions
pass without being touched.

Build, all five suites and `docs:check` green. **Not measured live**, and the
pre-registration and IRB wording must be checked before a session runs — the ADR
names the two sentences and now a third consequence.
