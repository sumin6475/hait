// candidateList — which candidates the group is still working on, derived from
// the board once per turn.
//
// Shadow only. Nothing in routing, cadence, generation or the prompts reads
// this; it is written to the turn record so that a real session can be read
// against the thresholds before they are ever allowed to steer speech. The
// thresholds are chosen, not derived, and the only large corpus is a different
// architecture that cannot be replayed against them.

import { CANDIDATES, allSurfacedIds } from "./informationPools.js";
import { TRAIT_BY_ID, type Cand } from "./traitData.js";

/** Enough of a candidate is in view for the group to have an opinion about it. */
export const LIVE_LIST_MIN_COVERAGE = 4;
/** How far behind the best-covered candidate one may fall and still be dropped. */
export const LIVE_LIST_COVERAGE_LAG = 2;
/** How far behind the best score one must trail to be dropped. */
export const LIVE_LIST_SCORE_LAG = 2;

export interface CandidateListState {
  /** Distinct traits on the board for each candidate, matches and misses together. */
  coverage: Record<Cand, number>;
  /** Matches minus misses on the board. Every trait weighs the same. */
  score: Record<Cand, number>;
  /** The candidates still being worked on, in candidate order. Never empty. */
  live: Cand[];
  /** The candidates this turn's board sets aside, in candidate order. */
  setAside: Cand[];
}

/**
 * The live list for one turn, computed from the board and nothing else.
 *
 * "The board" is what has actually been put in view — traits a human surfaced,
 * plus traits Alex has said. Alex's unspoken profile is in neither set, so a
 * trait Alex holds counts toward the list only once Alex has paid for it with a
 * disclosure the pooling measure records.
 *
 * A candidate is set aside when all three hold: it has been looked at
 * (`coverage >= LIVE_LIST_MIN_COVERAGE`), it has not merely been ignored
 * (`coverage` within `LIVE_LIST_COVERAGE_LAG` of the best-covered other
 * candidate), and it trails the best score by at least `LIVE_LIST_SCORE_LAG`.
 * The middle test is the load-bearing one: without it a candidate falls out for
 * having been skipped rather than for being weak, which is the shape a hidden
 * profile produces.
 *
 * The three tests run once, in a single pass, against all four candidates —
 * not to a fixed point over a shrinking live set. Setting a candidate aside can
 * only lower `max(coverage of the others)`, which loosens the middle test for
 * everyone left, so iterating would let one removal cascade into exactly the
 * removals that test exists to prevent. The best-scoring candidate is never set
 * aside (it trails itself by 0), so the score test's reference point is the same
 * either way and the list is never empty. One pass sets aside a subset of what
 * iterating would.
 *
 * Nothing is carried between turns: a candidate returns to the list the moment
 * new information puts it back, so there is no reopening path to get wrong.
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

  const bestScore = Math.max(...CANDIDATES.map((candidate) => score[candidate]!));
  const live: Cand[] = [];
  const setAside: Cand[] = [];
  for (const candidate of CANDIDATES) {
    const bestOtherCoverage = Math.max(
      ...CANDIDATES.filter((other) => other !== candidate).map((other) => coverage[other]!),
    );
    const lookedAt = coverage[candidate]! >= LIVE_LIST_MIN_COVERAGE;
    const notMerelyIgnored = coverage[candidate]! >= bestOtherCoverage - LIVE_LIST_COVERAGE_LAG;
    const trailing = bestScore - score[candidate]! >= LIVE_LIST_SCORE_LAG;
    (lookedAt && notMerelyIgnored && trailing ? setAside : live).push(candidate);
  }
  return { coverage, score, live, setAside };
}
