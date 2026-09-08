# 05: Let the candidate actually being named win

**What to build:** When a participant names a candidate, that candidate is what
Alex attends to. Two defects stop this today: the detector misses a bare letter,
and an inference about an earlier announcement outranks the name in front of it.

**Blocked by:** None (can start immediately).

**Status:** done

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

- [x] A bare candidate letter in an ordinary sentence position updates salience
- [x] The English article does not
- [x] Focus outranks salience only on a current explicit basis
- [x] The T-C2-039 seq 10 shape resolves to the named candidate; regression
      covers the carried-thread case in both directions

## Comments

### A: sentence position, not a list of conjunctions

The old detector bought its safety from the article far too dearly. It took a
bare `A` only when `and`, `or`, `vs`, `versus`, a comma, a slash or the end of
the string followed — so every ordinary sentence position was invisible. B, C and
D needed no such rule; a case-sensitive `\bX\b` decided them.

The article is capitalised in exactly one place: where a sentence begins. That is
the whole of the ambiguity, and it is a position, not a word list. So an
upper-case standalone `A` anywhere else in a sentence is the candidate, and the
old evidence is kept for the sentence-initial case — widened by a following verb
or possessive, which an article cannot take ("A is the one", "A's notes", never
"A good point").

Deliberately still undetected: `A first, then B.` — sentence-initial, no verb
after it. It reads as the candidate to a person, but the only signal separating
it from "A fair summary of where we are" is the rest of the message, and reaching
for that is how a deterministic detector stops being deterministic. The
acceptance criterion is the ordinary mid-sentence position and that is what
shipped.

### B: which hint, and when

Focus arrives with a basis and the bases are not the same kind of claim. On
`current_explicit` the speaker named that candidate on this turn — and
normalization already nulls the basis when the turn's literal mentions
contradict it, so what survives is the observer's reading of which *named*
candidate the turn is about. Recency cannot express that, so it is worth
promoting.

Every other basis is an inference about an announcement further back. Ranking now
consults focus only on `current_explicit`; otherwise salience ranks.

The two changes are one issue for the reason the issue gave: B alone is
half-blind. On T-C2-039 seq 10 the inverted precedence only helps if the name in
front of Alex was recorded, and A is what stopped it being recorded.

### Where the precedence had to change

`candidateSalienceOrder` — one function, and every consumer reads ranking through
it: the Judge's eligible-trait list, the ledger description handed to the Judge,
and the opportunity ranking. Its parameter now includes `focusBasis`, so a caller
that ranks without saying what its focus is worth fails to compile.

### What was left alone

The order is still a pure derivation over recorded mentions. Nothing here reads a
model's judgement: `focusBasis` is a field the observer already emitted and
normalization already validated structurally against the turn's literal
mentions.

The comparison case is unchanged and now has a regression: two candidates named,
no focus, ranked by recency.

### Verification

Two breaks confirmed the assertions fail: making focus win on every basis, and
letting a sentence-initial `A` count unconditionally. The article cases and the
existing "A good point about B." assertion pass untouched.

`docs/adr/0004` amended — it said "focus remains as a hint", which is what left
the carried basis outranking a name.

Build, all four suites, `test:pooling-extractor` and `docs:check` green. **Not
measured live.**
