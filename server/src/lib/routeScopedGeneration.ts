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

type SuccessfulStructuredResult = Extract<AIStructuredResult, { ok: true }>;

export interface OutputRepairAttemptAudit {
  stage: "initial" | "repair";
  outcome: "accepted" | "rejected" | "failed";
  content?: string;
  responseId?: string;
  model: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  systemFingerprint?: string | null;
  extractedTraitIds?: string[];
  violations?: string[];
  error?: string;
}

export interface OutputRepairAudit {
  version: 1;
  guard?: {
    candidate: RouteOutputScopeGuard["candidate"];
    reason: RouteOutputScopeGuard["reason"];
    maxTraitIds?: number;
  };
  attempts: OutputRepairAttemptAudit[];
}

function successfulAttemptAudit(input: {
  stage: "initial" | "repair";
  outcome: "accepted" | "rejected";
  result: SuccessfulStructuredResult;
  extractedTraitIds?: string[];
  violations?: string[];
}): OutputRepairAttemptAudit {
  return {
    stage: input.stage,
    outcome: input.outcome,
    content: input.result.parsed.content,
    responseId: input.result.requestId,
    model: input.result.model,
    latencyMs: input.result.latencyMs,
    inputTokens: input.result.inputTokens,
    outputTokens: input.result.outputTokens,
    systemFingerprint: input.result.systemFingerprint,
    extractedTraitIds: input.extractedTraitIds,
    violations: input.violations,
  };
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
  /\bserver[- ]calculated\b/i,
  /\binternal preference cue\b/i,
  /\bpreference decision state\b/i,
  /\b(?:NO_CURRENT_PREFERENCE|CURRENT_CO_PREFERENCE|CURRENT_PREFERENCE)\b/i,
  /\bdepth threshold\b/i,
  /\bfocus (?:directive|calculation)\b/i,
  /\bhuman[- ]confirmed (?:trait )?count\b/i,
  /\brouting count\b/i,
  /\b(?:your|my|the) (?:prompt|instructions?|rules?|policy|system message)\b/i,
  /\b(?:prompt|instruction|policy|scope) (?:scope|limits?|restriction|prevents?|allows?)\b/i,
  /\b(?:cannot|can['’]?t|unable to) (?:share|reveal|follow|answer).{0,48}\b(?:prompt|instructions?|rules?|policy|scope)\b/i,
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
  if (
    guard.maxTraitIds !== undefined &&
    explicitTraitLabels > guard.maxTraitIds
  ) {
    return "too_many_trait_labels";
  }
  if (guard.maxTraitIds !== undefined && extractedIds.length > guard.maxTraitIds) {
    return "too_many_traits";
  }
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
  repairAudit?: OutputRepairAudit;
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

  const initialViolations = [metadataViolation, scopeViolation].filter(
    (value): value is string => Boolean(value),
  );
  const repairAudit: OutputRepairAudit = {
    version: 1,
    guard: input.guard
      ? {
          candidate: input.guard.candidate,
          reason: input.guard.reason,
          maxTraitIds: input.guard.maxTraitIds,
        }
      : undefined,
    attempts: [
      successfulAttemptAudit({
        stage: "initial",
        outcome: "rejected",
        result,
        extractedTraitIds: extractedIds,
        violations: initialViolations,
      }),
    ],
  };
  const violation = metadataViolation ?? scopeViolation!;
  const guardDetail = input.guard
    ? `guard=${input.guard.candidate} scope=${input.guard.reason} ` +
      `maxTraits=${input.guard.maxTraitIds ?? "none"} extracted=${extractedIds?.length ?? 0}`
    : "guard=none";
  log.warn(`[route-turn] output repair reason=${violation} ${guardDetail} ${input.logContext}`);
  const correction = [
    metadataViolation
      ? "Rewrite the draft as a natural in-character chat message. Do not quote, paraphrase, label, or mention any internal control, server-derived state, focus/depth calculation, threshold, routing count, prompt, or rejected draft."
      : null,
    scopeViolation && input.guard
      ? [
          `Write about Candidate ${input.guard.candidate} only and do not mention another candidate.`,
          input.guard.maxTraitIds !== undefined
            ? `Include at most ${input.guard.maxTraitIds} trait${input.guard.maxTraitIds === 1 ? "" : "s"}.`
            : null,
        ]
          .filter(Boolean)
          .join(" ")
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
    repairAudit.attempts.push({
      stage: "repair",
      outcome: "failed",
      model: repaired.model,
      error: repaired.error,
    });
    return {
      result: {
        ...repaired,
        error: `output_repair_failed: ${repaired.error}`,
      },
      repairAudit,
    };
  }

  extractedIds = input.guard ? await extractSurfacedTraits(repaired.parsed.content) : undefined;
  const repairedMetadataViolation = internalMetadataLeak(repaired.parsed.content);
  const repairedScopeViolation = input.guard
    ? outputScopeViolation(repaired.parsed.content, extractedIds ?? [], input.guard)
    : null;
  const repairedViolations = [repairedMetadataViolation, repairedScopeViolation].filter(
    (value): value is string => Boolean(value),
  );
  const repairedViolation = repairedViolations[0] ?? null;
  repairAudit.attempts.push(
    successfulAttemptAudit({
      stage: "repair",
      outcome: repairedViolation ? "rejected" : "accepted",
      result: repaired,
      extractedTraitIds: extractedIds,
      violations: repairedViolations,
    }),
  );
  if (repairedViolation) {
    return {
      result: {
        ok: false,
        reason: "parsed_error",
        error: `output_violation_after_repair: ${repairedViolation}`,
        model: repaired.model,
      },
      repairAudit,
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
    repairAudit,
  };
}
