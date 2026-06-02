import Bottleneck from "bottleneck";
import { normalizeDoi } from "../lib/doi.js";
import { withCache } from "./cache.js";
import { logger } from "../lib/logger.js";

// Per CLAUDE.md §7.1. S2 is OPTIONAL enrichment. We never block OpenAlex
// stage on S2 failure. The unauthenticated pool is ~100 req/5min, which
// suffices for our ~80–150 candidate workload.

const BASE = "https://api.semanticscholar.org/graph/v1";

const apiKey = process.env.SEMANTIC_SCHOLAR_API_KEY;
const isAuthenticated = !!apiKey;

const limiter = new Bottleneck({
  minTime: isAuthenticated ? 100 : 1100,   // 0.9 r/s unauth, 10 r/s auth
  maxConcurrent: 1,
});

export interface S2Paper {
  paperId: string | null;
  title: string | null;
  year: number | null;
  venue: string | null;
  abstract: string | null;
  tldr: string | null;
  influentialCitationCount: number | null;
}

interface RawS2Paper {
  paperId?: string;
  title?: string;
  year?: number;
  venue?: string;
  abstract?: string;
  tldr?: { text?: string };
  influentialCitationCount?: number;
}

function project(raw: RawS2Paper): S2Paper {
  return {
    paperId: raw.paperId ?? null,
    title: raw.title ?? null,
    year: raw.year ?? null,
    venue: raw.venue ?? null,
    abstract: raw.abstract ?? null,
    tldr: raw.tldr?.text ?? null,
    influentialCitationCount: raw.influentialCitationCount ?? null,
  };
}

const FIELDS = ["title", "year", "venue", "abstract", "tldr", "influentialCitationCount"].join(",");

/**
 * Enrich a paper by DOI. Returns null on 404 or any failure — S2 is best-effort.
 */
export async function enrichByDoi(doi: string): Promise<S2Paper | null> {
  const norm = normalizeDoi(doi);
  if (!norm) return null;
  return withCache("s2", norm, async () => {
    const url = `${BASE}/paper/DOI:${encodeURIComponent(norm)}?fields=${FIELDS}`;
    try {
      const res = await limiter.schedule(() =>
        fetch(url, {
          headers: {
            Accept: "application/json",
            ...(apiKey ? { "x-api-key": apiKey } : {}),
          },
        }),
      );
      if (res.status === 404) return null as unknown as S2Paper;
      if (res.status === 429) {
        // Backoff once and retry. Bottleneck already serializes calls.
        await new Promise((r) => setTimeout(r, 3000));
        const retry = await limiter.schedule(() => fetch(url, { headers: { Accept: "application/json" } }));
        if (!retry.ok) {
          logger.warn({ doi: norm, status: retry.status }, "s2.enrichByDoi: retry failed");
          return null as unknown as S2Paper;
        }
        return project((await retry.json()) as RawS2Paper);
      }
      if (!res.ok) {
        logger.warn({ doi: norm, status: res.status }, "s2.enrichByDoi: non-ok");
        return null as unknown as S2Paper;
      }
      return project((await res.json()) as RawS2Paper);
    } catch (e) {
      logger.warn({ doi: norm, err: String(e) }, "s2.enrichByDoi: exception");
      return null as unknown as S2Paper;
    }
  });
}
