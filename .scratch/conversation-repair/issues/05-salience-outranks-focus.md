# 05: Let the candidate actually being named win

**What to build:** When a participant names a candidate, that candidate is what
Alex attends to. Two defects stop this today: the detector misses a bare letter,
and an inference about an earlier announcement outranks the name in front of it.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## The defect, as observed

**A. The literal-candidate detector misses ordinary positions.** A bare `A` in a
sentence like "lay out A first" is not detected, so salience never records it.
Salience is the most recent seq at which each candidate was named, and it is the
thing that ranks a candidate's claim on Alex's attention precisely because it is
deterministic and always defined — a detector that misses names makes it neither.
The English article "a" is the reason the detector is cautious, and the fix has
to keep guarding against it.

**B. Focus outranks salience when it should not.** Focus is the single candidate
the Observer judges the conversation to be about, and it is absent exactly when
it would matter most — a comparison names two candidates, a continuation names
none. It is a hint. Today a focus derived from a carried thread beats the
candidate a participant just named. **T-C2-039** seq 10 is the direct case.

## The change

Focus wins only when its basis is the current explicit one. A focus carried from
an earlier thread is an inference about an announcement, and it must not outrank
a name in the current message. Otherwise salience ranks.

The two are one issue because B alone is half-blind: inverting the precedence
does not help on the turns where A stopped the name from being recorded at all.

See `docs/adr/0004-salience-ranks-opportunities.md` for why salience is the
ranking and focus is not.

## What must not regress

- Salience stays deterministic and always defined. Nothing here may make it
  depend on a model's judgement
- A comparison naming two candidates still produces no focus, and still ranks
- The detector must not match the English article

- [ ] A bare candidate letter in an ordinary sentence position updates salience
- [ ] The English article does not
- [ ] Focus outranks salience only on a current explicit basis
- [ ] The T-C2-039 seq 10 shape resolves to the named candidate; regression
      covers the carried-thread case in both directions
