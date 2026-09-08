# 02: CONTEXT.md — the glossary

**What to build:** A glossary at the repository root that lets a reader learn this
project's domain without reading any repair history. It is a glossary and nothing
else: no implementation details, no decisions, no status, no file paths.

The terms are the ones already load-bearing across code, prompts, tests and the
checkpoint, and currently explained in-line, repeatedly, wherever each was first
needed: the pipeline roles; opportunity and its kind and expectation axes; thread,
floor, human floor, cooldown; route and the route kinds; trait, candidate, profile,
hidden profile, and the traits one participant alone holds; the three distinct
sets the code keeps apart for what has been surfaced, confirmed, and known; reveal
budget, output scope guard, request scope, request intent; supersession, consumed,
capitulation; condition, Peer and Leader, and condition orthogonality.

Two ambiguities are resolved here rather than carried forward. **Focus and
salience** were separated when opportunity ranking moved from one to the other, but
prose still uses them interchangeably. **Scope** currently means two different
things — the breadth of what a participant asked for, and the limit the output
guard enforces — and the glossary must name each separately.

Record the resolution, not the argument. Where a term was deliberately narrowed,
say what it now excludes.

**Blocked by:** 01 — for the glossary assertions in the acceptance criteria below,
not for the writing itself, which can begin in parallel.

**Status:** done

- [x] The glossary exists at the repository root and covers every term group above
- [x] Focus and salience have separate entries that state what distinguishes them
- [x] The two meanings of scope have separate named entries
- [x] No term is defined twice; every term has a definition body
- [x] The file contains no code fences and no file paths — the mechanical proxy for
      "glossary and nothing else"
- [x] `docs:check` asserts the three properties above and fails if any is violated
- [x] A reader can answer "what is an opportunity, and when is it consumed?" from
      this file alone

## Comments

Landed 2026-09-08. 36 terms in six groups. Written test-first at the agreed seam:
the glossary assertions went in and failed on a missing file before a word of the
glossary existed, then each was verified by breaking it — a term defined twice, a
term with no body, a code fence, a path, a filename.

Every definition was read out of the code rather than recalled. That was worth
doing: the reveal sets are not what their names suggest. *Surfaced* is explicitly
documented as usable only for repetition prevention, *confirmed* falls back to
human-surfaced when nothing was explicitly confirmed, and *known* is the union
including Alex's own card. Three sets that a careless reading collapses into one.

**Two terms are now opinionated, which was the point of the ticket.** *Scope* is
split into request scope and reveal budget, with bare "scope" listed as the thing
to avoid, because a single word meaning both is how a guard came to be checked
against the wrong quantity. *Focus* and *salience* are separated with the reason
stated: focus is absent exactly on comparison and continuation turns, so it is a
hint and salience is the ranking.

**One deliberate omission, worth flagging.** The glossary defines *pooled answer*
without naming which candidate it is. This file is tracked and read by agents that
also write generation prompts, and naming the answer risks it reaching Alex, which
would quietly destroy the task. The value is already an invariant in the trait
dataset, so nothing is lost by leaving it out here.

**A fix to ticket 01's own checker, found reviewing this one.** The path assertion
matched a bare "client/" or "server/" prefix, so the ordinary phrase "a
client/server split" would have failed the build. Narrowed to segments a real path
in this repo always carries. Verified both ways: the prose now passes, a genuine
path still fails.

*Match / Miss* and *Peer / Leader* are each one entry defining a pair. The format
expects one term per entry; these two are opposed halves of a single distinction
and read worse apart. Noted rather than hidden, in case the convention should be
tightened later.

No section of the checkpoint moved in this ticket, so the migration map is
unchanged — the glossary is new writing, not relocated content.
