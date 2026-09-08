# 18: An inventory question without a quantifier is still an inventory question

**What to build:** "What misses do we have for Candidate A?" is answered with
Candidate A's misses. Today it classifies as no request at all, and the honest
answer is silenced.

**Blocked by:** None.

**Status:** done

## The defect, as observed

**T-C1-021, eight turns.** seq 34 asked "What misses do others have for
Candidate C?" and seq 37 "What misses do we have for Candidate A?". Both
classified `requestIntentKind: none`.

`EXPLICIT_COMPLETE_SINGLE` requires an `all|every|complete|full` quantifier in
front of the inventory noun, so the noun alone matched nothing. Nothing then
scoped the turn and nothing lifted the reveal budget. C has three misses; the
honest answer restated three already-visible traits; `maxRestatedTraitIds: 2`
rejected it; the repair reworded the same three and was rejected again.

Because a `direct_question` is `required` and never expires, Alex re-attempted
the identical answer on seq 35, 36, 39, 40, 41 and 45 and was dropped each time.
**Ten of that session's silences were this guard, against seven for the
cooldown.** The group's last eight turns had no Alex in them.

Even "What matches do you have for Candidate B?" — addressed to Alex by name in
the second person — classified `none`. This was never one phrase.

## The change

An interrogative inventory question naming one candidate classifies as
`complete_single_candidate`, and the noun carries the valence into `countKind`.

The interrogative is what does the work, not the quantifier. That also keeps
[D6] intact: "I think it would be best to just go through what information we
have on each candidate" is a first-person proposal about procedure, has no
interrogative inventory head, and still falls through.

## What must not regress

- **[D6] holds.** A proposal about how to proceed is not a request that Alex
  enumerate the board
- **The count path is not cannibalised.** "How many misses do you have for D?"
  is a `known_count_request` and must stay one — an inventory pattern loose
  enough to swallow it turns a count into a dump
- The board-recitation bound is unchanged for every request that did not ask
  for an inventory
- No new model call; the classifier stays lexical

- [x] Both T-C1-021 phrasings classify as a scoped inventory request
- [x] The valence reaches the turn, so "what misses" is not answered with matches
- [x] An inventory question naming no candidate does not become a complete list
- [x] `known_count_request` and [D6] both survive, with a regression each

## Comments

### The valence had to travel with it

`complete_single_candidate` otherwise means the whole card, and the scope block
said "List every match and every miss". Answering "what misses do we have for
A?" with A's matches too is the same over-answering the block exists to prevent,
one level in. `RequestIntent.countKind` already existed for the count path, so
the classification carries it and the block reads it.

### Gated on a named candidate

`complete_single_candidate` falls back to the conversational focus when the
candidate is null. This path deliberately does not: an inventory question that
names nobody is a question to the room, and guessing a candidate for it is how a
scope block starts answering something nobody asked.

### Verification

Four breaks: dropping the valence capture, dropping the named-candidate gate,
loosening the interrogative head, and reverting the scope block to the
both-valences wording. Each fails its own assertion. The third is caught by a
**pre-existing** assertion — it turns "how many matches do you have for D?" from
a count into an inventory request — which is the boundary that most needed a
guard and already had one.

Both real T-C1-021 messages were re-run through the built classifier, and the
T-C2-046 phrasings that already worked were re-run as controls and are
unchanged.

Build, all six `test:*` suites and `docs:check` green. **Not measured live.**

### What this does not fix

The turn still dies if any other request produces an unsatisfiable trait count —
→ **issue 17**.
