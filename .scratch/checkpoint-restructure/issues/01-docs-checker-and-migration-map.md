# 01: Prefactor — the docs checker and the migration map

**What to build:** A single command, `npm run docs:check`, that passes against the
repository exactly as it stands today, plus the migration map it reads. The map
records every section heading currently in the repair checkpoint and marks each
one `unmoved`. From this ticket onward, a section that disappears without being
accounted for in the map is a build failure rather than something a reader has to
notice.

This ticket moves no content. It exists so that every later ticket is verifiable,
and it must come first: the map is a census of the pre-migration state, and a
census taken after the move proves nothing.

Also included, because it gates ticket 03 and is one line: narrow the repository's
ignore rule so `docs/adr/` is tracked, in exactly the way `docs/agents/` already
is. Everything else under `docs/` stays local-only, deliberately — that is the
current, intended state and must not widen.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] `npm run docs:check` exists, runs from the server package alongside the four
      existing suites, and follows their shape: a plain Node script using
      `node:assert`, no test framework, printing a single pass line
- [x] The checker asserts that every section-style cross-reference and every
      relative markdown link in the tracked documentation resolves to a heading or
      file that exists
- [x] The migration map is committed as data the checker reads, listing every
      section heading presently in the repair checkpoint, each marked unmoved
- [x] The checker reports unmoved entries without failing on them, so it passes
      today; the assertion that zero remain is switched on in ticket 06
- [x] `docs/adr/` becomes trackable through a narrow negation beside the existing
      one; verify by listing what the change newly tracks and confirming it is only
      that directory
- [x] The four existing test suites are untouched and still pass

## Comments

Landed 2026-09-08. The checker lives beside the four existing suites and runs the
same way; the census lives beside it, because everything under `docs/` except the
two negated directories is untracked and a census that does not travel is not a
census.

The census was recaptured once. The first pass recorded only two heading levels
while the checker read all of them, so eight subsections — every part of the
Observer overlap design — were invisible to the map. A census that silently omits
the sections most likely to move would have been worse than none.

Verified by breaking it three ways and confirming each failure, rather than by
observing that it passes: a section renamed out of existence, a pointer to a
section that does not exist, and a link to a file that does not exist. All three
are caught with the offending name in the message.

Cross-references in the checkpoint all resolve as it stands — 61 sections, no
dangling pointer — so the failures above are the checker working, not a backlog.

One thing to raise: the triage vocabulary configured for this repo is five triage
*roles*, with no terminal state. On a hosted tracker a finished issue is closed;
in local markdown there is nothing to close, so this file is marked `done`, which
is outside the configured set. Either the vocabulary wants a sixth entry or
finished tickets want a different convention — Sumin's call.
