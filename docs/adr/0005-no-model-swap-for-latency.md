---
status: accepted
date: 2026-09-07
---

# The Observer's latency is not fixed by changing its model

The Observer is the largest remaining cost in a turn, and the obvious remedy is a
faster model. We are not taking it. Latency will be bought by taking the Observer
off the critical path instead — deciding the deterministic vetoes before paying
for it, and later splitting the call — because which models produced the observed
behaviour is part of the study's record.

## Why the obvious option is the expensive one

Swapping the model changes no code and would plainly help. But every session
measured so far was produced by a particular pair of models, and the pre-
registration and IRB record name them. Changing one mid-study either invalidates
the comparison with everything measured before it or obliges a re-run; the
engineering saving is hours and the research cost is a study arm.

This is a constraint that is invisible in the code. Without it recorded, the next
person to look at a six-second observer call will reach for the model dropdown,
correctly by every engineering measure.

## Consequence

The latency work is harder than it needs to be, and the target may not be reached
by structural changes alone. If it is not, the choice returns as a research
decision with its own re-run cost — not as an optimisation.
