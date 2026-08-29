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

/** Any trait already spoken aloud, regardless of speaker. Use only for repetition prevention. */
export function allSurfacedIds(revealStats: any): Set<string> {
  return new Set([...humanSurfacedIds(revealStats), ...aiSurfacedIds(revealStats)]);
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
