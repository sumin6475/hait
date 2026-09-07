import { z } from "zod";
import type {
  ConversationLedgerState,
  ConversationObserverDelta,
  OpportunityStatus,
  ResponseOpportunity,
} from "../lib/conversationLedger.js";
import type { ConversationLedgerJudgeDecision } from "../lib/interventionJudge.js";

export const CONVERSATION_GOLD_SCHEMA_VERSION = "conversation-semantic-gold-v1";
export const CONVERSATION_GOLD_REVIEW_SELECTOR_VERSION =
  "condition-stratified-hash-rank-v1";

const ActorSchema = z.enum(["alex", "humanX", "humanY", "humanZ"]);
const OpportunityKindSchema = z.enum([
  "direct_question",
  "invitation",
  "group_request",
  "uptake",
]);
const OpportunityStatusSchema = z.enum([
  "open",
  "deferred",
  "consumed_by_alex",
  "resolved_by_human",
  "declined",
  "withdrawn",
  "superseded",
  "expired",
]);

const OpportunityIdentitySchema = z.object({
  opportunitySourceSeq: z.number().int().positive(),
  kind: OpportunityKindSchema,
  targets: z.array(ActorSchema).min(1).max(4),
});

const OpportunityChangeSchema = z.object({
  operation: z.enum(["create", "revise", "close"]),
  opportunity: OpportunityIdentitySchema,
  threadRelation: z.enum([
    "new_thread",
    "existing_thread",
    "returned_thread",
    "switched_thread",
    "no_thread",
    "unclear",
  ]),
  evidenceSeqs: z.array(z.number().int().positive()).min(1).max(32),
});

const LifecycleTransitionSchema = z.object({
  opportunity: OpportunityIdentitySchema,
  fromStatus: OpportunityStatusSchema,
  toStatus: OpportunityStatusSchema,
  reasonCategory: z.enum([
    "human_floor_held",
    "successful_alex_broadcast",
    "resolved_by_human",
    "declined_no_useful_move",
    "withdrawn_by_requester",
    "superseded_by_new_request",
    "explicit_expiry_policy",
    "observer_correction",
    "other",
  ]),
  evidenceSeqs: z.array(z.number().int().positive()).min(1).max(32),
});

const FloorSchema = z.object({
  holder: z.enum(["alex", "humanX", "humanY", "humanZ", "open", "unclear"]),
  expectedNext: z.array(ActorSchema).max(4),
  transition: z.enum(["available", "held", "unclear"]),
  evidenceSeqs: z.array(z.number().int().positive()).max(32),
});

const JudgeSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("select_opportunity"),
    act: z.enum(["answer", "participate", "follow"]),
    opportunity: OpportunityIdentitySchema,
    evidenceSeqs: z.array(z.number().int().positive()).min(1).max(12),
  }),
  z.object({
    decision: z.literal("voluntary_act"),
    act: z.enum(["contribute", "acknowledge", "mediate"]),
    evidence: z.enum([
      "relevant_unsurfaced_information",
      "factual_correction",
      "conversation_grounded_synthesis",
      "social_uptake",
    ]),
    selectedTraitId: z.string().min(1).nullable(),
    evidenceSeqs: z.array(z.number().int().positive()).min(1).max(12),
  }),
  z.object({
    decision: z.literal("silent"),
    reason: z.enum(["human_floor_held", "cooldown", "no_useful_move"]),
    evidenceSeqs: z.array(z.number().int().positive()).min(1).max(12),
  }),
  z.object({
    decision: z.literal("reobserve"),
    reason: z.literal("observer_conflict"),
    evidenceSeqs: z.array(z.number().int().positive()).min(1).max(12),
  }),
]);

export const GoldSemanticOutcomeSchema = z.object({
  evidenceSeqs: z.array(z.number().int().positive()).min(1).max(32),
  opportunityChanges: z.array(OpportunityChangeSchema).max(12),
  lifecycleTransitions: z.array(LifecycleTransitionSchema).max(12),
  floor: FloorSchema,
  judge: JudgeSchema,
});

export type GoldSemanticOutcome = z.infer<typeof GoldSemanticOutcomeSchema>;

export const GoldExpectationSchema = z
  .object({
    mode: z.enum(["single", "acceptable_set", "abstain"]),
    outcomes: z.array(GoldSemanticOutcomeSchema).max(8),
    abstainReason: z.string().min(1).max(500).nullable(),
    criticalCategories: z.array(z.string().min(1).max(120)).max(16),
    mustFixIds: z.array(z.string().min(1).max(120)).max(16),
    goldImportant: z.boolean(),
    notes: z.string().max(1_000).nullable(),
  })
  .superRefine((value, context) => {
    if (value.mode === "single" && value.outcomes.length !== 1) {
      context.addIssue({ code: "custom", message: "single requires exactly one outcome" });
    }
    if (value.mode === "acceptable_set" && value.outcomes.length < 2) {
      context.addIssue({
        code: "custom",
        message: "acceptable_set requires at least two outcomes",
      });
    }
    if (value.mode === "abstain" && (value.outcomes.length !== 0 || !value.abstainReason)) {
      context.addIssue({
        code: "custom",
        message: "abstain requires no outcomes and a reason",
      });
    }
    if (value.mode !== "abstain" && value.abstainReason !== null) {
      context.addIssue({
        code: "custom",
        message: "non-abstain expectations must use a null abstainReason",
      });
    }
  });

const InitialReviewPassSchema = z.object({
  labelerId: z.string().min(1).max(120),
  completedAt: z.string().datetime(),
  blindedToFutureTurns: z.literal(true),
  blindedToSystemOutcomes: z.literal(true),
  expectation: GoldExpectationSchema,
});

const SecondReviewPassSchema = z
  .object({
    reviewerId: z.string().min(1).max(120),
    completedAt: z.string().datetime(),
    blindedToFutureTurns: z.literal(true),
    blindedToSystemOutcomes: z.literal(true),
    reviewMode: z.enum(["independent", "time_separated_same_person"]),
    limitationDisclosure: z.string().min(1).max(500).nullable(),
    expectation: GoldExpectationSchema,
  })
  .superRefine((value, context) => {
    if (value.reviewMode === "time_separated_same_person" && !value.limitationDisclosure) {
      context.addIssue({
        code: "custom",
        message: "same-person review requires a limitation disclosure",
      });
    }
    if (value.reviewMode === "independent" && value.limitationDisclosure !== null) {
      context.addIssue({
        code: "custom",
        message: "independent review must use a null limitation disclosure",
      });
    }
  });

const FinalReviewPassSchema = z.object({
  adjudicatorId: z.string().min(1).max(120),
  completedAt: z.string().datetime(),
  expectation: GoldExpectationSchema,
});

const GoldTurnSchema = z.object({
  replaySeq: z.number().int().positive(),
  originalSeq: z.number().int().positive(),
  reviewSamplingKey: z.string().regex(/^[a-f0-9]{64}$/),
  initial: InitialReviewPassSchema.nullable(),
  reviewer: SecondReviewPassSchema.nullable(),
  final: FinalReviewPassSchema.nullable(),
});

export const ConversationGoldFileSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_GOLD_SCHEMA_VERSION),
  reviewSelectorVersion: z.literal(CONVERSATION_GOLD_REVIEW_SELECTOR_VERSION),
  status: z.enum(["draft", "final"]),
  sessionCode: z.string().min(1),
  lane: z.enum(["development", "holdout"]),
  conditionCode: z.enum(["C1", "C2", "C3", "C4"]),
  inputPath: z.string().min(1),
  inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sequenceMeaning: z.literal("replaySeq"),
  turns: z.array(GoldTurnSchema),
});

export type ConversationGoldFile = z.infer<typeof ConversationGoldFileSchema>;
export type GoldExpectation = z.infer<typeof GoldExpectationSchema>;

export function finalGoldByReplaySeq(
  gold: ConversationGoldFile,
): Map<number, GoldExpectation> {
  return new Map(
    gold.turns.flatMap((turn) =>
      turn.final ? [[turn.replaySeq, turn.final.expectation] as const] : [],
    ),
  );
}

function sortedUnique(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function opportunityIdentity(opportunity: ResponseOpportunity) {
  return {
    opportunitySourceSeq: opportunity.opportunitySourceSeq,
    kind: opportunity.kind,
    targets: [...opportunity.targets].sort(),
  };
}

function threadRelation(
  threadId: string,
  stateBefore: ConversationLedgerState | null,
  stateAfter: ConversationLedgerState,
): GoldSemanticOutcome["opportunityChanges"][number]["threadRelation"] {
  if (!threadId) return "no_thread";
  const existed = stateBefore?.threads.some((thread) => thread.id === threadId) ?? false;
  if (!existed) return "new_thread";
  if (stateBefore?.foregroundThreadId === threadId) return "existing_thread";
  if (stateAfter.foregroundThreadId === threadId) return "returned_thread";
  return "existing_thread";
}

function lifecycleReasonCategory(
  status: OpportunityStatus,
  reason: string,
): GoldSemanticOutcome["lifecycleTransitions"][number]["reasonCategory"] {
  const normalized = reason.toLowerCase();
  if (status === "deferred" || /floor/.test(normalized)) return "human_floor_held";
  if (status === "consumed_by_alex") return "successful_alex_broadcast";
  if (status === "resolved_by_human") return "resolved_by_human";
  if (status === "declined") return "declined_no_useful_move";
  if (status === "withdrawn") return "withdrawn_by_requester";
  if (status === "superseded") return "superseded_by_new_request";
  if (status === "expired") return "explicit_expiry_policy";
  if (/correct|invalid|observer/.test(normalized)) return "observer_correction";
  return "other";
}

export function semanticOutcomeForControllerTurn(input: {
  stateBefore: ConversationLedgerState | null;
  stateAfter: ConversationLedgerState;
  delta: ConversationObserverDelta;
  judge: ConversationLedgerJudgeDecision;
}): GoldSemanticOutcome {
  const beforeById = new Map(
    (input.stateBefore?.opportunities ?? []).map((opportunity) => [opportunity.id, opportunity]),
  );
  const opportunityChanges: GoldSemanticOutcome["opportunityChanges"] = [];
  const lifecycleTransitions: GoldSemanticOutcome["lifecycleTransitions"] = [];
  for (const opportunity of input.stateAfter.opportunities) {
    const before = beforeById.get(opportunity.id);
    const relation = threadRelation(
      opportunity.threadId,
      input.stateBefore,
      input.stateAfter,
    );
    if (!before) {
      opportunityChanges.push({
        operation: "create",
        opportunity: opportunityIdentity(opportunity),
        threadRelation: relation,
        evidenceSeqs: sortedUnique(opportunity.evidenceSeqs),
      });
      continue;
    }
    if (before.status !== opportunity.status) {
      opportunityChanges.push({
        operation: "close",
        opportunity: opportunityIdentity(opportunity),
        threadRelation: relation,
        evidenceSeqs: sortedUnique(opportunity.resolutionEvidenceSeqs ?? opportunity.evidenceSeqs),
      });
      const proposal = input.delta.opportunityTransitions.find(
        (candidate) => candidate.opportunityId === opportunity.id,
      );
      lifecycleTransitions.push({
        opportunity: opportunityIdentity(opportunity),
        fromStatus: before.status,
        toStatus: opportunity.status,
        reasonCategory: lifecycleReasonCategory(opportunity.status, proposal?.reason ?? ""),
        evidenceSeqs: sortedUnique(
          proposal?.evidenceSeqs ?? opportunity.resolutionEvidenceSeqs ?? opportunity.evidenceSeqs,
        ),
      });
    } else if (before.revision !== opportunity.revision) {
      opportunityChanges.push({
        operation: "revise",
        opportunity: opportunityIdentity(opportunity),
        threadRelation: relation,
        evidenceSeqs: sortedUnique(opportunity.evidenceSeqs),
      });
    }
  }

  let judge: GoldSemanticOutcome["judge"];
  if (input.judge.decision === "speak" && input.judge.selectedOpportunityId) {
    const selected = input.stateAfter.opportunities.find(
      (opportunity) => opportunity.id === input.judge.selectedOpportunityId,
    );
    if (!selected || !["answer", "participate", "follow"].includes(input.judge.act ?? "")) {
      throw new Error("Validated Judge selection is absent from the ledger state");
    }
    judge = {
      decision: "select_opportunity",
      act: input.judge.act as "answer" | "participate" | "follow",
      opportunity: opportunityIdentity(selected),
      evidenceSeqs: sortedUnique(input.judge.evidenceSeqs),
    };
  } else if (input.judge.decision === "speak") {
    judge = {
      decision: "voluntary_act",
      act: input.judge.act as "contribute" | "acknowledge" | "mediate",
      evidence: input.judge.evidence as
        | "relevant_unsurfaced_information"
        | "factual_correction"
        | "conversation_grounded_synthesis"
        | "social_uptake",
      selectedTraitId: input.judge.selectedTraitId,
      evidenceSeqs: sortedUnique(input.judge.evidenceSeqs),
    };
  } else if (input.judge.decision === "reobserve") {
    judge = {
      decision: "reobserve",
      reason: "observer_conflict",
      evidenceSeqs: sortedUnique(input.judge.evidenceSeqs),
    };
  } else {
    judge = {
      decision: "silent",
      reason:
        input.judge.evidence === "human_floor_held"
          ? "human_floor_held"
          : input.judge.evidence === "cooldown"
            ? "cooldown"
            : "no_useful_move",
      evidenceSeqs: sortedUnique(input.judge.evidenceSeqs),
    };
  }
  const floor = {
    holder: input.stateAfter.floor.holder,
    expectedNext: [...input.stateAfter.floor.expectedNext].sort(),
    transition: input.stateAfter.floor.transition,
    evidenceSeqs: sortedUnique(input.stateAfter.floor.evidenceSeqs),
  };
  return GoldSemanticOutcomeSchema.parse({
    evidenceSeqs: sortedUnique([
      ...floor.evidenceSeqs,
      ...judge.evidenceSeqs,
      ...opportunityChanges.flatMap((change) => change.evidenceSeqs),
      ...lifecycleTransitions.flatMap((transition) => transition.evidenceSeqs),
    ]),
    opportunityChanges,
    lifecycleTransitions,
    floor,
    judge,
  });
}

function canonicalOutcome(outcome: GoldSemanticOutcome): string {
  const normalizeOpportunity = (value: GoldSemanticOutcome["opportunityChanges"][number]) => ({
    ...value,
    opportunity: { ...value.opportunity, targets: [...value.opportunity.targets].sort() },
    evidenceSeqs: sortedUnique(value.evidenceSeqs),
  });
  const opportunityChanges = outcome.opportunityChanges
    .map(normalizeOpportunity)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const lifecycleTransitions = outcome.lifecycleTransitions
    .map((value) => ({
      ...value,
      opportunity: { ...value.opportunity, targets: [...value.opportunity.targets].sort() },
      evidenceSeqs: sortedUnique(value.evidenceSeqs),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const judge =
    outcome.judge.decision === "select_opportunity"
      ? {
          ...outcome.judge,
          opportunity: {
            ...outcome.judge.opportunity,
            targets: [...outcome.judge.opportunity.targets].sort(),
          },
          evidenceSeqs: sortedUnique(outcome.judge.evidenceSeqs),
        }
      : { ...outcome.judge, evidenceSeqs: sortedUnique(outcome.judge.evidenceSeqs) };
  return JSON.stringify({
    evidenceSeqs: sortedUnique(outcome.evidenceSeqs),
    opportunityChanges,
    lifecycleTransitions,
    floor: {
      ...outcome.floor,
      expectedNext: [...outcome.floor.expectedNext].sort(),
      evidenceSeqs: sortedUnique(outcome.floor.evidenceSeqs),
    },
    judge,
  });
}

export function semanticOutcomeMatchesGold(
  actual: GoldSemanticOutcome,
  expectation: GoldExpectation,
): "match" | "mismatch" | "abstain" {
  if (expectation.mode === "abstain") return "abstain";
  const actualCanonical = canonicalOutcome(actual);
  return expectation.outcomes.some(
    (candidate) => canonicalOutcome(candidate) === actualCanonical,
  )
    ? "match"
    : "mismatch";
}

export function deployedActionAgainstGold(
  deployedBaseline: {
    observationStatus: "observed_records" | "not_observed";
    interventionLinkage: { status: string };
    records: Array<Record<string, unknown>>;
  },
  expectation: GoldExpectation,
): "match" | "mismatch" | "unknown" | "abstain" {
  if (expectation.mode === "abstain") return "abstain";
  if (
    deployedBaseline.observationStatus === "not_observed" ||
    deployedBaseline.interventionLinkage.status === "ambiguous_original_seq_collision"
  ) {
    return "unknown";
  }
  const actions = new Set<"speak" | "silent">();
  for (const record of deployedBaseline.records) {
    if (record.decision === "speak") actions.add("speak");
    if (record.decision === "stay_silent" || record.decision === "silent") {
      actions.add("silent");
    }
  }
  if (actions.size !== 1) return "unknown";
  const deployedAction = [...actions][0]!;
  const acceptableActions = new Set(
    expectation.outcomes.map((outcome) =>
      outcome.judge.decision === "silent" ? "silent" : "speak",
    ),
  );
  return acceptableActions.has(deployedAction) ? "match" : "mismatch";
}

export function turnAttribution(input: {
  deployed: ReturnType<typeof deployedActionAgainstGold>;
  candidate: ReturnType<typeof semanticOutcomeMatchesGold>;
}):
  | "preserved_correct"
  | "fixed"
  | "unchanged_error"
  | "regression"
  | "ambiguous_or_abstained" {
  if (input.deployed === "unknown" || input.deployed === "abstain" || input.candidate === "abstain") {
    return "ambiguous_or_abstained";
  }
  if (input.deployed === "match" && input.candidate === "match") return "preserved_correct";
  if (input.deployed === "mismatch" && input.candidate === "match") return "fixed";
  if (input.deployed === "match" && input.candidate === "mismatch") return "regression";
  return "unchanged_error";
}
