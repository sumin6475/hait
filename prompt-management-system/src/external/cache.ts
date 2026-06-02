import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { doiToFilename } from "../lib/doi.js";
import { logger } from "../lib/logger.js";

// Per CLAUDE.md §13, §14.6, §15.11. The cache is COMMITTED to git for
// reproducibility. Every OpenAlex/S2 call goes through the cache first.

const CACHE_ROOT = resolve(process.cwd(), process.env.CACHE_DIR ?? "./cache");

export type CacheNamespace = "openalex" | "openalex_search" | "s2";

function namespaceDir(ns: CacheNamespace): string {
  // Per the spec, openalex/ and s2/ are the two committed roots. Search-result
  // pages are stored as openalex/search/<hash>.json so they share the same
  // directory tree without proliferating top-level folders.
  if (ns === "openalex_search") return join(CACHE_ROOT, "openalex", "search");
  return join(CACHE_ROOT, ns);
}

function ensureDir(d: string): void {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function cacheGet<T>(ns: CacheNamespace, key: string): T | null {
  const dir = namespaceDir(ns);
  const file = join(dir, `${safeKey(ns, key)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (e) {
    logger.warn({ ns, key, err: String(e) }, "cache.get: malformed JSON, treating as miss");
    return null;
  }
}

export function cacheSet(ns: CacheNamespace, key: string, value: unknown): void {
  const dir = namespaceDir(ns);
  ensureDir(dir);
  const file = join(dir, `${safeKey(ns, key)}.json`);
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function safeKey(ns: CacheNamespace, key: string): string {
  if (ns === "openalex" || ns === "s2") {
    // DOI-keyed. Already normalized by callers; we just escape path chars.
    return doiToFilename(key);
  }
  // Search-key: arbitrary string -> sha-style short key
  return shortHash(key);
}

function shortHash(s: string): string {
  // FNV-1a 32-bit, sufficient for cache keys; not cryptographic.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export async function withCache<T>(
  ns: CacheNamespace,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const hit = cacheGet<T>(ns, key);
  if (hit !== null) {
    logger.debug({ ns, key }, "cache.hit");
    return hit;
  }
  logger.debug({ ns, key }, "cache.miss");
  const v = await fetcher();
  cacheSet(ns, key, v);
  return v;
}
