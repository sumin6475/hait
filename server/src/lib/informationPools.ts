import { TRAIT_BY_ID, type Cand } from "./traitData.js";

export const CANDIDATES: Cand[] = ["A", "B", "C", "D"];

function validIds(ids: unknown): Set<string> {
  if (!Array.isArray(ids)) return new Set();
  return new Set(ids.filter((id): id is string => typeof id === "string" && TRAIT_BY_ID.has(id)));
}

/** Traits explicitly stated by a human participant. This preserves the legacy revealedIds source. */
export function humanSurfacedIds(revealStats: any): Set<string> {
  const ids = new Set<string>();
  for (const candidate of CANDIDATES) {
    for (const id of validIds(revealStats?.byCandidate?.[candidate]?.revealedIds)) ids.add(id);
  }
  return ids;
}

/** Traits stated by Alex. Keep this separate for pooling DV and repetition control. */
export function aiSurfacedIds(revealStats: any): Set<string> {
  return validIds(revealStats?.aiSurfacedIds);
}

/**
 * Traits grounded by a human assertion. Legacy sessions did not store this layer, so their
 * human-surfaced set is the conservative backwards-compatible source.
 */
export function humanConfirmedIds(revealStats: any): Set<string> {
  const explicit = validIds(revealStats?.humanConfirmedIds);
  const human = humanSurfacedIds(revealStats);
  if (explicit.size || human.size === 0) return explicit;
  return human;
}

/**
 * Traits a human put on the board that Alex does not hold.
 *
 * This is the part of the board that could only have come off a participant's
 * own notes. Alex's profile carries the four traits every card shows plus two of
 * its own, so anything outside it reached the group because a human pooled it —
 * and a human repeating something Alex said drops out here, which is the point.
 *
 * The live candidate list is built on this rather than on coverage: see
 * `docs/adr/0011`.
 */
export function humanPooledIds(revealStats: any): Set<string> {
  const ids = new Set<string>();
  for (const id of humanSurfacedIds(revealStats)) {
    if (!TRAIT_BY_ID.get(id)!.profiles.includes("Z")) ids.add(id);
  }
  return ids;
}

/** Any trait already spoken aloud, regardless of speaker. Use only for repetition prevention. */
export function allSurfacedIds(revealStats: any): Set<string> {
  return new Set([...humanSurfacedIds(revealStats), ...aiSurfacedIds(revealStats)]);
}

/**
 * Coverage per candidate: how many distinct traits about each are on the board.
 *
 * This and `allSurfacedIds` are the only places the board's shape is spelled
 * out. `poolingTally` used to carry four hand-written copies of the same union
 * — human `revealedIds` per candidate, plus `aiSurfacedIds` filtered by
 * candidate — byte-identical to each other and none of them reading this file.
 * They were not wrong; they were the same drift shape that cost T-C2-047 turn 9,
 * waiting for someone to edit one of the four.
 */
export function coverageByCandidate(revealStats: any): Record<Cand, number> {
  const coverage = {} as Record<Cand, number>;
  for (const candidate of CANDIDATES) coverage[candidate] = 0;
  for (const id of allSurfacedIds(revealStats)) {
    coverage[TRAIT_BY_ID.get(id)!.candidate] += 1;
  }
  return coverage;
}

export function candidatesForIds(ids: Iterable<string>): Set<Cand> {
  const candidates = new Set<Cand>();
  for (const id of ids) {
    const candidate = TRAIT_BY_ID.get(id)?.candidate;
    if (candidate) candidates.add(candidate);
  }
  return candidates;
}

function firstByObject(revealStats: any): Record<string, { by?: string; seq?: number }> {
  const firstBy = revealStats?.firstBy;
  if (firstBy instanceof Map) return Object.fromEntries(firstBy);
  return firstBy && typeof firstBy === "object" ? firstBy : {};
}

/** Most recent single-candidate human trait contribution, used only as a conversational focus. */
export function lastHumanDiscussionCandidate(revealStats: any, minimumSeq = 0): Cand | null {
  const recorded = revealStats?.lastHumanDiscussion;
  if (
    CANDIDATES.includes(recorded?.candidate) &&
    Number.isFinite(recorded?.seq) &&
    recorded.seq >= minimumSeq
  ) {
    return recorded.candidate;
  }

  // Legacy fallback: firstBy retained the source and sequence even before focus was stored.
  let latestSeq = minimumSeq - 1;
  let latestCandidates = new Set<Cand>();
  for (const [id, provenance] of Object.entries(firstByObject(revealStats))) {
    if (provenance?.by !== "human" || !Number.isFinite(provenance?.seq)) continue;
    const candidate = TRAIT_BY_ID.get(id)?.candidate;
    if (!candidate || provenance.seq! < minimumSeq) continue;
    if (provenance.seq! > latestSeq) {
      latestSeq = provenance.seq!;
      latestCandidates = new Set([candidate]);
    } else if (provenance.seq === latestSeq) {
      latestCandidates.add(candidate);
    }
  }
  return latestCandidates.size === 1 ? [...latestCandidates][0]! : null;
}
