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

**Status:** ready-for-agent

- [ ] The glossary exists at the repository root and covers every term group above
- [ ] Focus and salience have separate entries that state what distinguishes them
- [ ] The two meanings of scope have separate named entries
- [ ] No term is defined twice; every term has a definition body
- [ ] The file contains no code fences and no file paths — the mechanical proxy for
      "glossary and nothing else"
- [ ] `docs:check` asserts the three properties above and fails if any is violated
- [ ] A reader can answer "what is an opportunity, and when is it consumed?" from
      this file alone
