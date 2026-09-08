// candidateList — which candidates still need the group's attention, derived
// from the board once per turn.
//
// Shadow only. Nothing in routing, cadence, generation or the prompts reads
// this; it is written to the turn record so that a real session can be read
// against it before it is ever allowed to steer speech.
//
// The list is a measure of attention, not of merit. It deliberately does not
// read `score`, which is computed here for the record and for the one move that
// legitimately needs it — see `docs/adr/0009`.

import { CANDIDATES, allSurfacedIds } from "./informationPools.js";
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
 * The coverage at which a candidate stops needing the group's attention.
 *
 * One past the shared set, and that is the whole derivation: a candidate can
 * reach `SHARED_PER_CANDIDATE` on traits every participant could already see,
 * so only the next one guarantees that something beyond the common pool has
 * been said about it. Below this bar the group has not pooled anything about
 * the candidate; at or above it, it has pooled at least once.
 *
 * This is the lowest bar that means anything. A higher one may read better on
 * real sessions, but it would be chosen — and the cost of this one being too
 * low is a nudge not given, never a candidate wrongly dropped.
 */
export const COVERAGE_ENOUGH = SHARED_PER_CANDIDATE + 1;

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
  /** Candidates the group has not yet pooled anything about, in candidate order. */
  live: Cand[];
  /** Candidates something past the shared set has been said about, in candidate order. */
  covered: Cand[];
}

/**
 * The list for one turn, computed from the board and nothing else.
 *
 * "The board" is what has actually been put in view — traits a human surfaced,
 * plus traits Alex has said. Alex's unspoken profile is in neither set, so a
 * trait Alex holds counts toward the list only once Alex has paid for it with a
 * disclosure the pooling measure records (`docs/adr/0008`).
 *
 * A candidate leaves the list when its coverage reaches `COVERAGE_ENOUGH`, and
 * for no other reason. There is no relative test, no ordering, and nothing
 * carried between turns. Coverage never falls, so the list only shrinks; an
 * empty list is meaningful rather than a fault, and says every candidate has had
 * something unshared said about it.
 */
export function computeCandidateList(revealStats: unknown): CandidateListState {
  const coverage = {} as Record<Cand, number>;
  const score = {} as Record<Cand, number>;
  for (const candidate of CANDIDATES) {
    coverage[candidate] = 0;
    score[candidate] = 0;
  }
  for (const id of allSurfacedIds(revealStats)) {
    const trait = TRAIT_BY_ID.get(id)!;
    coverage[trait.candidate] += 1;
    score[trait.candidate] += trait.valence === "pos" ? 1 : -1;
  }

  const live: Cand[] = [];
  const covered: Cand[] = [];
  for (const candidate of CANDIDATES) {
    (coverage[candidate]! >= COVERAGE_ENOUGH ? covered : live).push(candidate);
  }
  return { coverage, score, live, covered };
}
