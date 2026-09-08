# 06: Stop the task-grounding shortcut discarding the observation

**What to build:** When a participant drifts off the task, Alex's correction no
longer throws away what the Observer read about that same message. Today a
regex on the raw message text bypasses the observation snapshot entirely, so
anything else the message contained goes unanswered.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] A message that both drifts and contributes gets both handled
- [ ] The route consumes the observation snapshot rather than the raw text
- [ ] The Chair response varies in form
- [ ] A Member still refuses task-standard correction, by the existing assertion,
      unedited
