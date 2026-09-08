# 04: Migrate the open gates into tracker issues

**What to build:** Every piece of work still open moves out of tables inside a
1,800-line document and into the issue tracker, where status has an owner and each
item can be picked up on its own.

The work to migrate: taking the Observer off the critical path by the deterministic
route (the first of the two decided steps); the Judge role-goal gate and its four
parts; the generator's remaining length and emptiness items, including the half of
the restatement work that is still open — telling the generator what it has already
said, as opposed to merely bounding the recital; and the Observer accuracy items
that carry no latency expectation.

Each issue must **stand alone**: the defect as observed, the session that evidences
it, and the constraints it must not violate, all copied in — so that an agent can
act on it without reading the checkpoint.

Completed gates do not become issues. Their outcome belongs in the measurement log
or in an ADR.

**Blocked by:** 02 — issue titles and bodies use the glossary's vocabulary.

**Status:** ready-for-agent

- [ ] One issue per open gate item, in the tracker's own format, with its status
      field set from the project's triage vocabulary
- [ ] Each issue states the defect, names the session that evidenced it, and lists
      the invariants it must not regress
- [ ] Each issue is readable without the checkpoint open; verify by having someone
      who has not read the checkpoint say what the issue asks for
- [ ] The Observer critical-path issue records that only the first of the two
      decided steps is in scope, and why the second waits for its measurement
- [ ] The Judge issue records that the orthogonality assertions must keep passing
      unchanged, and links the ADR from ticket 03 once that exists
- [ ] No completed gate becomes an issue
- [ ] The checkpoint's gate tables are marked in the migration map as moved, naming
      the issues that now hold them
