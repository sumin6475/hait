// candidateList — which candidates still need the group's attention, derived
// from the board once per turn.
//
// Shadow for routing, cadence and generation, which still read none of it. The
// one live reader is the Chair's coverage sentence (`leaderCoverageNote`), which
// turns the list into a line in the Judge's turn facts; peers get nothing. It is
// also written to every turn record so a session can be re-read against a
// different bar afterwards.
//
// The list is a measure of attention, not of merit. It deliberately does not
// read `score`, which is computed here for the record and for the one move that
// legitimately needs it — see `docs/adr/0009`.

import { CANDIDATES, allSurfacedIds, humanPooledIds } from "./informationPools.js";
import { TRAIT_BY_ID, TRAIT_DB, type Cand } from "./traitData.js";

/**
 * The most traits for any one candidate that every profile can see.
 *
 * Derived rather than written down, so it stays true to the dataset. It is 4:
 * each candidate has exactly four traits carried by all three profiles.
 */
const SHARED_PER_CANDIDATE = Math.max(
  ...CANDIDATES.map(
    (candidate) =>
      TRAIT_DB.filter((trait) => trait.candidate === candidate && trait.profiles.length === 3)
        .length,
  ),
);

/**
 * The fewest traits any one candidate has that Alex does not hold.
 *
 * Derived, like the number above, and it is 4: each candidate carries ten
 * traits, Alex's profile holds six of them — the four every card shows plus two
 * of its own — and the remaining four sit on exactly one human's card. The same
 * four for every candidate, so the bar below falls identically on all of them
 * and no candidate is easier or harder to retire than another.
 */
const HUMAN_ONLY_PER_CANDIDATE = Math.min(
  ...CANDIDATES.map(
    (candidate) =>
      TRAIT_DB.filter((trait) => trait.candidate === candidate && !trait.profiles.includes("Z"))
        .length,
  ),
);

/**
 * How much a human has to have pooled before a candidate leaves the list.
 *
 * One. Below it nothing a participant holds privately about that candidate has
 * reached the group; at or above it, something has.
 *
 * The bar this replaces was `SHARED_PER_CANDIDATE + 1`, counted over the whole
 * board (`docs/adr/0009`). Its derivation was sound and its counter was not: a
 * candidate could pass it on traits Alex alone had said. Alex holds six traits
 * per candidate, so one message clears a bar of five by itself, and in both
 * T-C2-050 and T-C2-051 **every** candidate left the list on an Alex
 * disclosure — B at seq 9, C at 12, A and D together at 17 in 051, all four the
 * same way in 050. The leader was then told the group had covered everything
 * while the four human-only traits for the pooled answer were still unsaid in
 * both sessions. See `docs/adr/0011`.
 *
 * Raising it further is not available. Two is not derivable from anything Alex
 * may know: participants are never told how many traits a candidate has, and a
 * bar reasoning about what is still missing runs Alex on an information
 * advantage the design does not grant (`docs/adr/0009`, "The repair that is not
 * available"). One is the largest claim the board can support.
 */
export const POOLED_ENOUGH = 1;

export interface CandidateListState {
  /** Distinct traits on the board for each candidate, matches and misses together. */
  coverage: Record<Cand, number>;
  /**
   * Matches minus misses on the board. Recorded, and not an input to the list.
   *
   * Over a shared-dominated board this ranks the candidates backwards — see
   * `docs/adr/0009` — so it may never decide what the group works on next.
   */
  score: Record<Cand, number>;
  /**
   * Traits on the board for each candidate that a human put there and Alex does
   * not hold. This is the quantity the list is built on.
   */
  pooled: Record<Cand, number>;
  /** Candidates no human has yet brought anything of their own about, in candidate order. */
  live: Cand[];
  /** Candidates a human has pooled something about, in candidate order. */
  covered: Cand[];
}

/**
 * The list for one turn, computed from the board and nothing else.
 *
 * "The board" is what has actually been put in view — traits a human surfaced,
 * plus traits Alex has said. Alex's unspoken profile is in neither set
 * (`docs/adr/0008`), and that still holds.
 *
 * A candidate leaves the list when a human has put something about it on the
 * board that Alex does not hold, and for no other reason. Coverage and score are
 * computed beside it for the record and decide nothing. There is no relative
 * test, no ordering, and nothing carried between turns; the pooled count never
 * falls, so the list only shrinks. An empty list is meaningful rather than a
 * fault, and now says that every candidate has had something brought to it from
 * somebody's own notes — which is the thing a leader can act on, and which the
 * coverage bar it replaces could be satisfied by Alex alone.
 */
export function computeCandidateList(revealStats: unknown): CandidateListState {
  const coverage = {} as Record<Cand, number>;
  const score = {} as Record<Cand, number>;
  const pooled = {} as Record<Cand, number>;
  for (const candidate of CANDIDATES) {
    coverage[candidate] = 0;
    score[candidate] = 0;
    pooled[candidate] = 0;
  }
  for (const id of allSurfacedIds(revealStats)) {
    const trait = TRAIT_BY_ID.get(id)!;
    coverage[trait.candidate] += 1;
    score[trait.candidate] += trait.valence === "pos" ? 1 : -1;
  }
  for (const id of humanPooledIds(revealStats)) {
    pooled[TRAIT_BY_ID.get(id)!.candidate] += 1;
  }

  const live: Cand[] = [];
  const covered: Cand[] = [];
  for (const candidate of CANDIDATES) {
    (pooled[candidate]! >= POOLED_ENOUGH ? covered : live).push(candidate);
  }
  return { coverage, score, pooled, live, covered };
}

/**
 * Kept so the two derivations stay visible next to each other and a test can pin
 * them. Neither decides the list any more; `POOLED_ENOUGH` does.
 */
export const DERIVED_COUNTS = {
  sharedPerCandidate: SHARED_PER_CANDIDATE,
  humanOnlyPerCandidate: HUMAN_ONLY_PER_CANDIDATE,
} as const;
