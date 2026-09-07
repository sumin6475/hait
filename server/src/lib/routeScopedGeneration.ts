import { callAIStructured, type AIStructuredResult } from "./openai.js";
import { extractHumanTraitsFast } from "./poolingExtractor.js";
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
  softViolations?: string[];
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
  softViolations?: string[];
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
    softViolations: input.softViolations,
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
  /\bexplicit[_ -]human[_ -]focus\b/i,
  /\bconversational target:\s*Candidate\b/i,
];

const SOFT_METADATA_PATTERNS = [
  /\b(?:your|my|the) (?:prompt|instructions?|rules?|policy|system message)\b/i,
  /\b(?:prompt|instruction|policy|scope) (?:scope|limits?|restriction|prevents?|allows?)\b/i,
  /\b(?:cannot|can['’]?t|unable to) (?:share|reveal|follow|answer).{0,48}\b(?:prompt|instructions?|rules?|policy|scope)\b/i,
];

export function internalMetadataLeak(content: string): string | null {
  return INTERNAL_METADATA_PATTERNS.some((pattern) => pattern.test(content))
    ? "internal_metadata_leak"
    : null;
}

export function internalMetadataSoftViolations(content: string): string[] {
  return SOFT_METADATA_PATTERNS.some((pattern) => pattern.test(content))
    ? ["metadata_reference"]
    : [];
}

/**
 * [D2] What this turn disclosed, for the output guards.
 *
 * This was `await extractSurfacedTraits(content)` — an LLM round trip whose body
 * ends in `catch { return [] }`. An empty result is indistinguishable from "this
 * message revealed nothing", so **every scope guard passed whenever extraction
 * failed**, silently. T-C1-027 shipped three messages carrying six traits each
 * on turns whose guard was correctly set to one new trait and two restated: the
 * guard was right, the evidence handed to it was empty.
 *
 * The deterministic closed-pool matcher replaces it, exactly as A7 did for the
 * pre-broadcast ledger update: it is network-free, so it cannot time out, and it
 * has no failure mode that reads as absence. Alex's own text stays close to the
 * pool because the output contract requires it ("preserve the key wording of a
 * trait"), which is why the matcher fits Alex's output at least as well as the
 * model extractor did — A7 measured it finding two disclosed misses the model
 * extractor had dropped twice.
 *
 * It also takes one or two synchronous model calls off the generation path.
 */
function disclosedTraitIds(content: string): string[] {
  return [...new Set(extractHumanTraitsFast({ messageText: content }).acceptedIds)];
}

export function outputScopeViolation(
  content: string,
  extractedIds: string[],
  guard: RouteOutputScopeGuard,
  previouslySurfacedTraitIds: readonly string[] = [],
): string | null {
  const previouslySurfaced = new Set(previouslySurfacedTraitIds);
  const newlyIntroducedIds = extractedIds.filter((id) => !previouslySurfaced.has(id));
  // Hard scope checks are factual only. Already-visible human traits may be
  // referenced naturally; only facts newly introduced by this Alex turn are
  // constrained.
  if (
    guard.allowedTraitIds &&
    newlyIntroducedIds.some((id) => !guard.allowedTraitIds!.includes(id))
  ) {
    return "trait_outside_selected_contribution";
  }
  if (guard.requiredTraitId && !extractedIds.includes(guard.requiredTraitId)) {
    return "selected_trait_missing";
  }
  if (guard.maxTraitIds !== undefined && newlyIntroducedIds.length > guard.maxTraitIds) {
    return guard.reason === "mediation_no_new_traits"
      ? "new_trait_in_mediation"
      : "too_many_traits";
  }
  // [D4] Restating is not free. The check above counts only new traits, so a
  // wholesale recital of the board passes it — T-C1-025 seq 7 restated sixteen
  // traits and introduced none.
  if (
    guard.maxRestatedTraitIds !== undefined &&
    extractedIds.length - newlyIntroducedIds.length > guard.maxRestatedTraitIds
  ) {
    return "too_many_restated_traits";
  }
  const traitCandidates = candidatesForIds(newlyIntroducedIds);
  if (
    guard.candidate &&
    [...traitCandidates].some((candidate) => candidate !== guard.candidate)
  ) {
    return "trait_outside_current_candidate";
  }
  const factOnlyBuildOnGuard = [
    "route_single_point",
    "selected_note_contribution",
    "conversation_grounded_synthesis",
  ].includes(guard.reason);
  const labels = explicitCandidateLabels(content);
  if (
    guard.candidate &&
    !factOnlyBuildOnGuard &&
    [...labels].some((candidate) => candidate !== guard.candidate)
  ) {
    return "candidate_outside_current_focus";
  }
  return null;
}

/**
 * Non-factual output-shape signals remain observable, but never trigger a
 * rewrite. They are intentionally separate from outputScopeViolation so
 * wording cannot suppress a factually valid turn.
 */
export function outputScopeSoftViolations(
  content: string,
  extractedIds: string[],
  guard: RouteOutputScopeGuard,
  previouslySurfacedTraitIds: readonly string[] = [],
): string[] {
  const violations: string[] = [];
  const previouslySurfaced = new Set(previouslySurfacedTraitIds);
  const newlyIntroducedIds = extractedIds.filter((id) => !previouslySurfaced.has(id));
  const restatedIds = extractedIds.length - newlyIntroducedIds.length;
  const explicitTraitLabels =
    content.match(/\(\s*(?:MATCH|MISS)\s*\)|\b(?:MATCH|MISS)\s*[—–:]/gi)?.length ?? 0;
  const maxExplicitTraitLabels =
    guard.maxTraitIds !== undefined ? guard.maxTraitIds + restatedIds : undefined;
  if (maxExplicitTraitLabels !== undefined && explicitTraitLabels > maxExplicitTraitLabels) {
    violations.push("too_many_trait_labels");
  }
  const labels = explicitCandidateLabels(content);
  if (guard.candidate && [...labels].some((candidate) => candidate !== guard.candidate)) {
    violations.push("candidate_outside_current_focus");
  }
  return violations;
}

export const MAX_REPAIR_ATTEMPTS = 1;

export async function generateScopedRouteMessage(input: {
  systemPrompt: string;
  developerPrompt?: string;
  userPrompt: string;
  limits: GenerationLimits;
  guard?: RouteOutputScopeGuard;
  previouslySurfacedTraitIds?: string[];
  logContext: string;
}): Promise<{
  result: AIStructuredResult;
  extractedIds?: string[];
  scopeRepair?: { violation: string; candidate?: string };
  internalMetadataRepair?: { violation: string };
  repairAudit?: OutputRepairAudit;
}> {
  let result = await callAIStructured({
    systemPrompt: input.systemPrompt,
    developerPrompt: input.developerPrompt,
    userPrompt: input.userPrompt,
    ...input.limits,
  });
  if (!result.ok) return { result };

  let extractedIds = input.guard ? disclosedTraitIds(result.parsed.content) : undefined;
  const metadataViolation = internalMetadataLeak(result.parsed.content);
  const scopeViolation = input.guard
    ? outputScopeViolation(
        result.parsed.content,
        extractedIds ?? [],
        input.guard,
        input.previouslySurfacedTraitIds,
      )
    : null;
  let softViolations = [
    ...internalMetadataSoftViolations(result.parsed.content),
    ...(input.guard
      ? outputScopeSoftViolations(
          result.parsed.content,
          extractedIds ?? [],
          input.guard,
          input.previouslySurfacedTraitIds,
        )
      : []),
  ];
  if (!metadataViolation && !scopeViolation) {
    if (!softViolations.length) return { result, extractedIds };
    return {
      result,
      extractedIds,
      repairAudit: {
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
            outcome: "accepted",
            result,
            extractedTraitIds: extractedIds,
            softViolations,
          }),
        ],
      },
    };
  }

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
        softViolations,
      }),
    ],
  };
  const guardDetail = input.guard
    ? `guard=${input.guard.candidate ?? "none"} scope=${input.guard.reason} ` +
      `maxTraits=${input.guard.maxTraitIds ?? "none"} extracted=${extractedIds?.length ?? 0}`
    : "guard=none";

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
        ? input.guard.reason === "mediation_no_new_traits"
          ? "Rewrite without introducing any candidate trait that was not already visible in the conversation. You may briefly refer to already-visible points while stating only the discussion state and next direction."
          : !input.guard.candidate
            ? [
                // [D3] The route reveal budget has no candidate scope, so the
                // correction below (which is candidate-led) never reached it.
                input.guard.maxTraitIds !== undefined
                  ? `Introduce at most ${input.guard.maxTraitIds} new candidate trait${input.guard.maxTraitIds === 1 ? "" : "s"} in this message.`
                  : null,
                input.guard.maxRestatedTraitIds !== undefined
                  ? `Refer back to at most ${input.guard.maxRestatedTraitIds} already-surfaced trait${input.guard.maxRestatedTraitIds === 1 ? "" : "s"}; do not recite the board.`
                  : null,
                "Keep it to a short chat message that answers what was just said.",
              ]
                .filter(Boolean)
                .join(" ")
            : [
                `Write about Candidate ${input.guard.candidate} only and do not mention another candidate.`,
                input.guard.requiredTraitId
                  ? `The only candidate trait you may mention is: "${TRAIT_BY_ID.get(input.guard.requiredTraitId)?.text ?? input.guard.requiredTraitId}". Include that exact point and no other candidate trait, even if another trait was already discussed.`
                  : null,
                input.guard.maxTraitIds !== undefined && !input.guard.requiredTraitId
                  ? `Introduce at most ${input.guard.maxTraitIds} new trait${input.guard.maxTraitIds === 1 ? "" : "s"}; you may still acknowledge already-surfaced points.`
                  : null,
                input.guard.maxRestatedTraitIds !== undefined
                  ? `Refer back to at most ${input.guard.maxRestatedTraitIds} already-surfaced trait${input.guard.maxRestatedTraitIds === 1 ? "" : "s"}; do not recite the board.`
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
      developerPrompt: [input.developerPrompt, correction].filter(Boolean).join("\n\n"),
      userPrompt: input.userPrompt,
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

    extractedIds = input.guard ? disclosedTraitIds(repaired.parsed.content) : undefined;
    const repairedMetadataViolation = internalMetadataLeak(repaired.parsed.content);
    const repairedScopeViolation = input.guard
      ? outputScopeViolation(
          repaired.parsed.content,
          extractedIds ?? [],
          input.guard,
          input.previouslySurfacedTraitIds,
        )
      : null;
    softViolations = [
      ...internalMetadataSoftViolations(repaired.parsed.content),
      ...(input.guard
        ? outputScopeSoftViolations(
            repaired.parsed.content,
            extractedIds ?? [],
            input.guard,
            input.previouslySurfacedTraitIds,
          )
        : []),
    ];
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
        softViolations,
      }),
    );
    if (!repairedViolations.length) {
      result = repaired;
      return {
        result,
        extractedIds,
        scopeRepair:
          scopeViolation && input.guard
            ? {
                violation: scopeViolation,
                ...(input.guard.candidate ? { candidate: input.guard.candidate } : {}),
              }
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
