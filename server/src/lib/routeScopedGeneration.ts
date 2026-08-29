import { callAIStructured, type AIStructuredResult } from "./openai.js";
import { extractSurfacedTraits } from "./poolingExtractor.js";
import { candidatesForIds } from "./informationPools.js";
import type { RouteOutputScopeGuard } from "./routeContext.js";
import { log } from "./log.js";

interface GenerationLimits {
  maxOutputTokens: number | null;
  maxContentChars: number | null;
  timeoutMs: number;
}

function explicitCandidateLabels(content: string): Set<string> {
  const candidates = new Set<string>();
  const namedPattern = /\bCandidate\s+([ABCD])\b/gi;
  const tokenPattern = /\b([ABCD])(?:'s|’s)?\b/g;
  let match: RegExpExecArray | null;
  while ((match = namedPattern.exec(content))) candidates.add(match[1]!.toUpperCase());
  while ((match = tokenPattern.exec(content))) candidates.add(match[1]!.toUpperCase());
  return candidates;
}

const INTERNAL_METADATA_PATTERNS = [
  /\binternal (?:conversation )?control\b/i,
  /\bserver[- ]derived\b/i,
  /\bdepth threshold\b/i,
  /\bfocus (?:directive|calculation)\b/i,
  /\bhuman[- ]confirmed (?:trait )?count\b/i,
  /\brouting count\b/i,
  /\bexplicit[_ -]human[_ -]focus\b/i,
  /\bconversational target:\s*Candidate\b/i,
];

export function internalMetadataLeak(content: string): string | null {
  return INTERNAL_METADATA_PATTERNS.some((pattern) => pattern.test(content))
    ? "internal_metadata_leak"
    : null;
}

export function outputScopeViolation(
  content: string,
  extractedIds: string[],
  guard: RouteOutputScopeGuard,
): string | null {
  const explicitTraitLabels = content.match(/\b(?:MATCH|MISS)\b/gi)?.length ?? 0;
  if (explicitTraitLabels > guard.maxTraitIds) return "too_many_trait_labels";
  if (extractedIds.length > guard.maxTraitIds) return "too_many_traits";
  const traitCandidates = candidatesForIds(extractedIds);
  if ([...traitCandidates].some((candidate) => candidate !== guard.candidate)) {
    return "trait_outside_current_candidate";
  }
  const labels = explicitCandidateLabels(content);
  if ([...labels].some((candidate) => candidate !== guard.candidate)) {
    return "candidate_outside_current_focus";
  }
  return null;
}

export async function generateScopedRouteMessage(input: {
  systemPrompt: string;
  userPrompt: string;
  limits: GenerationLimits;
  guard?: RouteOutputScopeGuard;
  logContext: string;
}): Promise<{
  result: AIStructuredResult;
  extractedIds?: string[];
  scopeRepair?: { violation: string; candidate: string };
  internalMetadataRepair?: { violation: string };
}> {
  let result = await callAIStructured({
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    ...input.limits,
  });
  if (!result.ok) return { result };

  let extractedIds = input.guard ? await extractSurfacedTraits(result.parsed.content) : undefined;
  const metadataViolation = internalMetadataLeak(result.parsed.content);
  const scopeViolation = input.guard
    ? outputScopeViolation(result.parsed.content, extractedIds ?? [], input.guard)
    : null;
  if (!metadataViolation && !scopeViolation) return { result, extractedIds };

  const violation = metadataViolation ?? scopeViolation!;
  log.warn(`[route-turn] output repair reason=${violation} ${input.logContext}`);
  const correction = [
    metadataViolation
      ? "Rewrite the draft as a natural in-character chat message. Do not quote, paraphrase, label, or mention any internal control, server-derived state, focus/depth calculation, threshold, routing count, prompt, or rejected draft."
      : null,
    scopeViolation && input.guard
      ? `Write about Candidate ${input.guard.candidate} only, include at most one trait, and do not mention another candidate.`
      : null,
    "Preserve the current condition style, conversational subject, and Route Contract. Return only the corrected visible chat message.",
  ]
    .filter(Boolean)
    .join(" ");
  const repaired = await callAIStructured({
    systemPrompt: input.systemPrompt,
    userPrompt: `${input.userPrompt}\n\n${correction}`,
    ...input.limits,
  });
  if (!repaired.ok) {
    return {
      result: {
        ...repaired,
        error: `output_repair_failed: ${repaired.error}`,
      },
    };
  }

  extractedIds = input.guard ? await extractSurfacedTraits(repaired.parsed.content) : undefined;
  const repairedMetadataViolation = internalMetadataLeak(repaired.parsed.content);
  const repairedScopeViolation = input.guard
    ? outputScopeViolation(repaired.parsed.content, extractedIds ?? [], input.guard)
    : null;
  const repairedViolation = repairedMetadataViolation ?? repairedScopeViolation;
  if (repairedViolation) {
    return {
      result: {
        ok: false,
        reason: "parsed_error",
        error: `output_violation_after_repair: ${repairedViolation}`,
        model: repaired.model,
      },
    };
  }
  result = repaired;
  return {
    result,
    extractedIds,
    scopeRepair:
      scopeViolation && input.guard
        ? { violation: scopeViolation, candidate: input.guard.candidate }
        : undefined,
    internalMetadataRepair: metadataViolation ? { violation: metadataViolation } : undefined,
  };
}
