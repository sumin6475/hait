# 02: Give the Judge a role goal, and stop asking it about time

**What to build:** The Judge decides *which act, on what grounds*, and the
condition reaches that decision. Today the condition reaches only the generator,
so a Chair and a Member decide identically and merely word it differently — which
understates the manipulation, because a chair differs in what they decide to do.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] The role goal reaches the Judge's developer message and differs by condition
- [ ] `mediate` and the directive acts are absent from the Member schema, not
      merely forbidden in its prompt
- [ ] Neither Judge prompt carries a message counter or a cooldown flag
- [ ] Voluntary acts are offered to the Judge only when takeable, by the same
      filtering the opportunity list already uses
- [ ] The share of Judge decisions that survive to broadcast rises; measure it
      the same way the 18-of-19 was measured
- [ ] The orthogonality assertions pass unchanged, with no edits to them
- [ ] A Chair and a Member are blocked and released on identical turns; verify by
      running the same transcript under both conditions and comparing the turns
      on which Alex was silent, not the words
