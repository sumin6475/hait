# 04: Tell the generator what it has already said

**What to build:** Alex stops reciting its own earlier messages. The bound that
stops the recital is in place; the positive half — telling the generator which
traits it has already put in view — is not.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

**T-C1-025** seq 7 restated fifteen traits and introduced none. The reveal budget
counted only *newly introduced* traits at the time, so a message made entirely of
already-surfaced ones passed every guard.

The hard half shipped: guards now also carry a restated-trait bound, violated as
`too_many_restated_traits`. That stops the recital after the fact. It does not
tell the generator what it has already said, so the generator still has to be
stopped rather than simply not doing it.

## The change

Inject the traits Alex has itself surfaced into the generator prompt, as "already
stated by you".

Use the right set. **Surfaced** covers everything said aloud by anyone and its
only legitimate use is avoiding repetition — which is exactly this use, and only
this use. It must not become an input to what Alex believes the group knows;
that is **confirmed**, and conflating the two is a defect this repair has already
had to fix once.

## What must not regress

- Surfaced never stands in for confirmed anywhere downstream of this change
- The restated bound stays enforced. This makes the violation rarer; it does not
  make the guard unnecessary
- The prompt addition must not grow with the session without bound — a set that
  accumulates for 81 messages is a cost line, and the Observer has already been
  caught growing that way

- [x] The generator prompt names the traits Alex has already surfaced
- [x] `too_many_restated_traits` becomes rare rather than absent, and the bound
      remains in force — the guard is untouched
- [x] The injected set is Alex's own surfaced traits, not the confirmed set, and
      nothing else reads it
- [x] The addition's size is bounded, and the bound is stated — twelve, most
      recent first

## Comments

### The set, and the one it is not

`aiSurfacedIds`, read directly. Not `allSurfacedIds`, which would tell Alex it had
said things a participant said; not `humanConfirmedIds`, which is a different
question — what Alex may treat as grounded — and the conflation this repair has
already had to fix once.

The regression asserts the separation from the other direction as well as this
one: a trait that is human-confirmed and not Alex-surfaced does not appear in the
block. Swapping the source fails the suite.

Nothing downstream reads the block. It is a string in the developer prompt, and
the only consumer is the generator.

### The bound

**Twelve points, most recent first.** The set grows for the whole session, and
an unbounded prompt addition is a cost line — the Observer has already been
caught growing that way. Twelve is roughly 120 tokens and does not move with
session length.

Most recent first because the recital shape restates what is freshest, and
because if something has to fall off, the turn Alex is about to take is more
likely to repeat what it just said than what it said twenty messages ago. When
the list is truncated it says so, so the generator does not read it as the
complete record of its own turns.

### Which routes

`address`, `followup`, `build_on`, `long_silence` — the routes on which Alex
contributes content of its own. Greeting, summary and closing are fixed-format,
backchannel has nothing to repeat, and **mediation is deliberately excluded**:
its guard forbids new traits and its contract forbids enumerating discussed ones,
so handing it a trait list would work against that rather than with it.

### What was not touched

The restated-trait bound. This makes the violation rarer; the issue said it does
not make the guard unnecessary, and the guard is unchanged. Its bounds are now
recorded on the turn as well (issue 09), so "rarer rather than absent" is
something a future export can actually show.

### Verification

Three breaks confirmed the assertions fail: sourcing the block from the confirmed
set, removing the cap, and dropping the most-recent-first ordering.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live.**
