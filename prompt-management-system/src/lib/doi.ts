// Per CLAUDE.md §15.11. DOI normalization is the cache key. Cache misses
// caused by URL-prefix or case differences are a quiet correctness bug,
// so normalization is centralized here.

const URL_PREFIXES = [
  "https://doi.org/",
  "http://doi.org/",
  "https://dx.doi.org/",
  "http://dx.doi.org/",
  "doi:",
];

/**
 * Returns the canonical lowercase DOI body (e.g. "10.1037/0022-3514.48.6.1467"),
 * or null if the input does not contain a valid-looking DOI.
 */
export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  for (const p of URL_PREFIXES) {
    if (s.toLowerCase().startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = s.replace(/\/+$/, "").toLowerCase();
  // DOIs always start with "10." followed by a registrant number then "/".
  if (!/^10\.\d{4,9}\/\S+$/.test(s)) return null;
  return s;
}

/**
 * Build a filesystem-safe filename for a DOI. Slashes and other path-unsafe
 * characters become "__".
 */
export function doiToFilename(doi: string): string {
  return doi.replace(/[\/\\:*?"<>|]/g, "__");
}
