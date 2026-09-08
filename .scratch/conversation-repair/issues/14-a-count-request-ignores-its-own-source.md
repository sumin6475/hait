# 14: A count request answers from the wrong set

**What to build:** "How many have we discussed?" is answered with what the group
discussed. Today it is answered with what Alex knows, and the two differ.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

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

- [ ] A count request whose source is the visible board answers from the visible
      board
- [ ] The T-C2-045 seq 46 and seq 48 shapes return 3 and 3
- [ ] A request for what Alex knows still answers from what Alex knows
- [ ] The preamble names the set actually counted, in both languages
- [ ] No model call enters the count path
