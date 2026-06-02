import Bottleneck from "bottleneck";
import { normalizeDoi } from "../lib/doi.js";
import { withCache } from "./cache.js";
import { logger } from "../lib/logger.js";

// Per CLAUDE.md §7.1, §15.11. All OpenAlex calls go through the cache.

const BASE = "https://api.openalex.org";

// Conservative safety cap. OpenAlex's stated rate limit is 10 req/sec
// for the polite pool and higher with a key, but we never need that.
const limiter = new Bottleneck({
  minTime: 100,           // 10 req/sec
  maxConcurrent: 4,
});

// One-time auto-downgrade flag. If OpenAlex rejects our api_key with 401, we
// strip it for the rest of the run and rely on the polite pool (mailto).
let apiKeyDisabled = false;

function authParams(): URLSearchParams {
  const u = new URLSearchParams();
  const apiKey = process.env.OPENALEX_API_KEY;
  if (!apiKeyDisabled && apiKey && !apiKey.startsWith("REPLACE")) u.set("api_key", apiKey);
  const email = process.env.CONTACT_EMAIL;
  if (email && !email.includes("example.com")) u.set("mailto", email);
  return u;
}

async function getJson(url: string): Promise<unknown> {
  let res = await limiter.schedule(() =>
    fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent() } }),
  );
  if (res.status === 401 && !apiKeyDisabled) {
    apiKeyDisabled = true;
    logger.warn(
      "OpenAlex rejected api_key with 401. Disabling api_key for the rest of the run and using polite pool (mailto). Verify OPENALEX_API_KEY in .env.",
    );
    // Strip api_key from this URL and retry once.
    const stripped = url.replace(/([?&])api_key=[^&]+&?/g, (_m, sep: string) => sep).replace(/[?&]$/, "");
    res = await limiter.schedule(() =>
      fetch(stripped, { headers: { Accept: "application/json", "User-Agent": userAgent() } }),
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAlex ${res.status} ${res.statusText} on ${redactUrl(url)}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

function redactUrl(url: string): string {
  // Strip the api_key query param so it never appears in logs/errors.
  return url.replace(/([?&]api_key=)[^&]+/g, "$1<redacted>");
}

function userAgent(): string {
  const email = process.env.CONTACT_EMAIL;
  return `prompt-management-system/0.1.0 (mailto:${email ?? "unknown"})`;
}

// ─────────────────────────────────────────────────────────────────
// Public types — narrow projections of OpenAlex's wider schema.
// ─────────────────────────────────────────────────────────────────

export interface OpenAlexWork {
  id: string;                       // e.g. "https://openalex.org/W123…"
  doi: string | null;               // normalized (no URL prefix)
  title: string | null;
  publication_year: number | null;
  authors: string[];                // display names
  venue: string | null;             // host venue display name
  abstract: string | null;          // reconstructed from inverted index
  cited_by_count: number | null;
  type: string | null;              // article / review / etc.
}

interface RawOpenAlexAuthorship {
  author?: { display_name?: string };
}

interface RawOpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  authorships?: RawOpenAlexAuthorship[];
  host_venue?: { display_name?: string };
  primary_location?: { source?: { display_name?: string } };
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  type?: string;
}

function projectWork(w: RawOpenAlexWork): OpenAlexWork {
  return {
    id: w.id ?? "",
    doi: normalizeDoi(w.doi ?? null),
    title: w.title ?? null,
    publication_year: w.publication_year ?? null,
    authors: (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n)),
    venue:
      w.host_venue?.display_name ??
      w.primary_location?.source?.display_name ??
      null,
    abstract: w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index) : null,
    cited_by_count: w.cited_by_count ?? null,
    type: w.type ?? null,
  };
}

function reconstructAbstract(idx: Record<string, number[]>): string {
  const positions: Array<{ pos: number; word: string }> = [];
  for (const [word, posList] of Object.entries(idx)) {
    for (const p of posList) positions.push({ pos: p, word });
  }
  positions.sort((a, b) => a.pos - b.pos);
  return positions.map((p) => p.word).join(" ");
}

// ─────────────────────────────────────────────────────────────────
// Operations.
// ─────────────────────────────────────────────────────────────────

/** Fetch one work by DOI. Cached by normalized DOI. */
export async function fetchByDoi(doi: string): Promise<OpenAlexWork | null> {
  const norm = normalizeDoi(doi);
  if (!norm) return null;
  return withCache("openalex", norm, async () => {
    const params = authParams();
    const url = `${BASE}/works/doi:${encodeURIComponent(norm)}?${params.toString()}`;
    try {
      const raw = (await getJson(url)) as RawOpenAlexWork;
      return projectWork(raw);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("404")) return null as unknown as OpenAlexWork;
      throw e;
    }
  });
}

export interface SearchOptions {
  query: string;
  perPage?: number;     // default 25, max 200
  maxResults?: number;  // total results to fetch across pages; default 25
}

/** Keyword search. Cached by stringified query+page params. */
export async function search(opts: SearchOptions): Promise<OpenAlexWork[]> {
  const perPage = opts.perPage ?? 25;
  const target = opts.maxResults ?? 25;
  const pages = Math.max(1, Math.ceil(target / perPage));

  const out: OpenAlexWork[] = [];
  for (let page = 1; page <= pages && out.length < target; page++) {
    const params = authParams();
    params.set("search", opts.query);
    params.set("per-page", String(perPage));
    params.set("page", String(page));
    // Bias toward research articles and reviews, exclude erratum/editorial noise.
    params.set("filter", "type:article|review");
    const cacheKey = `${opts.query}|p${page}|n${perPage}|type:article|review`;
    const results = await withCache("openalex_search", cacheKey, async () => {
      const url = `${BASE}/works?${params.toString()}`;
      const raw = (await getJson(url)) as { results?: RawOpenAlexWork[] };
      return (raw.results ?? []).map(projectWork);
    });
    if (results.length === 0) break;
    out.push(...results);
    logger.debug({ query: opts.query, page, got: results.length }, "openalex.search.page");
  }
  return out.slice(0, target);
}
