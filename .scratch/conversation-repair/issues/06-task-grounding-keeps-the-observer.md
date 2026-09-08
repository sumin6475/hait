# 06: Stop the task-grounding shortcut discarding the observation

**What to build:** When a participant drifts off the task, Alex's correction no
longer throws away what the Observer read about that same message. Today a
regex on the raw message text bypasses the observation snapshot entirely, so
anything else the message contained goes unanswered.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

Seen at **T-C2-034** seq 5 and again at **T-C2-039** seq 5–6: the fixed
task-grounding sentence fired, and a participant's candidate elimination in the
same message went unanswered. The message did two things; the router saw one.

This is a **router defect, not prompt quality**. It was previously filed as a
prompt-wording item and moved here on that ground.

## The change

The task-grounding route reads the observation like every other route rather than
short-circuiting ahead of it. And the Chair response gains a question-form
variant, so grounding the group does not always arrive as the same sentence.

## What must not regress

- **Task-standard correction stays Chair-only.** A Member never gains it. The
  Member task-drift refusal assertion in the intervention test suite must keep
  passing unchanged — this is one of the two orthogonality assertions, and if a
  change requires editing it the change is wrong
- Both conditions still report identical facts. Only the framing differs
- The route must not become a second path to speech during a held human floor

- [x] A message that both drifts and contributes gets both handled
- [x] The route consumes the observation snapshot rather than the raw text
- [x] The Chair response varies in form
- [x] A Member still refuses task-standard correction, by the existing assertion,
      unedited — `test-intervention-v2.ts` has a zero-line deletion diff

## Comments

### Why the template had to stop being the whole reply

The fixed sentence is a complete message, and taking it forfeits the turn. So
the fix is not to make the template smarter — a template cannot answer an
elimination it was not written for — but to decide, per turn, whether the
template can be the whole reply at all.

The observation decides. A turn that names a candidate is making a point about
the board, and there the correction becomes a **mandatory block in the developer
prompt** instead: generation runs, reads the transcript and the observation like
every other route, states the same fact, and answers the rest of the message.
The `mediation` route's existing guard (`maxTraitIds: 0`) already stops Alex
introducing new facts while doing it, so nothing new had to be built to keep the
correction from becoming a contribution.

A turn that names nobody still takes the template. That is the drift-only case,
where the template is a correct and complete reply and generation would only add
variance.

### The observation, not a second reading

`observedMentionedCandidates` comes from the snapshot the route already awaited —
`conversationSituation` is that same observation rendered as prose, and this is
the one field a route has to branch on, so it is passed as data rather than
grepped out of a paragraph. The engine's task-grounding reservation passes it;
so does `executeRouteTurn` for every route that fetches its own snapshot.

There is a regression in **both** directions: told the turn named C, the route
declines the template; told it named nobody, the route takes the template even
though the raw words contain a letter. The observation outranks the text.

When no observation exists — the observer's `off` mode — the deterministic
detector stands in. That is the mode in which there is no snapshot to consume,
not a route choosing text over it.

### The second form, and the one that was not written

The correction now varies on whether Alex has already grounded the group in this
window: the same facts, a different sentence. The C4 repeat is a question, which
is what the issue asked for.

**C2's repeat is a statement, deliberately.** C4's strategy ends its turns by
drawing the team out and C2's does not — that difference is a manipulated
variable. Giving C2 a question it never had would move that variable to fix a
repetition problem, so C2 varies within its own declarative register instead.
Both conditions state identical facts, which is the constraint that mattered.

### Not a second path to speech

Nothing here touches the decision to speak. The engine's task-grounding
reservation is unchanged, including its floor gate — the block only shapes a turn
that has already been routed, and the role gate on it mirrors the template's
exactly. Breaking that gate fails the Member assertion, which is the assertion
the issue said must not be edited.

### Verification

Three breaks confirmed the assertions fail: letting the template win on a turn
that names a candidate, dropping the role gate on the instruction block, and
pinning the repeat form to the first form.

`test-intervention-v2.ts` gains assertions and deletes none — the two
orthogonality assertions pass untouched.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live.**
