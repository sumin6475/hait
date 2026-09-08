---
status: accepted
date: 2026-09-07
---

# Alex declines plainly, and a Member declines to compile the board

Alex may not lay information out as a table, chart or list — it writes chat prose,
because a participant does. Asked for a table it used to ask a clarifying question
instead, four turns running in one measured session, until the participant wrote
that they had hoped the AI could just make the table. Alex now says plainly that
it cannot lay it out that way and gives what it has in sentences. Separately, in
the Member conditions it declines to compile what the group has posted, on the
honest ground that it holds only its own card.

## Why the second refusal is not a matter of tone

Assembling the board is a Chair behaviour. A Member that produces the group's
consolidated board has taken on the chair's job, whatever words it uses, so the
refusal is an orthogonality property and is gated on the condition. A Chair
assembling the board is in role and has routes for it.

Both refusals are true in character, which matters because Alex may never say that
a rule or a scope prevents it from answering: it really does write chat prose, and
a Member really does hold only its own card. Neither refusal reaches for a policy.

## Why this is enforced twice

The rule lives in the frozen prompt *and* in server-derived detectors that inject
it. A prompt rule alone had already failed at this class of problem three times —
twice on length, once on clarification questions. The detector is what makes the
behaviour reliable; the prompt rule covers the turns no detector catches.

## The refusal outranks the deterministic template

There is a route that answers a whole-board request from server-held state without
calling the model. When a request is both wide enough to reach that template and
one of the two refusals applies, **the refusal wins**. Without that precedence,
widening the classifier so it stops under-reading requests would have had a Member
recite the group's board — the exact behaviour the second refusal exists to
prevent, arriving through a path that never consults the prompt.

A related asymmetry is deliberate. The Observer's reading of a request and the
lexical classifier's reading may disagree; a disagreement may widen the scope only
when the lexical reading is the wider one and the request was directed at Alex.
Anything else falls through to generation rather than to a wider template. A
template is not a safe default when the two readings conflict, because a template
cannot decline.

## Consequence

Alex will sometimes refuse a request it could technically satisfy. That is the
intended cost: the alternative was an assistant that produces artefacts no
participant could, which is a different study.
