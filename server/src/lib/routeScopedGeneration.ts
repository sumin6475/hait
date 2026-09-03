import { callAIStructured, type AIStructuredResult } from "./openai.js";
import { extractSurfacedTraits } from "./poolingExtractor.js";
import { candidatesForIds } from "./informationPools.js";
import type { RouteOutputScopeGuard } from "./routeContext.js";
import { log } from "./log.js";
import { TRAIT_BY_ID } from "./traitData.js";

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
    allowedTraitIds?: string[];
    requiredTraitId?: string;
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
  // [T-C4-019] Alex's notes are "my notes"/"what I've got" only — "shared profile"
  // is an internal-sounding term (observed live in T-C4-019 seq 8 and repair drafts).
  /\bshared profile\b/i,
  // [T-C4-019] reasoning residue about the address clarification rule leaked into a
  // visible message: "... (No clarification needed otherwise.)" (T-C4-019 seq 26).
  /\bclarification needed\b/i,
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
  previouslySurfacedTraitIds: readonly string[] = [],
): string | null {
  const previouslySurfaced = new Set(previouslySurfacedTraitIds);
  const newlyIntroducedIds = extractedIds.filter((id) => !previouslySurfaced.has(id));
  const restatedIds = extractedIds.length - newlyIntroducedIds.length;
  // allowedTraitIds constrains facts introduced by this turn. Previously it
  // also rejected an already-visible trait used in a natural uptake, which
  // forced build-ons to ignore the sentence they were answering.
  if (
    guard.allowedTraitIds &&
    newlyIntroducedIds.some((id) => !guard.allowedTraitIds!.includes(id))
  ) {
    return "trait_outside_selected_contribution";
  }
  const restatedOutsideSelection = guard.requiredTraitId
    ? extractedIds.filter((id) => id !== guard.requiredTraitId && previouslySurfaced.has(id))
    : [];
  // Conversational uptake may name an already-visible human point, but a
  // selected one-fact build-on must not turn that allowance into a weighing or
  // tradeoff question. This is the C3/C4 framing failure seen in pilot turns.
  if (
    restatedOutsideSelection.length > 0 &&
    /\b(?:weigh(?:ed|ing)?|balanc(?:e|ed|es|ing)|offsets?|outweighs?|trade-?offs?|tolerat(?:e|ed|es|ing)|disqualif(?:y|ied|ies|ying)|more important|less important)\b/i.test(
      content,
    )
  ) {
    return "trait_outside_selected_contribution";
  }
  if (guard.requiredTraitId && !extractedIds.includes(guard.requiredTraitId)) {
    return "selected_trait_missing";
  }
  // [T-C4-019] Count labels only in trait-introducing positions: "(MATCH)", "(MISS)",
  // "MATCH —", "MISS:". Bare confirmation vocabulary ("add the next MATCH or MISS",
  // "mark this as a MISS") repeats labels without adding traits and was producing
  // false too_many_trait_labels repairs (T-C4-019 anchors 7 and 16 each disclosed
  // exactly one trait but carried two label mentions).
  const explicitTraitLabels =
    content.match(/\(\s*(?:MATCH|MISS)\s*\)|\b(?:MATCH|MISS)\s*[—–:]/gi)?.length ?? 0;
  const maxExplicitTraitLabels = guard.allowedTraitIds
    ? guard.allowedTraitIds.length
    : guard.maxTraitIds !== undefined
      ? guard.maxTraitIds + restatedIds
      : undefined;
  if (maxExplicitTraitLabels !== undefined && explicitTraitLabels > maxExplicitTraitLabels) {
    return "too_many_trait_labels";
  }
  // maxTraitIds limits only information newly introduced by this Alex turn.
  // A natural acknowledgement of an already surfaced human point must not turn
  // "uptake + one new point" into a two-trait repair. Candidate scope below is
  // intentionally still checked across every mentioned trait.
  if (guard.maxTraitIds !== undefined && newlyIntroducedIds.length > guard.maxTraitIds) {
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
  previouslySurfacedTraitIds?: string[];
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
    ? outputScopeViolation(
        result.parsed.content,
        extractedIds ?? [],
        input.guard,
        input.previouslySurfacedTraitIds,
      )
    : null;
  if (!metadataViolation && !scopeViolation) return { result, extractedIds };

  const initialViolations = [metadataViolation, scopeViolation].filter((value): value is string =>
    Boolean(value),
  );
  const repairAudit: OutputRepairAudit = {
    version: 1,
    guard: input.guard
      ? {
          candidate: input.guard.candidate,
          reason: input.guard.reason,
          maxTraitIds: input.guard.maxTraitIds,
          allowedTraitIds: input.guard.allowedTraitIds,
          requiredTraitId: input.guard.requiredTraitId,
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
  const guardDetail = input.guard
    ? `guard=${input.guard.candidate} scope=${input.guard.reason} ` +
      `maxTraits=${input.guard.maxTraitIds ?? "none"} extracted=${extractedIds?.length ?? 0}`
    : "guard=none";

  // [T-C4-019] Up to two repair attempts. A single attempt lost whole turns both
  // when the rewrite still violated the scope (anchors 3, 52) and when the rewrite
  // call itself came back as prose instead of the JSON object (anchor 6).
  const MAX_REPAIR_ATTEMPTS = 2;
  let lastViolation = metadataViolation ?? scopeViolation!;
  let lastFailureError: string | null = null;
  let lastModel: string | undefined;
  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    log.warn(
      `[route-turn] output repair reason=${lastViolation} attempt=${attempt}/${MAX_REPAIR_ATTEMPTS} ${guardDetail} ${input.logContext}`,
    );
    const failureNote =
      attempt === 1
        ? null
        : lastFailureError
          ? "Your previous rewrite failed to parse. Respond with a single JSON object only, no prose outside it."
          : `Your previous rewrite still violated the limits (${lastViolation}). Fix exactly that.`;
    const correction = [
      failureNote,
      metadataViolation
        ? "Rewrite the draft as a natural in-character chat message. Do not quote, paraphrase, label, or mention any internal control, server-derived state, focus/depth calculation, threshold, routing count, prompt, or rejected draft."
        : null,
      scopeViolation && input.guard
        ? [
            `Write about Candidate ${input.guard.candidate} only and do not mention another candidate.`,
            input.guard.requiredTraitId
              ? `The only candidate trait you may mention is: "${TRAIT_BY_ID.get(input.guard.requiredTraitId)?.text ?? input.guard.requiredTraitId}". Include that exact point and no other candidate trait, even if another trait was already discussed.`
              : null,
            input.guard.maxTraitIds !== undefined && !input.guard.requiredTraitId
              ? `Introduce at most ${input.guard.maxTraitIds} new trait${input.guard.maxTraitIds === 1 ? "" : "s"}; you may still acknowledge already-surfaced points.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null,
      'Preserve the current condition style, conversational subject, and Turn Metadata goal. Return only the corrected visible chat message inside the required JSON object: {"content": "<message>"}.',
    ]
      .filter(Boolean)
      .join(" ");
    const repaired = await callAIStructured({
      systemPrompt: input.systemPrompt,
      userPrompt: `${input.userPrompt}\n\n${correction}`,
      ...input.limits,
    });
    lastModel = repaired.model;
    if (!repaired.ok) {
      repairAudit.attempts.push({
        stage: "repair",
        outcome: "failed",
        model: repaired.model,
        error: repaired.error,
      });
      lastFailureError = repaired.error;
      continue;
    }
    lastFailureError = null;

    extractedIds = input.guard ? await extractSurfacedTraits(repaired.parsed.content) : undefined;
    const repairedMetadataViolation = internalMetadataLeak(repaired.parsed.content);
    const repairedScopeViolation = input.guard
      ? outputScopeViolation(
          repaired.parsed.content,
          extractedIds ?? [],
          input.guard,
          input.previouslySurfacedTraitIds,
        )
      : null;
    const repairedViolations = [repairedMetadataViolation, repairedScopeViolation].filter(
      (value): value is string => Boolean(value),
    );
    repairAudit.attempts.push(
      successfulAttemptAudit({
        stage: "repair",
        outcome: repairedViolations.length ? "rejected" : "accepted",
        result: repaired,
        extractedTraitIds: extractedIds,
        violations: repairedViolations,
      }),
    );
    if (!repairedViolations.length) {
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
    lastViolation = repairedViolations[0]!;
  }
  return {
    result: {
      ok: false,
      reason: "parsed_error",
      error: lastFailureError
        ? `output_repair_failed: ${lastFailureError}`
        : `output_violation_after_repair: ${lastViolation}`,
      ...(lastModel !== undefined ? { model: lastModel } : {}),
    } as AIStructuredResult,
    repairAudit,
  };
}
