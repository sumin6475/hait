import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import yaml from "js-yaml";
import { callAgent } from "../llm/anthropic.js";
import { fetchByDoi, search, type OpenAlexWork } from "../external/openalex.js";
import { enrichByDoi, type S2Paper } from "../external/semanticScholar.js";
import {
  ValidatedPaperSchema,
  CandidatePaperSchema,
  type ValidatedPaper,
  type CandidatePaper,
  type SourceTier,
} from "../schemas/paper.schema.js";
import { normalizeDoi } from "../lib/doi.js";
import { logger } from "../lib/logger.js";

// ─────────────────────────────────────────────────────────────────
// Agent 0 — Scout
// ─────────────────────────────────────────────────────────────────
// Per CLAUDE.md §7.1. Two stages:
//   1. Pool building: force-include P0+Done from seeds; resolve P1/P2/Reading
//      via OpenAlex (DOI or search); expand the pool with a small number of
//      keyword queries (Discovered tier); enrich via S2.
//   2. Map-Reduce rubric: score each non-force-included candidate via Haiku
//      at temperature 0.0; keep papers with utility_score >= 4.0 (fallback
//      3.5 if fewer than 8 keepers).
// Output: knowledge_base/candidate_pool.json, knowledge_base/validated_kb.md,
//         knowledge_base/citation_index.json.
// ─────────────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());

// ─────────────────────────────────────────────────────────────────
// seed_papers.yaml schema (loose; just enough to drive the pipeline).
// ─────────────────────────────────────────────────────────────────

const SeedEntrySchema = z
  .object({
    citation_key: z.string(),
    title: z.string(),
    authors_display: z.array(z.string()).default([]),
    year: z.number().int().nullable(),
    venue: z.string().nullable().default(null),
    doi: z.string().nullable().default(null),
    tldr: z.string().default(""),
    why_include: z.string().default(""),
    search_query: z.string().default(""),
    notes: z.string().optional(),
  })
  .passthrough();
type SeedEntry = z.infer<typeof SeedEntrySchema>;

const SeedPapersSchema = z
  .object({
    meta: z.record(z.string(), z.unknown()).optional(),
    P0: z.array(SeedEntrySchema).default([]),
    Done: z.array(SeedEntrySchema).default([]),
    P1: z.array(SeedEntrySchema).default([]),
    P2: z.array(SeedEntrySchema).default([]),
    Reading: z.array(SeedEntrySchema).default([]),
  })
  .passthrough();

// Map seed key (P0/Done/P1/P2/Reading) to ValidatedPaper.source_tier.
const TIER_MAP: Record<"P0" | "Done" | "P1" | "P2" | "Reading", SourceTier> = {
  P0: "P0",
  Done: "Done",
  P1: "P1",
  P2: "P2",
  Reading: "Reading",
};

// ─────────────────────────────────────────────────────────────────
// Anthropic tool definition for rubric scoring.
// ─────────────────────────────────────────────────────────────────

const THEORY_ANCHORS = [
  "status_characteristics_theory",
  "information_asymmetry_model",
  "biased_information_sampling",
  "contrastive_explanation",
  "facilitative_questioning",
  "nudge_choice_architecture",
  "proactive_intervention",
  "common_ground_calculation",
] as const;

const SCORE_TOOL: Anthropic.Tool = {
  name: "score_paper",
  description: "Emit the rubric score and metadata for one candidate paper.",
  input_schema: {
    type: "object",
    properties: {
      rigor: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "Experimental rigor (weight 2).",
      },
      operationalizability: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "Specific linguistic / dialogue / intervention cues a prompt engineer can lift (weight 2).",
      },
      recency: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "Top-tier venue OR published 2023+ (weight 1).",
      },
      actionable_insight: {
        type: "string",
        description: "<=50 words. A concrete prompt-design directive, not a paper summary.",
      },
      theory_anchors: {
        type: "array",
        items: { type: "string", enum: [...THEORY_ANCHORS] },
        description: "Zero or more anchors from the fixed vocabulary.",
      },
    },
    required: ["rigor", "operationalizability", "recency", "actionable_insight", "theory_anchors"],
  },
};

interface RubricResult {
  rigor: number;
  operationalizability: number;
  recency: number;
  utility_score: number;
  actionable_insight: string;
  theory_anchors: string[];
}

// ─────────────────────────────────────────────────────────────────
// Internal candidate type used during pool-building.
// ─────────────────────────────────────────────────────────────────

interface Candidate extends CandidatePaper {
  // Provenance — which seed entry produced this candidate (if any).
  seed_citation_key?: string;
  seed_authors_display?: string[];
}

// ─────────────────────────────────────────────────────────────────
// Public entry point.
// ─────────────────────────────────────────────────────────────────

export interface ScoutOptions {
  /** Cap pool size (post-dedup). Default 80. */
  maxPoolSize?: number;
  /** Per-seed search result count. Default 3. */
  perSeedResults?: number;
  /** Number of expansion queries. Default 5. */
  expansionQueryCount?: number;
  /** Per-expansion-query result count. Default 5. */
  perExpansionResults?: number;
}

export async function runScout(opts: ScoutOptions = {}): Promise<void> {
  const cfg = {
    maxPoolSize: opts.maxPoolSize ?? 80,
    perSeedResults: opts.perSeedResults ?? 3,
    expansionQueryCount: opts.expansionQueryCount ?? 5,
    perExpansionResults: opts.perExpansionResults ?? 5,
  };
  logger.info({ cfg }, "scout.start");

  const seeds = SeedPapersSchema.parse(
    yaml.load(readFileSync(resolve(ROOT, "config/seed_papers.yaml"), "utf8")),
  );

  // Force-include P0 + Done. These bypass the rubric.
  const forceIncluded: ValidatedPaper[] = [];
  for (const tier of ["P0", "Done"] as const) {
    for (const entry of seeds[tier]) {
      const resolved = await resolveSeedToWork(entry);
      forceIncluded.push(seedToValidated(entry, TIER_MAP[tier], resolved.work, resolved.s2));
    }
  }
  logger.info({ count: forceIncluded.length }, "scout.force_included_built");

  // Pool building: P1 + P2 + Reading + Discovered.
  const pool = new Map<string, Candidate>();      // key: dedup_key
  const seenDois = new Set<string>();
  const seenForceDois = new Set(forceIncluded.map((p) => p.doi).filter(Boolean) as string[]);

  for (const tier of ["P1", "P2", "Reading"] as const) {
    for (const entry of seeds[tier]) {
      const resolved = await resolveSeedToWork(entry);
      const dedup = dedupKey(entry.title, resolved.work);
      if (pool.has(dedup) || (resolved.work?.doi && seenForceDois.has(resolved.work.doi))) continue;
      const cand: Candidate = {
        title: resolved.work?.title ?? entry.title,
        authors: resolved.work?.authors ?? [],
        year: resolved.work?.publication_year ?? entry.year,
        venue: resolved.work?.venue ?? entry.venue,
        doi: resolved.work?.doi ?? null,
        openalex_id: resolved.work?.id ?? null,
        semantic_scholar_id: resolved.s2?.paperId ?? null,
        abstract: resolved.work?.abstract ?? null,
        tldr: resolved.s2?.tldr ?? null,
        influential_citation_count: resolved.s2?.influentialCitationCount ?? null,
        source_tier: TIER_MAP[tier],
        discovered_via: "seed_lookup",
        seed_citation_key: entry.citation_key,
        seed_authors_display: entry.authors_display,
      };
      if (resolved.work?.doi) seenDois.add(resolved.work.doi);
      pool.set(dedup, cand);

      // Additional per-seed search results (Discovered tier).
      if (entry.search_query && cfg.perSeedResults > 1) {
        const extras = await search({
          query: entry.search_query,
          maxResults: cfg.perSeedResults,
        });
        for (const w of extras) addDiscovered(pool, seenDois, seenForceDois, w, "seed_search");
      }
    }
  }

  // Expansion queries — keep small.
  for (const q of expansionQueries().slice(0, cfg.expansionQueryCount)) {
    const extras = await search({ query: q, maxResults: cfg.perExpansionResults });
    for (const w of extras) addDiscovered(pool, seenDois, seenForceDois, w, `expansion:${q}`);
  }

  // S2 enrichment for all DOI-bearing pool entries.
  for (const cand of pool.values()) {
    if (cand.doi && !cand.semantic_scholar_id) {
      const s2 = await enrichByDoi(cand.doi);
      if (s2) {
        cand.semantic_scholar_id = s2.paperId;
        cand.tldr = cand.tldr ?? s2.tldr;
        cand.influential_citation_count = cand.influential_citation_count ?? s2.influentialCitationCount;
        if (!cand.abstract) cand.abstract = s2.abstract;
      }
    }
  }

  // Cap pool size.
  const poolArr = [...pool.values()].slice(0, cfg.maxPoolSize);
  logger.info({ pool_size: poolArr.length, requested_cap: cfg.maxPoolSize }, "scout.pool_built");

  // Write candidate_pool.json.
  writeJson("knowledge_base/candidate_pool.json", {
    generated_at: new Date().toISOString(),
    pool_size: poolArr.length,
    force_included_count: forceIncluded.length,
    candidates: poolArr.map((c) => CandidatePaperSchema.parse(stripProvenance(c))),
  });

  // Stage 2: rubric scoring (Map). Concurrency 1 to keep logs readable and
  // stay within Haiku per-minute caps; the workload is small enough.
  const scored: { cand: Candidate; rubric: RubricResult }[] = [];
  for (const cand of poolArr) {
    try {
      const r = await scoreOne(cand);
      scored.push({ cand, rubric: r });
      logger.info(
        { title: cand.title?.slice(0, 70), score: r.utility_score },
        "scout.scored",
      );
    } catch (e) {
      logger.warn({ title: cand.title, err: String(e) }, "scout.score_failed");
    }
  }

  // Reduce: threshold + fallback. Per CLAUDE.md §7.1: "Fewer than 8 papers
  // pass rubric: lower threshold to 3.5 once with explicit log warning; if
  // still under 8, halt." The trigger is on rubric-passing count, not the
  // total KB size (which includes force-includes).
  const PASS = 4.0;
  const FALLBACK = 3.5;
  const MIN_RUBRIC_KEEP = 8;
  let kept = scored.filter((s) => s.rubric.utility_score >= PASS);
  let usedFallback = false;
  if (kept.length < MIN_RUBRIC_KEEP) {
    usedFallback = true;
    const primaryKeep = kept.length;
    kept = scored.filter((s) => s.rubric.utility_score >= FALLBACK);
    logger.warn(
      { primary_keep: primaryKeep, fallback_keep: kept.length, fallback_threshold: FALLBACK },
      "scout.fallback_engaged",
    );
  }
  // Halt only if the total KB (force-includes + rubric keepers) is too thin
  // to support prompt construction (CLAUDE.md §17.3 threshold is 10).
  const total = forceIncluded.length + kept.length;
  if (total < 10) {
    logger.error({ total }, "scout.insufficient_kb");
    throw new Error(
      `Knowledge base has only ${total} entries after fallback. CLAUDE.md §17.3 says halt and ask the user.`,
    );
  }

  // Build ValidatedPaper objects for kept candidates.
  const validatedNew: ValidatedPaper[] = kept.map(({ cand, rubric }) =>
    candidateToValidated(cand, rubric),
  );
  const validated = [...forceIncluded, ...validatedNew];

  // Dedupe by citation_key (force-included may collide with a discovered one).
  const seenKeys = new Set<string>();
  const dedupedValidated: ValidatedPaper[] = [];
  for (const v of validated) {
    if (seenKeys.has(v.citation_key)) {
      logger.warn({ key: v.citation_key }, "scout.duplicate_citation_key_dropped");
      continue;
    }
    seenKeys.add(v.citation_key);
    dedupedValidated.push(v);
  }

  // Emit citation_index.json + validated_kb.md.
  const index: Record<string, ValidatedPaper> = {};
  for (const v of dedupedValidated) index[v.citation_key] = v;
  writeJson("knowledge_base/citation_index.json", index);
  writeText("knowledge_base/validated_kb.md", renderKb(dedupedValidated, { usedFallback }));

  logger.info(
    {
      total: dedupedValidated.length,
      force_included: forceIncluded.length,
      rubric_kept: dedupedValidated.length - forceIncluded.length,
      used_fallback: usedFallback,
    },
    "scout.done",
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers.
// ─────────────────────────────────────────────────────────────────

async function resolveSeedToWork(
  entry: SeedEntry,
): Promise<{ work: OpenAlexWork | null; s2: S2Paper | null }> {
  let work: OpenAlexWork | null = null;
  if (entry.doi) {
    work = await fetchByDoi(entry.doi);
  }
  if (!work && entry.search_query) {
    const results = await search({ query: entry.search_query, maxResults: 5 });
    // Pick the first result with a year within ±1 of the seed year and a
    // title that shares at least three words with the seed title.
    work = pickBestMatch(entry, results);
  }
  let s2: S2Paper | null = null;
  if (work?.doi) s2 = await enrichByDoi(work.doi);
  return { work, s2 };
}

function pickBestMatch(entry: SeedEntry, results: OpenAlexWork[]): OpenAlexWork | null {
  if (results.length === 0) return null;
  const yearOk = (w: OpenAlexWork) =>
    !entry.year || (w.publication_year !== null && Math.abs(w.publication_year - entry.year) <= 1);
  const seedTokens = tokens(entry.title);
  let best: { w: OpenAlexWork; overlap: number } | null = null;
  for (const w of results) {
    if (!yearOk(w)) continue;
    const overlap = w.title ? countOverlap(seedTokens, tokens(w.title)) : 0;
    if (!best || overlap > best.overlap) best = { w, overlap };
  }
  if (best && best.overlap >= 3) return best.w;
  // Fall back to the first year-matching result rather than nothing.
  const yearMatch = results.find(yearOk);
  return yearMatch ?? results[0] ?? null;
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
}
function countOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function dedupKey(_seedTitle: string, w: OpenAlexWork | null): string {
  if (w?.doi) return `doi:${w.doi}`;
  if (w?.id) return `oa:${w.id}`;
  return `title:${_seedTitle.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function addDiscovered(
  pool: Map<string, Candidate>,
  seenDois: Set<string>,
  seenForceDois: Set<string>,
  w: OpenAlexWork,
  provenance: string,
): void {
  if (!w.doi || !w.title) return; // need both DOI and title to enrich and score
  if (seenForceDois.has(w.doi)) return;
  if (seenDois.has(w.doi)) return;
  seenDois.add(w.doi);
  pool.set(`doi:${w.doi}`, {
    title: w.title,
    authors: w.authors,
    year: w.publication_year,
    venue: w.venue,
    doi: w.doi,
    openalex_id: w.id,
    semantic_scholar_id: null,
    abstract: w.abstract,
    tldr: null,
    influential_citation_count: null,
    source_tier: "Discovered",
    discovered_via: provenance,
  });
}

function expansionQueries(): string[] {
  // Five queries spanning the design space. Kept small per CLAUDE.md §17.5
  // (cache hit-rate matters; broad queries balloon the pool).
  return [
    "hidden profile group decision making information pooling",
    "AI teammate communication strategy human-AI team",
    "AI leader peer status small group decision",
    "facilitative questioning group discussion information elicitation",
    "explainable AI explanation contrastive group decision",
  ];
}

// ─────────────────────────────────────────────────────────────────
// Rubric scoring (Anthropic Haiku, tool use).
// ─────────────────────────────────────────────────────────────────

const SCOUT_SYSTEM_PROMPT = readFileSync(
  resolve(ROOT, "src/prompts/agent0.system.md"),
  "utf8",
);

async function scoreOne(cand: Candidate): Promise<RubricResult> {
  const userText = candidateToUserTurn(cand);
  const resp = await callAgent({
    role: "scout",
    cacheablePrefix: SCOUT_SYSTEM_PROMPT,
    agentInstructions:
      "Score the candidate paper described in the user turn. Call the `score_paper` tool exactly once. No prose.",
    messages: [{ role: "user", content: userText }],
    tools: [SCORE_TOOL],
  });

  // Find the tool_use block.
  for (const block of resp.content) {
    if (block.type === "tool_use" && block.name === "score_paper") {
      const i = block.input as Record<string, unknown>;
      const rigor = clampInt(i.rigor);
      const op = clampInt(i.operationalizability);
      const rec = clampInt(i.recency);
      const utility_score = (rigor * 2 + op * 2 + rec) / 5;
      return {
        rigor,
        operationalizability: op,
        recency: rec,
        utility_score: Math.round(utility_score * 100) / 100,
        actionable_insight: String(i.actionable_insight ?? "").trim(),
        theory_anchors: Array.isArray(i.theory_anchors)
          ? (i.theory_anchors as unknown[]).filter((x): x is string => typeof x === "string")
          : [],
      };
    }
  }
  throw new Error("Scout did not return a score_paper tool call");
}

function clampInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, Math.round(n)));
}

function candidateToUserTurn(c: Candidate): string {
  const parts = [
    `Title: ${c.title ?? "(unknown)"}`,
    `Authors: ${c.authors.join(", ") || "(unknown)"}`,
    `Year: ${c.year ?? "(unknown)"}`,
    `Venue: ${c.venue ?? "(unknown)"}`,
    `Source tier: ${c.source_tier}`,
    `Influential citation count (S2): ${c.influential_citation_count ?? "n/a"}`,
    `TLDR (S2): ${c.tldr ?? "(none)"}`,
    `Abstract: ${(c.abstract ?? "(none)").slice(0, 2000)}`,
  ];
  return parts.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// ValidatedPaper construction.
// ─────────────────────────────────────────────────────────────────

function seedToValidated(
  entry: SeedEntry,
  tier: SourceTier,
  work: OpenAlexWork | null,
  s2: S2Paper | null,
): ValidatedPaper {
  // Force-included papers do not have a rubric score; we record 5 as a
  // bookkeeping value and lean on source_tier=P0|Done to indicate origin.
  // CLAUDE.md §7.1 specifies these "skip the rubric".
  const tldr = s2?.tldr ?? entry.tldr ?? null;
  const authorsDisplay = entry.authors_display.join(", ");
  const full_citation = `${authorsDisplay} (${entry.year ?? "n.d."}). ${entry.title}.${
    work?.venue || entry.venue ? ` ${work?.venue ?? entry.venue}.` : ""
  }`;
  return ValidatedPaperSchema.parse({
    citation_key: entry.citation_key,
    full_citation,
    doi: work?.doi ?? entry.doi ?? null,
    openalex_id: work?.id ?? null,
    semantic_scholar_id: s2?.paperId ?? null,
    tldr,
    utility_score: 5,
    actionable_insight: entry.why_include || entry.tldr || "(force-included; see seed_papers.yaml)",
    theory_anchors: [],
    source_tier: tier,
  });
}

function candidateToValidated(c: Candidate, r: RubricResult): ValidatedPaper {
  const key = generateCitationKey(c);
  const authorsStr = c.authors.length > 0 ? c.authors.join(", ") : "(unknown)";
  const full_citation = `${authorsStr} (${c.year ?? "n.d."}). ${c.title ?? "(untitled)"}.${
    c.venue ? ` ${c.venue}.` : ""
  }`;
  return ValidatedPaperSchema.parse({
    citation_key: key,
    full_citation,
    doi: c.doi,
    openalex_id: c.openalex_id,
    semantic_scholar_id: c.semantic_scholar_id,
    tldr: c.tldr,
    utility_score: r.utility_score,
    actionable_insight: r.actionable_insight,
    theory_anchors: r.theory_anchors,
    source_tier: c.source_tier,
  });
}

function generateCitationKey(c: Candidate): string {
  const year = c.year ?? new Date().getFullYear();
  const first = (c.authors[0] ?? "Unknown").split(/[\s,]+/).filter(Boolean).pop() ?? "Unknown";
  const ascii = first
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks
    .replace(/[^A-Za-z]/g, "");
  const name = ascii ? ascii[0]!.toUpperCase() + ascii.slice(1) : "Unknown";
  const suffix = c.authors.length > 1 ? "EtAl" : "";
  return `${name}${suffix}_${year}`;
}

// ─────────────────────────────────────────────────────────────────
// Markdown rendering.
// ─────────────────────────────────────────────────────────────────

function renderKb(
  papers: ValidatedPaper[],
  meta: { usedFallback: boolean },
): string {
  const header = [
    "# Validated Knowledge Base",
    "",
    `Generated by Agent 0 (Scout) on ${new Date().toISOString().slice(0, 10)}.`,
    `Total entries: ${papers.length}.`,
    meta.usedFallback ? "Fallback threshold (>= 3.5) was applied because the strict >= 4.0 keepers were insufficient." : "",
    "",
    "Each entry below was either force-included (source_tier=P0 or Done) or passed the 5-point rubric.",
    "The `citation_key` field is the authoritative identifier used by downstream prompt components.",
    "",
    "---",
    "",
  ].filter(Boolean).join("\n");

  const byTier: Record<SourceTier, ValidatedPaper[]> = {
    P0: [], Done: [], P1: [], P2: [], Reading: [], Discovered: [],
  };
  for (const p of papers) byTier[p.source_tier].push(p);

  const sections: string[] = [];
  for (const tier of ["P0", "Done", "P1", "P2", "Reading", "Discovered"] as const) {
    if (byTier[tier].length === 0) continue;
    sections.push(`## Tier: ${tier}\n`);
    for (const p of byTier[tier]) sections.push(renderEntry(p));
  }
  return header + sections.join("\n") + "\n";
}

function renderEntry(p: ValidatedPaper): string {
  const yaml = [
    `### ${p.citation_key}`,
    "",
    "```yaml",
    `citation_key: ${p.citation_key}`,
    `full_citation: ${escapeYamlScalar(p.full_citation)}`,
    `doi: ${p.doi ?? "null"}`,
    `openalex_id: ${p.openalex_id ?? "null"}`,
    `semantic_scholar_id: ${p.semantic_scholar_id ?? "null"}`,
    `tldr: ${escapeYamlScalar(p.tldr ?? "null")}`,
    `utility_score: ${p.utility_score}`,
    `actionable_insight: ${escapeYamlScalar(p.actionable_insight)}`,
    `theory_anchors: [${p.theory_anchors.join(", ")}]`,
    `source_tier: ${p.source_tier}`,
    "```",
    "",
  ];
  return yaml.join("\n");
}

function escapeYamlScalar(s: string): string {
  // Use a quoted scalar so special chars survive. Replace embedded double
  // quotes; keep newlines as spaces for compactness.
  const flat = s.replace(/\s+/g, " ").trim();
  return `"${flat.replace(/"/g, '\\"')}"`;
}

// ─────────────────────────────────────────────────────────────────
// Filesystem helpers.
// ─────────────────────────────────────────────────────────────────

function writeJson(rel: string, data: unknown): void {
  const path = resolve(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}
function writeText(rel: string, data: string): void {
  const path = resolve(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, "utf8");
}

function stripProvenance(c: Candidate): CandidatePaper {
  const { seed_citation_key: _a, seed_authors_display: _b, ...rest } = c;
  return rest;
}
