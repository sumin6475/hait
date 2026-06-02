import { z } from "zod";

// Per CLAUDE.md §6.3.
// Source tiers come from the user's literature list (CLAUDE.md §7.1):
//   P0 / Done           force-included (skip rubric)
//   P1 / P2 / Reading   seeded into candidate pool, subject to rubric
//   Discovered          surfaced via OpenAlex semantic search, subject to rubric

export const SourceTierEnum = z.enum([
  "P0",
  "P1",
  "P2",
  "Done",
  "Reading",
  "Discovered",
]);

export type SourceTier = z.infer<typeof SourceTierEnum>;

export const ValidatedPaperSchema = z
  .object({
    citation_key: z
      .string()
      .regex(
        /^[A-Z][a-zA-Z]+(EtAl)?_\d{4}$/,
        "e.g. Stasser_1985 or BergerEtAl_1972",
      ),
    full_citation: z.string(),
    doi: z.string().nullable(),
    openalex_id: z.string().nullable(),
    semantic_scholar_id: z.string().nullable(),
    tldr: z.string().nullable(),
    utility_score: z.number().min(0).max(5),
    actionable_insight: z.string(),
    theory_anchors: z.array(z.string()),
    source_tier: SourceTierEnum,
  })
  .strict();

export type ValidatedPaper = z.infer<typeof ValidatedPaperSchema>;

// Stage 1 candidate (pre-rubric). Looser than ValidatedPaper —
// we only know what OpenAlex + S2 told us before scoring.
export const CandidatePaperSchema = z
  .object({
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number().int().nullable(),
    venue: z.string().nullable(),
    doi: z.string().nullable(),
    openalex_id: z.string().nullable(),
    semantic_scholar_id: z.string().nullable(),
    abstract: z.string().nullable(),
    tldr: z.string().nullable(),
    influential_citation_count: z.number().int().nullable(),
    source_tier: SourceTierEnum,
    discovered_via: z.string().nullable(),
  })
  .strict();

export type CandidatePaper = z.infer<typeof CandidatePaperSchema>;
