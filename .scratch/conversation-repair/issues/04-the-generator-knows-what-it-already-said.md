# 04: Tell the generator what it has already said

**What to build:** Alex stops reciting its own earlier messages. The bound that
stops the recital is in place; the positive half — telling the generator which
traits it has already put in view — is not.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] The generator prompt names the traits Alex has already surfaced
- [ ] `too_many_restated_traits` becomes rare rather than absent, and the bound
      remains in force
- [ ] The injected set is Alex's own surfaced traits, not the confirmed set, and
      nothing else reads it
- [ ] The addition's size is bounded, and the bound is stated
