# 14: A count request answers from the wrong set

**What to build:** "How many have we discussed?" is answered with what the group
discussed. Today it is answered with what Alex knows, and the two differ.

**Blocked by:** None (can start immediately).

**Status:** done

## The defect, as observed

**T-C2-045 seq 46.** A participant asked how many of A's and B's attributes
"we've discussed together". Alex answered "Combining my complete notes with what
the team has shared, I know 4 matches and 3 misses for Candidate A", and the same
shape for B at seq 48.

The board had actually seen **3 matches and 3 misses** for each. Alex answered a
question nobody asked.

**The Observer got it right.** It classified the turn as
`known_count_request` with **`source: "visible_board"`** — it read "we've
discussed together" correctly and said so in the field that exists for exactly
this distinction.

`deterministicKnownCountResponse` never reads that field. It calls
`knownTraitIds(revealStats)` unconditionally — Alex's complete Z profile unioned
with everything surfaced — and its fixed preamble then *describes* the wrong set
accurately, which is how a wrong answer comes out sounding careful.

## Why this is the operator's "고질적인 문제"

It is the same complaint that seq 15 made out loud in this session — that Alex
"just spits back information we already have". A count that silently includes
Alex's private notes when the group asked about the shared board misreports the
one number the group is using to decide, and it does it in the phase where they
are deciding.

## The change

Read `intent.source`. `visible_board` counts the visible board — the
deduplicated union of human and Alex disclosures, which is the set summary and
complete-board answers already use — and says "we've discussed" rather than "I
know". `known_profile` and `alex_notes` keep the current behaviour.

The three sources are already carried through the whole request pipeline; this
one consumer drops them.

## What must not regress

- **The answer stays deterministic.** No model call is added to compute a count;
  this is arithmetic over sets the server already holds
- **A count is still a count.** The rule against Alex volunteering ratios, scores
  or running tallies is untouched — this only fires on an explicit count request
- The wording must match the set it counted. The current preamble is wrong for
  the visible board and would stay wrong if only the number changed
- `countKind` (all / matches / misses) keeps working under every source

- [x] A count request whose source is the visible board answers from the visible
      board
- [x] The T-C2-045 seq 46 and seq 48 shapes read the board — though see the
      correction below about what the board actually held
- [x] A request for what Alex knows still answers from what Alex knows
- [x] The preamble names the set actually counted, in both languages
- [x] No model call enters the count path

## Comments

### One field, dropped by one consumer

`RequestIntent.source` is carried the whole way from classification to
generation, and `deterministicKnownCountResponse` was the one consumer that never
read it. `visible_board` now counts `allSurfacedIds` — the same
deduplicated union summary and complete-board answers already use — and
`known_profile` and `alex_notes` keep `knownTraitIds`.

The wording moves with the number: "From what we've discussed together, we have
N matches" against "Combining my complete notes with what the team has shared, I
know N matches". Changing the count without the preamble would have left a wrong
answer that still sounded careful, which is what made this hard to see.

### Two classifier gaps found on the way

Both showed up because the live session's own wording did not survive a
round-trip through the lexical classifier.

**"attributes"** was missing from `KNOWN_COUNT_REQUESTS`. The participants used
that word; the Observer classified it and the lexical reading returned `none`.
The two disagreeing is exactly the condition D6 introduced to stop a
deterministic template firing on a reading nobody else shared, so the gap was
live even though the Observer covered for it here.

**The inverted question form.** `VISIBLE_BOARD_SCOPE` matched "we've discussed"
but not "have we discussed" — the same question, inverted because it is a
question. Added.

### A correction to this issue's own numbers

The issue says the board held 3 matches and 3 misses. **It held 3 and 4.**
`A_n1` and `B_n3` were said aloud and recorded nowhere, because the matcher
deferred them and the bounded verifier declined — → **issue 15**, found while
checking this one.

So the count was wrong twice over: it read the wrong set, and the right set was
itself short. This issue fixes the first. Issue 15 is what makes the answer
correct.

### Verification

One break confirmed the assertion fails: pinning the response to the known set
regardless of source. Regressions cover both sources, both `countKind` variants,
the lexical path and the Observer-supplied path.

Build, all four suites and `test:pooling-extractor` green. **Not measured live.**
