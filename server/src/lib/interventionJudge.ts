import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import { modelRequestParams } from "./openai.js";
import { guardEnabled } from "./guardFlags.js";
import { coverageGapNote } from "./candidateList.js";
import { CANDIDATES } from "./informationPools.js";
import type { MainJudgeSignal } from "./routeContext.js";
import type { Candidate, ConditionCode } from "../types.js";
import { TRAIT_BY_ID } from "./traitData.js";
import type {
  ConversationObserverSnapshot,
  ObserverTranscriptMessage,
} from "./conversationObserver.js";
import { describeConversationSituation, literalCandidateMentions } from "./conversationObserver.js";
import type { CommunicativeAct } from "../types.js";
import {
  candidateSalienceOrder,
  describeConversationLedger,
  liveForegroundThread,
  floorHeldForDecisions,
  opportunityMayBypassCooldown,
  opportunityStillStands,
  type ConversationLedgerState,
  type ResponseOpportunity,
  type OpportunityKind,
} from "./conversationLedger.js";
import { decidePreferenceFromKnownCoverage, isLeaderCondition } from "./routeContext.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
// The Judge now reads the message for what it asks, decides the subject, names
// what may be said, and writes the generator's instruction — four judgements the
// deterministic layer used to make with regular expressions. `gpt-4o-mini` was
// sized for a five-field routing decision. (`docs/adr/0005` concerned the
// Observer's model and is obsolete: the Observer runs on this one too.)
const JUDGE_MODEL = "gpt-5-mini";

/**
 * How long the generator's instruction may be.
 *
 * It is one sentence of ordinary language, not a place to restate the board.
 * Three hundred characters is roughly two sentences of English; the slack above
 * it exists so a turn is not lost to a comma.
 */
export const BRIEF_MAX_CHARS = 400;
const JUDGE_MAX_TOKENS = 64;
const JUDGE_TIMEOUT_MS = 8_000;
const JUDGE_WINDOW = 16;

// [Step 37] 거리(dist) 게이트는 cooldown으로 외재화, anti-repeat/consistency/why 제거 — judge는 순수 분류기.
const JudgeSchema = z.object({
  decision: z.enum(["contribute", "acknowledge", "silent"]),
  evidence: z.enum([
    "relevant_unsurfaced_information",
    "factual_correction",
    "conversation_grounded_synthesis",
    "social_uptake",
    "none",
  ]),
  selectedTraitId: z.string().nullable(),
});
export type JudgeDecision = z.infer<typeof JudgeSchema>;

export function validateJudgeDecisionSelection(
  decision: JudgeDecision,
  eligibleTraitIds: readonly string[],
): JudgeDecision | null {
  if (decision.evidence === "relevant_unsurfaced_information") {
    if (!decision.selectedTraitId || !eligibleTraitIds.includes(decision.selectedTraitId)) {
      return null;
    }
    return decision;
  }
  return { ...decision, selectedTraitId: null };
}

const JUDGE_SYSTEM = `You are the intervention judge for a small live team chat with two people and an AI teammate named Alex. The team is comparing candidates in a group decision.

Direct address, follow-up replies to Alex, long silence, summary, and closing have already been handled elsewhere. Classify only the current ordinary human-human exchange.

Choose exactly one decision:

CONTRIBUTE — Alex can materially advance the candidate discussion right now through exactly one of these:
1. One specific, relevant, non-redundant piece of unsurfaced factual information;
2. A concrete factual correction that should be made now; or
3. One specific conversation-grounded synthesis: a non-redundant connection, implication, tension, or unresolved distinction derived entirely from points the humans have already stated.

A conversation-grounded synthesis must add relational value between already-spoken human points. It must not introduce a new candidate fact, present an inference as a fact, merely repeat or summarize the conversation, express generic agreement, praise the discussion, redirect the agenda, or ask broadly for more information.

ACKNOWLEDGE — Alex has no substantive information to add, but one brief acknowledgment of the immediately preceding message would be socially useful and would not interrupt the people's exchange. This must not require a question, candidate comparison, new trait, preference, or procedural nudge.

SILENT — Alex should not speak. This is the default and common result.

A candidate being mentioned, praised, criticized, compared, or preferred is not by itself a reason to contribute. The user message includes compact server-derived fields for current focus, exchange class, and Alex's eligible unsurfaced private contributions for that focus. Treat them as authoritative.

When eligible unsurfaced private contributions are listed, each has an id and exact trait text. For relevant_unsurfaced_information, select exactly one listed id whose trait directly fits the current human exchange. Do not select a trait merely because it exists. The downstream generator will be restricted to that exact trait.

Decision policy for those fields:
- For exchange_class=substantive with private_contribution=available, choose CONTRIBUTE with evidence=relevant_unsurfaced_information unless the recent chat already contains that contribution.
- For exchange_class=substantive with private_contribution=none and current_focus=A, B, C, or D, choose CONTRIBUTE with evidence=conversation_grounded_synthesis only when there is one specific connection, implication, tension, or unresolved distinction grounded entirely in the recent human exchange that would materially advance the comparison.
- Do not choose conversation_grounded_synthesis for a paraphrase, recap, generic agreement, unsupported interpretation, topic change, procedural prompt, or broad request for the humans to provide more information. Otherwise choose SILENT.
- Choose CONTRIBUTE with evidence=factual_correction only when the recent chat contains a concrete factual error that should be corrected now.
- For exchange_class=acknowledgment, choose ACKNOWLEDGE with evidence=social_uptake when a brief social response would be useful and non-interruptive.
- For exchange_class=preference, procedural, or unclear, choose SILENT unless there is a concrete factual correction that must be made now.
- When current_focus=none and private_contribution=none, do not choose conversation_grounded_synthesis; choose SILENT unless correcting a concrete factual error.

Evidence must match the decision:
- relevant_unsurfaced_information, factual_correction, or conversation_grounded_synthesis → CONTRIBUTE
- social_uptake → ACKNOWLEDGE
- none → SILENT

selectedTraitId must be one eligible listed id only when evidence=relevant_unsurfaced_information. For every other evidence value, selectedTraitId must be null.

Choose acknowledgment and conversation-grounded synthesis sparingly. When uncertain whether a reaction adds new relational value, choose SILENT.

Do not decide whether Alex should express an allowed contribution as a statement or a question. Do not decide whether Alex should speak as a peer or a leader. Those choices are controlled downstream by the condition prompt and Turn Metadata. Do not choose mediation or a candidate, and do not write Alex's message.

Output JSON only.`;

export async function judgeIntervention(
  transcript: { speaker: string; content: string }[],
  msgsSinceAlex: number,
  signal: MainJudgeSignal,
): Promise<JudgeDecision | null> {
  const lines = transcript.map((t) => `${t.speaker}: ${t.content}`).join("\n");
  const eligibleContributions = signal.privateContributionIds
    .map((id) => {
      const trait = TRAIT_BY_ID.get(id);
      return trait ? `${id} | ${trait.valence === "pos" ? "MATCH" : "MISS"} | ${trait.text}` : null;
    })
    .filter((line): line is string => Boolean(line));
  const user = `Messages since Alex last spoke: ${msgsSinceAlex}\nCurrent focus: ${signal.focusCandidate ?? "none"}\nExchange class: ${signal.exchangeClass}\nPrivate contribution: ${signal.privateContributionAvailable ? "available" : "none"}\nEligible unsurfaced private contributions:\n${eligibleContributions.length ? eligibleContributions.join("\n") : "none"}\n\nRecent chat:\n${lines}\n\nClassify the intervention level now. Output JSON only.`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), JUDGE_TIMEOUT_MS);
  try {
    const resp = await client.responses.parse(
      {
        model: JUDGE_MODEL,
        ...modelRequestParams(JUDGE_MODEL, JUDGE_MAX_TOKENS),
        input: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: user },
        ],
        text: { format: zodTextFormat(JudgeSchema, "judge_decision") },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(to);
    const p = resp.output_parsed;
    if (!p) {
      // [진단] 게이트웨이 이전 후 null 원인 가시화 — 안정화되면 이 로그는 제거 가능
      console.error(`[judge] output_parsed null (status=${resp.status})`);
      return null;
    }
    const validated = validateJudgeDecisionSelection(p, signal.privateContributionIds);
    if (!validated) {
      console.error(
        `[judge] invalid selectedTraitId=${p.selectedTraitId ?? "none"} ` +
          `eligible=${signal.privateContributionIds.join(",") || "none"}`,
      );
      return null;
    }
    return validated;
  } catch (err: any) {
    clearTimeout(to);
    // [진단] timeout / 429(rate limit) / 기타 구분 — null이 왜 나는지 한 번 확인용
    const kind =
      err?.name === "AbortError" || err?.message?.includes("aborted")
        ? `timeout(${JUDGE_TIMEOUT_MS}ms)`
        : `status=${err?.status ?? "?"} ${err?.message ?? String(err)}`;
    console.error(`[judge] call failed → null: ${kind}`);
    return null;
  }
}

export const JUDGE_WINDOW_SIZE = JUDGE_WINDOW;

const UnifiedJudgeSchema = z.object({
  decision: z.enum(["speak", "silent", "reobserve"]),
  act: z
    .enum(["answer", "participate", "follow", "contribute", "acknowledge", "mediate"])
    .nullable(),
  evidence: z.enum([
    "direct_interaction",
    "group_participation",
    "response_to_alex",
    "relevant_unsurfaced_information",
    "factual_correction",
    "conversation_grounded_synthesis",
    "social_uptake",
    "human_floor_held",
    "cooldown",
    "no_useful_move",
    "observer_conflict",
  ]),
  selectedTraitId: z.string().nullable(),
  targetThreadRootSeq: z.number().int().nullable(),
  evidenceSeqs: z.array(z.number().int()).max(12),
});

export type UnifiedJudgeDecision = z.infer<typeof UnifiedJudgeSchema>;

const UNIFIED_JUDGE_SYSTEM = `You are the condition-blind turn-taking judge for Alex, an AI participant in a small live group discussion. You receive a cumulative Observer state, a deterministic English rendering of that state, infrastructure availability, exact eligible private facts, and the complete transcript.

Decide whether Alex should speak now and, if so, choose exactly one communicative act. Do not write Alex's message and do not infer leader/peer or XAI/ACI condition.

Acts:
- answer: directly satisfy a question or request addressed specifically to Alex.
- participate: take Alex's part in an explicit group-inclusive comparison, information-sharing, evaluation, or narrowing task.
- follow: respond to or acknowledge human material that answers, challenges, or continues an open Alex-initiated thread.
- contribute: voluntarily add one relevant non-redundant fact, factual correction, or conversation-grounded synthesis.
- acknowledge: a brief social uptake with no new candidate fact or agenda change.
- mediate: reserved for an explicit unresolved process blockage recorded in the supplied state; ordinary procedural language is not enough.

Interaction obligations (answer, participate, follow) are distinct from voluntary interventions. They may bypass ordinary cooldown, but they must wait when a specifically invited human clearly holds the floor. A latest human-to-human addressee does not erase Alex from an ongoing group or Alex-initiated thread. Conversely, merely talking about Alex in the third person is not an interaction obligation.
The "already served" flag applies to the previously recorded request obligation. It does not suppress a fresh current response_to_alex turn; evaluate that new uptake opportunity from the current anchor and floor.

Act selection must follow the Observer relation: explicit_addressee with a current question/request maps to answer; group_participant in an open group task maps to participate; response_to_alex after the humans yield the floor maps to follow. Do not call a response to Alex's own question an answer by Alex.

For voluntary contribute or acknowledge, cooldown must be available. Select relevant_unsurfaced_information only with exactly one eligible trait id. A conversation-grounded synthesis must add a concrete relation, tension, implication, or unresolved distinction from already-visible human points; generic agreement, recap, praise, or a broad prompt is insufficient. Use acknowledge sparingly.

When cooldown is available and one listed eligible private fact directly answers the substantive issue in the current exchange, choose speak/contribute with relevant_unsurfaced_information and that exact id unless the fact is already visible. This preserves the ordinary build-on behavior; do not suppress it merely because the humans could continue talking.
Merely mentioning, questioning, or proposing a criterion does not surface the candidate fact. A fact is already visible only when a participant has affirmatively stated that the candidate has or lacks that trait.

Choose reobserve only when the Observer state conflicts materially with the transcript or with itself in a way that changes whether Alex is involved or who holds the floor. Do not use reobserve merely because confidence is imperfect.

Evidence sequence numbers must point to transcript messages that support the decision. targetThreadRootSeq is the active thread root when the decision concerns a thread, otherwise null. Output JSON only.`;

export function validateUnifiedJudgeDecision(
  decision: UnifiedJudgeDecision,
  eligibleTraitIds: readonly string[],
): UnifiedJudgeDecision | null {
  if (decision.decision === "speak" && !decision.act) return null;
  if (decision.decision !== "speak" && decision.act !== null) return null;
  if (decision.evidence === "relevant_unsurfaced_information") {
    if (!decision.selectedTraitId || !eligibleTraitIds.includes(decision.selectedTraitId)) {
      return null;
    }
  } else if (decision.selectedTraitId !== null) {
    return null;
  }
  return decision;
}

export function alignUnifiedJudgeActWithObserver(
  decision: UnifiedJudgeDecision,
  snapshot: ConversationObserverSnapshot,
): UnifiedJudgeDecision {
  if (decision.decision !== "speak") return decision;
  const relation = snapshot.stateAfter.alexRelation ?? snapshot.observation.alexRelation;
  const thread = snapshot.stateAfter.activeThread ?? snapshot.observation.activeThread;
  if (relation === "explicit_addressee") {
    return {
      ...decision,
      act: "answer",
      evidence: "direct_interaction",
      selectedTraitId: null,
      targetThreadRootSeq: thread?.rootSeq ?? decision.targetThreadRootSeq,
    };
  }
  if (
    relation === "group_participant" &&
    thread &&
    (thread.status === "open" || thread.status === "waiting") &&
    (thread.alexParticipation === "required" || thread.alexParticipation === "invited")
  ) {
    return {
      ...decision,
      act: "participate",
      evidence: "group_participation",
      selectedTraitId: null,
      targetThreadRootSeq: thread.rootSeq,
    };
  }
  if (relation === "response_to_alex") {
    return {
      ...decision,
      act: "follow",
      evidence: "response_to_alex",
      selectedTraitId: null,
      targetThreadRootSeq: thread?.rootSeq ?? decision.targetThreadRootSeq,
    };
  }
  return decision;
}

export async function judgeConversationTurn(input: {
  messages: ObserverTranscriptMessage[];
  snapshot: ConversationObserverSnapshot;
  messagesSinceAlex: number;
  cooldownAvailable: boolean;
  backchannelAvailable: boolean;
  postGenerationReevaluation: boolean;
  interactionAlreadyServed: boolean;
  eligibleTraitIds: string[];
}): Promise<UnifiedJudgeDecision | null> {
  const transcript = input.messages
    .map((message) => `[${message.seq}] ${message.speaker}: ${message.content}`)
    .join("\n");
  const eligible = input.eligibleTraitIds
    .map((id) => {
      const trait = TRAIT_BY_ID.get(id);
      return trait ? `${id} | ${trait.valence === "pos" ? "MATCH" : "MISS"} | ${trait.text}` : null;
    })
    .filter((value): value is string => Boolean(value));
  const baseUser = `Current situation:\n${describeConversationSituation(input.snapshot)}\n\nStructured Observer state:\n${JSON.stringify(input.snapshot.stateAfter)}\n\nInfrastructure availability:\n- Messages since Alex: ${input.messagesSinceAlex}\n- Ordinary cooldown available: ${input.cooldownAvailable}\n- Backchannel interval available: ${input.backchannelAvailable}\n- This is a post-generation epoch re-evaluation: ${input.postGenerationReevaluation}\n- The currently recorded interaction obligation was already served: ${input.interactionAlreadyServed}\n\nEligible exact unsurfaced Alex facts:\n${eligible.length ? eligible.join("\n") : "none"}\n\nComplete transcript:\n${transcript}\n\nReturn the turn decision as JSON only.`;
  let firstValidDecision: UnifiedJudgeDecision | null = null;
  let relevanceAudit = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const user = relevanceAudit
      ? `${baseUser}\n\nFocused review: a first pass chose silent even though exact unsurfaced facts are available for the single active candidate. Re-check only whether one listed fact directly resolves the substantive issue raised in the latest exchange. If yes, choose speak/contribute with relevant_unsurfaced_information and that id. If none directly fits, preserve silent. Do not relax floor or cooldown rules.`
      : baseUser;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await client.responses.parse(
        {
          model: JUDGE_MODEL,
          ...modelRequestParams(JUDGE_MODEL, 220),
          input: [
            { role: "system", content: UNIFIED_JUDGE_SYSTEM },
            { role: "user", content: user },
          ],
          text: { format: zodTextFormat(UnifiedJudgeSchema, "unified_turn_decision") },
        },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      if (!response.output_parsed) continue;
      const validated = validateUnifiedJudgeDecision(
        response.output_parsed,
        input.eligibleTraitIds,
      );
      if (validated) {
        const aligned = alignUnifiedJudgeActWithObserver(validated, input.snapshot);
        const relation =
          input.snapshot.stateAfter.alexRelation ?? input.snapshot.observation.alexRelation;
        const activeCandidates = input.snapshot.observation.activeCandidates;
        const shouldAuditRelevantFact =
          !relevanceAudit &&
          aligned.decision === "silent" &&
          aligned.evidence === "no_useful_move" &&
          input.cooldownAvailable &&
          !input.postGenerationReevaluation &&
          !input.snapshot.stateAfter.expectedHumanResponder &&
          relation !== "explicit_addressee" &&
          relation !== "group_participant" &&
          relation !== "response_to_alex" &&
          activeCandidates.length === 1 &&
          input.eligibleTraitIds.length > 0;
        if (shouldAuditRelevantFact) {
          firstValidDecision = aligned;
          relevanceAudit = true;
          continue;
        }
        return aligned;
      }
    } catch (error: any) {
      clearTimeout(timeout);
      console.error(
        `[judge] unified call failed attempt=${attempt + 1}: ${error?.message ?? String(error)}`,
      );
      if (firstValidDecision) return firstValidDecision;
    }
  }
  return firstValidDecision;
}

export function legacyDecisionForAct(
  act: CommunicativeAct | null,
): "contribute" | "acknowledge" | "silent" {
  if (act === "acknowledge") return "acknowledge";
  if (act) return "contribute";
  return "silent";
}

const LEDGER_JUDGE_EVIDENCE = [
  "selected_open_opportunity",
  "relevant_unsurfaced_information",
  "factual_correction",
  "conversation_grounded_synthesis",
  "social_uptake",
  "human_floor_held",
  "cooldown",
  "no_useful_move",
  "observer_conflict",
] as const;

/**
 * Two schemas, because orthogonality belongs in the action space rather than in
 * a prompt rule. A Member's schema has no `mediate` and no `recap`, so the acts
 * are unrepresentable instead of merely forbidden — a rule the schema enforces
 * cannot be talked out of, and this repair has watched prose rules fail at this
 * class of problem repeatedly.
 *
 * The wide schema is the Chair's and the source of the decision type. A Member's
 * decision has the same type with fewer acts the model can emit, and the engine
 * still demotes a leader-only act to `contribute` for a non-Chair condition.
 */
const ConversationLedgerJudgeSchema = z.object({
  decision: z.enum(["speak", "silent", "reobserve"]),
  act: z
    .enum(["answer", "participate", "follow", "contribute", "acknowledge", "mediate", "recap"])
    .nullable(),
  selectedOpportunityId: z.string().nullable(),
  evidence: z.enum(LEDGER_JUDGE_EVIDENCE),
  // What Alex may put on the board this turn, named rather than counted. Empty
  // is a real answer and the common one: most turns add no fact. `docs/adr/0010`
  // is why this is a list of ids and not a number — a count cannot be repaired
  // without failing the task, and naming the content makes every count check
  // redundant.
  discloseTraitIds: z.array(z.string()),
  // The subject, decided here rather than re-derived downstream from candidate
  // mentions. A comparison names two candidates and a continuation names none,
  // which is exactly when the downstream derivation returned nothing.
  focusCandidate: z.enum(["A", "B", "C", "D"]).nullable(),
  // One sentence telling the generator what this turn has to accomplish, in
  // ordinary language. It never carries register or tone: the four condition
  // prompts own how Alex sounds, and they are hashed and diffable where this is
  // neither. Length is checked in `validateConversationLedgerJudgeDecision`
  // rather than in the schema, because structured outputs reject maxLength.
  brief: z.string(),
  evidenceSeqs: z.array(z.number().int()).max(12),
});

const ConversationLedgerMemberJudgeSchema = z.object({
  decision: z.enum(["speak", "silent", "reobserve"]),
  act: z.enum(["answer", "participate", "follow", "contribute", "acknowledge"]).nullable(),
  selectedOpportunityId: z.string().nullable(),
  evidence: z.enum(LEDGER_JUDGE_EVIDENCE),
  discloseTraitIds: z.array(z.string()),
  focusCandidate: z.enum(["A", "B", "C", "D"]).nullable(),
  brief: z.string(),
  evidenceSeqs: z.array(z.number().int()).max(12),
});

/** The act set this condition can even express. */
export function ledgerJudgeSchemaFor(conditionCode: ConditionCode) {
  return isLeaderCondition(conditionCode)
    ? ConversationLedgerJudgeSchema
    : ConversationLedgerMemberJudgeSchema;
}

export type ConversationLedgerJudgeDecision = z.infer<typeof ConversationLedgerJudgeSchema>;
/**
 * The rules a retry can fix by being handed the eligible ids — which is a
 * narrower set than "the rules that reject a named trait", and deliberately so.
 *
 * `disclose_trait_repeated` is out because every id named was already eligible;
 * the defect is the duplicate, and repeating the list would point at the field
 * that was right. It gets its own sentence instead.
 *
 * `trait_present_on_acknowledgement` and `trait_present_without_speech` are out
 * because listing what may be named would actively mislead: on an
 * acknowledgement and on a silence the only legal list is the empty one, and a
 * sentence beginning "The only ids you may put in discloseTraitIds are" says the
 * opposite.
 *
 * `relevant_fact_trait_invalid` is in, but conditionally — see
 * `ledgerJudgeRetryMessage`. It fires for two different reasons and only one of
 * them is about the ids.
 */
export const LEDGER_JUDGE_TRAIT_RETRY_RULE_CODES: readonly string[] = [
  "disclose_trait_not_eligible",
  "relevant_fact_trait_invalid",
];

/**
 * What a rejected Judge decision is told on its one retry.
 *
 * Extracted from the call loop so it can be asserted. The previous form was an
 * expression inside the request object: nothing could check that the eligible
 * ids reached the model, and the only test asserted membership in a constant —
 * it passed with the whole expression deleted.
 *
 * [T-C2-050 seq 14] is the turn this exists for. A participant asked Alex
 * directly. Two C traits were still eligible. Attempt 1 named `C_p1`, on the
 * board since seq 11, next to an eligible one, and was rejected for the spent
 * id. The retry, handed the rule name and nothing else, named `C_p1` again plus
 * `C_p2` — a trait on no card Alex holds — and the turn was lost to
 * `ledger_judge_failure`. The eligible list sits in the message above the retry
 * and the retry did not go back to it, so the ids are repeated inside the
 * sentence that says what was wrong.
 *
 * Naming nothing is a real answer when nothing is left; the failure mode here is
 * inventing, not abstaining. So the empty-list branch also names the way out —
 * `relevant_unsurfaced_information` requires a fact, and a retry ordered to
 * empty the list while keeping that evidence would trip
 * `relevant_fact_trait_invalid` on its second and last attempt and lose the turn
 * to the same `ledger_judge_failure` it was sent to repair.
 */
export function ledgerJudgeRetryMessage(input: {
  user: string;
  priorDecisionJson: string;
  priorRuleCodes: readonly string[];
  priorDiscloseTraitIds: readonly string[];
  requiredOpportunityIds: readonly string[];
  eligibleTraitIds: readonly string[];
}): string {
  const has = (code: string) => input.priorRuleCodes.includes(code);
  const hints: string[] = [];

  if (has("current_required_opportunity_not_selected") && input.requiredOpportunityIds.length) {
    hints.push(
      `Set selectedOpportunityId to one of: ${input.requiredOpportunityIds.join(", ")}. Do not select an older unanswered request.`,
    );
  }

  // `relevant_fact_trait_invalid` is raised both for an empty list under
  // `relevant_unsurfaced_information` and for the wrong act under it. Only the
  // first is about the ids; on the second the ids may be perfectly legal and
  // pointing at them sends the model back to the field it got right.
  const idsAreTheProblem =
    has("disclose_trait_not_eligible") ||
    (has("relevant_fact_trait_invalid") && input.priorDiscloseTraitIds.length === 0);
  if (idsAreTheProblem) {
    hints.push(
      input.eligibleTraitIds.length
        ? `The only ids you may put in discloseTraitIds are: ${input.eligibleTraitIds.join(", ")}. Every other id is already on the board or was never Alex's to give.`
        : "You hold no eligible unsurfaced fact this turn, so discloseTraitIds must be empty. If you chose relevant_unsurfaced_information, that evidence means you are adding a fact and you have none to add — choose different evidence, or stay silent.",
    );
  } else if (has("relevant_fact_trait_invalid")) {
    hints.push(
      'relevant_unsurfaced_information is the evidence for adding a fact, so it goes with act "contribute". The ids you named are not the problem.',
    );
  }

  if (has("disclose_trait_repeated")) {
    hints.push("Name each id at most once in discloseTraitIds.");
  }

  // The tail used to end "and selectedTraitId must be null". That field was
  // removed from both judge schemas, and the sentence sat immediately after the
  // one naming the ids that may be disclosed — telling the model, in the same
  // breath, to name a fact and to name nothing.
  return `${input.user}\n\nYour previous decision was ${input.priorDecisionJson}. It violated: ${input.priorRuleCodes.join(", ")}.${
    hints.length ? ` ${hints.join(" ")}` : ""
  } Correct the rejected output fields while keeping the transcript and ledger facts fixed. For a selected opportunity, evidence must be selected_open_opportunity.`;
}

export const CONVERSATION_LEDGER_JUDGE_VERSION = "conversation-ledger-judge-v8";
export const CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION =
  "conversation-ledger-judge-prompt-v17";
export const CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION =
  "conversation-ledger-judge-schema-v5";
export const CONVERSATION_LEDGER_JUDGE_MODEL = JUDGE_MODEL;
const LEDGER_JUDGE_REQUEST_PARAMS = modelRequestParams(JUDGE_MODEL, 700);
export const CONVERSATION_LEDGER_JUDGE_PARAMETERS = Object.freeze({
  ...LEDGER_JUDGE_REQUEST_PARAMS,
  timeoutMs: 20_000,
  maxAttempts: 2,
  seed: null,
  seedSupported: false,
});

export interface ConversationLedgerJudgeCallAttempt {
  attempt: number;
  status: "accepted" | "output_parsed_null" | "validation_failed" | "error";
  responseId?: string;
  model: string;
  latencyMs: number;
  error?: string;
  parsedOutput?: ConversationLedgerJudgeDecision;
  ruleCodes?: string[];
  /** Shape repairs applied before validation; see `canonicalizeConversationLedgerJudgeDecision`. */
  repairCodes?: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
  };
}

export interface ConversationLedgerJudgeCallResult {
  decision: ConversationLedgerJudgeDecision | null;
  attempts: ConversationLedgerJudgeCallAttempt[];
}

/**
 * Request shapes the Judge has to recognise, taken from real sessions.
 *
 * These were three regular-expression tables in `routeContext` until
 * `docs/adr/0010`. They are kept here as evidence rather than as code: the
 * phrasings are what participants actually wrote, and a word list is what missed
 * "give us a summary" in T-C4-022 seq 53 and answered a summary request as
 * though nothing had been asked.
 *
 *   Layout, which Alex cannot produce and must decline plainly:
 *     "can you make a table of the attributes across all candidates?"
 *     "can you give the table in the alphabetical order A, B, C, D?"
 *     "full row"
 *
 *   Collation, which a Member cannot do because it only holds its own card:
 *     "can we all just copy and paste all the items ... and alex can arrange them"
 *     "can you organize all our attributes together?"
 *
 *   Being addressed by a candidate letter, which Alex corrects once:
 *     "Alex, do you respond to C or just Alex?"
 *     "C, what does your negative comments indicate for A?"
 *
 * And the one none of them caught: "Alex can you give us a summary? Don't ask
 * followup quesiton, just give us with your call."
 */
export const LEDGER_JUDGE_SYSTEM = `You are the Main Judge for Alex, an AI participant in a small live group discussion.

Use the complete transcript as the source of truth and the structured ledger as a correctable projection. Decide one of: select exactly one open response opportunity, choose one useful voluntary act, remain silent, or request re-observation for a material state conflict. Do not write Alex's message.

You are given Alex's role in the group. Use it to choose which act to take and on what grounds. It tells you nothing about how often or how soon Alex should speak: pacing is decided outside you, and each turn tells you which moves are available. Never reason about elapsed time, about how many messages have passed since Alex spoke, or about speaking more or less because of the role. Do not infer anything about this group beyond the role you were given.

Opportunity acts are fixed by identity:
- direct_question -> answer
- invitation or group_request -> participate
- uptake -> follow

Only select an opportunity whose exact id is listed with status open. Deferred and terminal opportunities cannot be handled now. A request somebody made of Alex - invitation, group_request or direct_question - stays selectable while it is listed, whether it was made on this turn or an earlier one; an unanswered request does not stop being one because somebody else spoke next. An uptake is different: it is selectable only when its evidence includes the current trigger message, because it exists only while a human has just replied to Alex. Required opportunities may remain pending across turns. Do not substitute a thread root for the current trigger. Do not combine or consume multiple opportunities.

A listed request that nobody has answered outranks a voluntary act. When the turn lists an unanswered request addressed to Alex, select it rather than contributing, following or acknowledging something of your own choosing. This ranks a request above the acts you choose for yourself and nothing else; where a rule below tells you which opportunity to take, that rule decides.

What the humans said since Alex last spoke is what this turn replies to, and the turn lists those messages. Some of them may have gone unanswered only because Alex could not speak yet, or because a newer message arrived before a decision; they still count. This is about content, never pacing: it tells you what to reply to, not whether it is time for Alex to speak. Read those messages for what the people did - asked something, proposed where to go, disagreed, stated a choice, reported their own notes, or spoke to each other - and build the turn on that. When you select an older request, the brief answers it and also takes up what was said since. Never build a turn on a request Alex has already answered, and never hand the writer a premise nobody stated: no "as requested" when nobody asked, no "they asked why D is best" when nobody said D is best. When everything said since was addressed to one another rather than to Alex or the room, and no request to Alex is listed, leave that exchange to them.

Voluntary acts have no selectedOpportunityId:
- contribute adds a relevant non-redundant fact, factual correction, or concrete synthesis.
- follow takes up the point the humans just made and carries it one step further. Use it, with evidence=conversation_grounded_synthesis, when the useful move is to build directly on what was just said rather than to introduce a new fact. It needs no opportunity: follow is the act for the uptake opportunity kind when one is open, and is also available voluntarily when none is.
- acknowledge is brief social uptake without a new fact or agenda change.
- mediate hands the group its own discussion state back: what the room has been working on, and what it has not reached. It names no fact and picks no candidate, so take it when the useful move is about where the discussion stands rather than what is in it - the room has stayed on one or two candidates while others sit untouched, the same ground is being gone over again, or people are moving to settle before the field has been looked at. Name the state and the one thing left uncovered, and stop; it is theirs to weigh. The coverage line is the only thing that says which candidate is uncovered, and the transcript never overrides it: a candidate it lists as already covered has been covered by somebody's own notes, so do not ask for it again however long the room has argued about it, and a room arguing a candidate out is not a room that has left it uncovered. If the coverage line says there is no gap left to name, mediate about where the discussion stands and ask for nothing. Never turn it into a rule, a vote, a round, an exercise, or any other procedure, and never use it to tell them which candidate to choose. It is listed as available only on the turns that state is actually there. Say it once: a second mediation about the same gap is pushing, not leading.
- recap puts the board back in front of the group exactly as it stands. It writes nothing itself: the message is assembled from what has actually been said, so it adds no fact, names no trait and states no preference. Take it when the turn is better spent showing the group where the comparison currently stands than adding to it - the discussion has covered enough to be worth seeing whole, or people are weighing candidates against a picture they are holding in their heads. A spent card and a narrowed field is exactly that moment: nothing of yours is left to add, the group is deciding between two candidates from memory, and the whole board in front of them is worth more than another question. It is listed as available only while it is yours to take, and it is worth taking once.

Each turn lists the moves available on it. A move listed as not available is not a choice, and selecting it is invalid. Availability is a fact about this turn's options, never a budget to spend or save. Choose reobserve only for a material conflict affecting target, opportunity identity/lifecycle, thread assignment, or floor. Low confidence alone is not enough.
When an open required opportunity was opened on the current trigger and no human floor is held, select it. Remaining silent in that state is invalid.

For every selected opportunity, use exactly: decision=speak and the act fixed above for its kind, with evidence=selected_open_opportunity. Only an id listed as selectable on this turn may be selected.

You also decide three things about the content of the turn. Nothing downstream decides them, and no other stage reads the transcript.

focusCandidate is the subject. Name the candidate the turn is about, or null when it is about more than one or about none. Do not force a single letter onto a comparison.

discloseTraitIds is exactly what Alex may put on the board this turn, chosen from the supplied eligible facts and from nothing else. It is a list because the right number varies with what was asked: empty on most turns, one when adding a fact to a running discussion, and every relevant id when a person asked Alex to give what it has. Read the request and answer the size of it. Naming a fact is legitimate on any act, including answering a request; you are not limited to one, and you are not obliged to name any. An acknowledgement names none. If you choose relevant_unsurfaced_information you are adding a fact, so name at least one.

brief is one sentence of ordinary language telling the writer what this turn has to accomplish. Say what the person asked for and what the turn owes them - "they asked for a summary and told you not to ask anything back, so give the recap and stop", "they just answered your question about D, so take that up", "they want the full list for C". Write it as you would tell a colleague. Never describe how Alex should sound, never name the role, the strategy, the condition, or a style, and never mention ids, counts, scores, thresholds, opportunities, routes or anything else from this input. How Alex sounds is decided elsewhere. Keep it under 300 characters.

When the people move to set a candidate aside, to narrow the field, or to decide - which you read from what they wrote; no line in this input decides it for you - and the coverage line says nobody has brought anything of their own about a candidate they are leaving behind, that is worth saying once, plainly, as a fact about what is still unheard - and then it is theirs to weigh. Say it once and accept their answer; a second turn spent on the same candidate is pushing, not leading.

A line giving your own read of the candidates may appear beside the moves. It is what your card and the board come to with every requirement weighing the same, and it is Alex's honest standing view rather than an instruction to announce it. State it when somebody asks what you think or which one you would pick, and when your role's goal makes offering it the move. When the group has narrowed to some of the candidates, answer inside that set and read the order for which of those you are closer to; do not reopen the ones they set aside in order to answer. Never explain the read by weighing one requirement against another, and never put a count, a ratio or a score in the brief.

Every requirement in this task counts the same, and it is not yours to change. Never write a brief that proposes a rule, a criterion, a threshold, a cutoff, or a way of grouping traits into kinds, and never write one that assumes any trait outweighs, offsets, or disqualifies another. When the group asks how they should decide, that is a real question and the brief must not duck it. Alex's honest position is that it is worth looking at the candidates properly before choosing, and that how the group goes about it is up to them. Say that much and let the writer put it in its own words. Do not turn it into a procedure: no rule to apply, no bar to clear, no instruction to lay everything out or to count anything, and no naming of what "properly" would consist of. What matters here is which facts reach the table, not how they are scored.

The notes are the whole world of this task, and this is the rule rather than a list of words: the only thing anybody in this group can be asked for is a note on somebody's card. Everything else is outside the task and nobody has it - an example or an incident, a track record, a source or a witness, and equally a remedy, a mitigation, a management plan, a training programme, a policy, a safeguard, a way of coping with a trait. Never write a brief that asks for any of it and never supply one yourself. Asking invites them to make something up, and what comes back is not information about a candidate; it is a turn filled because the turn had nothing to add.

A turn with nothing to add has three real moves, and inventing a task is not one of them. Put the board back in front of the group, if the recap is still yours to take. Say plainly that your own notes hold nothing further on the candidate in question - that is true, it is Alex's to say, and it is worth the group knowing. Or ask what they still hold in their own notes, which the coverage line tells you is the live gap. One of those is always available; reach for them before anything else.

Read the person's message for what it actually asks. A request does not have to be a question, a request for everything Alex has is different from a request for one more fact, and a request you cannot carry out - a table, a chart, a compilation of what everybody else holds - is still a request whose shape the brief must name so the writer can decline it plainly.

Not every turn answers a request. When nobody has asked for anything and you still choose to speak, the brief says what the turn is FOR, in the same plain way, and it starts from what the people just said: take up their point before adding anything of your own, and add only what bears on it. The coverage line is not by itself a reason to take a turn or to change the subject. It becomes the move when they are leaving a candidate behind, as above, or when nothing they just said gives the turn anything to take up. In those cases, if the turn tells you nobody has brought anything of their own about some candidates, name one of them and say the turn is for bringing it back to the group - "nobody else has put anything of their own on A, so bring A back into the discussion". That holds even when your own card on that candidate is spent; the turn is for the group's attention, not for another fact from you, and a turn with nothing left to disclose names no trait. If it tells you there is no coverage gap left to name, say what the turn adds to the comparison the group is already having. Do not fill the turn by proposing how to decide.

A line about your card says what Alex itself has left to add. It says nothing about what the people still hold, so never write a brief that calls the information on a candidate exhausted, complete or fully covered for the group. When your card is spent, that is Alex's to say about its own notes only. And a spent card does not make the turn empty: while the coverage line still names candidates nobody has brought their own notes on, the useful thing to ask for is those notes. Take up what they just said and, in the same brief, ask what they still have on that candidate - "they have settled on D; ask what either of them still has in their own notes on A and B". A turn with nothing left of its own asks the group for theirs; it does not ask for anything that is not in anybody's notes, and it does not go quiet on the coverage gap because they are agreeing with each other.

The eligible list covers every candidate in the thread's scope, ordered by what the group is currently on: the explicit focus candidate first when there is one, then the most recently named candidate. That order is a hint, not a restriction. Pick what fits the candidate the humans are actually discussing on this turn, reading the transcript rather than the position in the list; a fact about a candidate the group has moved past is not a useful move. All evidence sequence numbers must exist in the transcript. Output JSON only.`;

/**
 * Alex's role in the group, as the Judge is told it.
 *
 * Until this existed the Judge was condition-blind by construction, so a Chair
 * and a Member decided identically and only *said* it differently — which
 * understates the manipulation, because a chair differs in what they decide to
 * do. See `docs/adr/0001-condition-reaches-the-judge.md`.
 *
 * The last paragraph is the boundary that decision draws, written into the
 * prompt rather than left to the reader: the role may reach *which act on what
 * grounds*, and must never reach *when*. Intervention triggers and timing are
 * held constant across conditions, so a role goal that made Alex speak sooner
 * or more often would break the comparison the study rests on.
 */
export function ledgerJudgeRoleGoal(conditionCode: ConditionCode): string {
  const goal = isLeaderCondition(conditionCode)
    ? "Alex chairs this group. Actively guide the group toward a well-considered collective decision: structure the conversation, keep it focused and moving, address disagreements, and take responsibility for a clear outcome."
    : "Alex is an ordinary member of this group. Contribute cooperatively as an equal team member: share relevant information, respond constructively, and help evaluate the options, without directing, managing, or mediating.";
  return `${goal}

This role decides which act is the right one and on what grounds. It does not decide when Alex speaks. Do not weigh how long it has been since Alex last spoke, and do not aim to speak more or less often because of it.`;
}

const ACT_FOR_OPPORTUNITY_KIND: Record<OpportunityKind, CommunicativeAct> = {
  direct_question: "answer",
  invitation: "participate",
  group_request: "participate",
  uptake: "follow",
};

export interface ConversationLedgerJudgeValidation {
  ok: boolean;
  value?: ConversationLedgerJudgeDecision;
  ruleCodes: string[];
}

/**
 * The opportunities this turn is *required* to take: the ones a human opened on
 * the message being judged.
 *
 * [T-C4-023] This rule was enforced and never stated. The prompt offered
 * "Unanswered requests addressed to Alex, oldest first" — pointing at the
 * backlog — while validation demanded the newest, so on three turns the Judge
 * reached back to an older unanswered question and the decision was rejected.
 * The retry named the rule code and not the id, so it guessed again and lost the
 * turn, which added one more unanswered question to the backlog that caused it.
 * Two of the three were the group asking "Alex can you give us a summary?".
 *
 * Prompt, retry and validation now read this one function, so the model cannot
 * be rejected for missing something it was never told.
 */
export function currentRequiredOpportunityIdsFor(state: ConversationLedgerState): string[] {
  return state.opportunities
    .filter(
      (opportunity) =>
        opportunity.status === "open" &&
        state.threads.some(
          (thread) =>
            thread.id === opportunity.threadId &&
            (thread.status === "open" || thread.status === "waiting"),
        ) &&
        opportunity.expectation === "required" &&
        opportunity.targets.includes("alex") &&
        (opportunity.openedAtSeq ?? opportunity.opportunitySourceSeq) === state.currentTriggerSeq,
    )
    .map((opportunity) => opportunity.id);
}

export function validateConversationLedgerJudgeDecision(input: {
  decision: ConversationLedgerJudgeDecision;
  state: ConversationLedgerState;
  eligibleTraitIds: readonly string[];
  transcriptSeqs: ReadonlySet<number>;
  cooldownAvailable?: boolean;
  /** Whether `recap` is one of this turn's moves. Absent reads as not offered. */
  recapAvailable?: boolean;
  /** Whether `mediate` is one of this turn's moves. Absent reads as not offered. */
  mediationAvailable?: boolean;
}): ConversationLedgerJudgeValidation {
  const { decision, state } = input;
  const ruleCodes: string[] = [];
  if (!decision.evidenceSeqs.every((seq) => input.transcriptSeqs.has(seq))) {
    ruleCodes.push("evidence_seq_not_in_transcript");
  }
  const currentRequiredOpportunityIds = new Set(currentRequiredOpportunityIdsFor(state));
  // This was a second, inline copy of the reducer's floor rule. Two rules for
  // one question is what B9 had to unify between the opportunity derivation and
  // the floor check, and it cost three consecutive turns before it was found.
  if (
    currentRequiredOpportunityIds.size > 0 &&
    !floorHeldForDecisions(state) &&
    !(
      (decision.decision === "speak" &&
        decision.selectedOpportunityId !== null &&
        currentRequiredOpportunityIds.has(decision.selectedOpportunityId)) ||
      (decision.decision === "reobserve" && decision.evidence === "observer_conflict")
    )
  ) {
    ruleCodes.push("current_required_opportunity_not_selected");
  }
  if (decision.decision !== "speak") {
    if (decision.act !== null) ruleCodes.push("non_speak_has_act");
    if (decision.selectedOpportunityId !== null) ruleCodes.push("non_speak_has_opportunity");
  } else if (!decision.act) {
    ruleCodes.push("speak_missing_act");
  }
  if (decision.decision === "reobserve" && decision.evidence !== "observer_conflict") {
    ruleCodes.push("reobserve_without_conflict");
  }
  if (
    decision.decision === "speak" &&
    ["human_floor_held", "cooldown", "no_useful_move", "observer_conflict"].includes(
      decision.evidence,
    )
  ) {
    ruleCodes.push("speak_with_silence_evidence");
  }
  if (decision.selectedOpportunityId) {
    const opportunity = state.opportunities.find(
      (candidate) => candidate.id === decision.selectedOpportunityId,
    );
    if (!opportunity || opportunity.status !== "open" || !opportunity.targets.includes("alex")) {
      ruleCodes.push("selected_opportunity_not_open_for_alex");
    }
    if (opportunity && !state.threads.some((thread) => thread.id === opportunity.threadId &&
      (thread.status === "open" || thread.status === "waiting"))) {
      ruleCodes.push("selected_opportunity_thread_not_live");
    }
    if (opportunity && (decision.decision !== "speak" || decision.act !== ACT_FOR_OPPORTUNITY_KIND[opportunity.kind])) {
      ruleCodes.push("act_does_not_match_opportunity_kind");
    }
    if (opportunity && !opportunityStillStands(state, opportunity)) {
      ruleCodes.push("selected_invited_opportunity_not_current");
    }
    // Answering a request no longer forbids naming a fact. Under `docs/adr/0010`
    // the Judge decides what the turn may put on the board on every act, and the
    // turn that most needs to — "Alex, list what you have on C" — is a selected
    // opportunity. Requiring an empty list here is what made T-C4-022 seq 53
    // unanswerable: the Judge read the request, and a separate layer capped the
    // answer at one trait.
    if (decision.evidence !== "selected_open_opportunity") {
      ruleCodes.push("opportunity_evidence_contract_invalid");
    }
    if (
      opportunity &&
      input.cooldownAvailable === false &&
      !opportunityMayBypassCooldown(state, opportunity)
    ) {
      ruleCodes.push("selected_opportunity_requires_cooldown");
    }
  } else if (
    decision.decision === "speak" &&
    (decision.act === "answer" || decision.act === "participate")
  ) {
    // `follow` is deliberately no longer listed here. Answering and
    // participating are replies to a request somebody made, so they need that
    // request on record. Picking up the point a human just made is not a reply
    // to a request — yet `uptake`, the only opportunity kind that maps to
    // `follow`, is minted only after a human responds to Alex. So for the whole
    // stretch where the humans talked to each other, following them was
    // structurally illegal and the Judge had to fall back to silence.
    ruleCodes.push("interaction_act_missing_opportunity");
  }
  if (!decision.selectedOpportunityId && decision.decision === "speak") {
    const validVoluntaryEvidence =
      decision.act === "contribute"
        ? [
            "relevant_unsurfaced_information",
            "factual_correction",
            "conversation_grounded_synthesis",
          ].includes(decision.evidence)
        : decision.act === "acknowledge"
          ? decision.evidence === "social_uptake"
          : decision.act === "mediate" || decision.act === "recap"
            ? decision.evidence === "conversation_grounded_synthesis"
            : decision.act === "follow"
              // A voluntary follow still has to earn the floor with something
              // the humans just said. Restricting it to grounded synthesis
              // keeps it distinct from `contribute` (which carries a fact or a
              // correction) and stops it degenerating into an unconditional
              // right to speak on every turn.
              ? decision.evidence === "conversation_grounded_synthesis"
              : false;
    if (!validVoluntaryEvidence) ruleCodes.push("voluntary_act_evidence_invalid");
    // The prompt used to ask for this in prose and nothing checked it, so the
    // model ignored it: 18 of 19 decisions in T-C1-024 were `speak`, and both
    // cooldown silences in T-C2-041 were voluntary contributions the router
    // then discarded. The rule was left out originally because a rejection
    // costs a retry, and on a turn where nothing was takeable that made a
    // blocked turn slower for nothing. That objection no longer holds: a turn
    // with no takeable act never reaches the Judge at all now, so every turn
    // that gets here is one a retry can still win.
    if (input.cooldownAvailable === false) {
      ruleCodes.push("voluntary_act_unavailable_this_turn");
    }
    // A recap is offered on the turns it is Alex's to take and on no others: a
    // Member's schema cannot express it, and a Chair that has already recapped
    // has spent it. Stated as a move rather than enforced only in prose, so the
    // turn facts and the validator cannot disagree about what was on offer.
    if (decision.act === "recap" && input.recapAvailable !== true) {
      ruleCodes.push("recap_unavailable_this_turn");
    }
    // Same shape for mediation, and the same reason: the turn facts and the
    // validator must not disagree about what was on offer. A Member never sees
    // the move, and a Chair sees it only while the discussion state that opens
    // it is actually there.
    if (decision.act === "mediate" && input.mediationAvailable !== true) {
      ruleCodes.push("mediation_unavailable_this_turn");
    }
  }
  // The board is recited, never written. A recap that also names a fact is a
  // contribution wearing a recap's name, and the message it produces would not
  // contain the named fact anyway - the text is assembled from the board.
  if (decision.act === "recap" && decision.discloseTraitIds.length) {
    ruleCodes.push("recap_names_a_trait");
  }
  // Mediation is about the shape of the discussion, not its contents. A
  // mediation carrying a fact is a contribution with a leader's framing on it,
  // and the writer's mediation block is not allowed to state the fact anyway.
  if (decision.act === "mediate" && decision.discloseTraitIds.length) {
    ruleCodes.push("mediation_names_a_trait");
  }
  // What the Judge named must be Alex's to name. `eligibleTraitIds` is the
  // unsurfaced part of Alex's own card inside the thread's scope, so anything
  // outside it is either already on the board or was never Alex's to disclose.
  const ineligible = decision.discloseTraitIds.filter(
    (id) => !input.eligibleTraitIds.includes(id),
  );
  if (ineligible.length) {
    ruleCodes.push("disclose_trait_not_eligible");
  }
  if (new Set(decision.discloseTraitIds).size !== decision.discloseTraitIds.length) {
    ruleCodes.push("disclose_trait_repeated");
  }
  if (decision.evidence === "relevant_unsurfaced_information") {
    // This evidence *is* "I am adding a fact", so an empty list contradicts it.
    if (decision.act !== "contribute" || decision.discloseTraitIds.length === 0) {
      ruleCodes.push("relevant_fact_trait_invalid");
    }
  }
  // A backchannel adds no fact by definition, in every condition.
  if (decision.act === "acknowledge" && decision.discloseTraitIds.length > 0) {
    ruleCodes.push("trait_present_on_acknowledgement");
  }
  // Silence says nothing, so it cannot name anything or instruct anyone.
  if (decision.decision !== "speak") {
    if (decision.discloseTraitIds.length > 0) ruleCodes.push("trait_present_without_speech");
  } else if (guardEnabled("judgeBrief")) {
    // T-C4-023 lost three turns here, two of them the participants' repeated
    // "Alex can you give us a summary?". A rejected decision retries once and
    // then falls to silence, so a brief the model wrote badly cost the whole
    // turn — and until this session the brief was then discarded anyway. It
    // reaches the generator now, which is what makes rejecting on it defensible
    // at all; the flag exists to measure whether it still is.
    if (!decision.brief.trim()) {
      ruleCodes.push("brief_missing");
    } else if (decision.brief.length > BRIEF_MAX_CHARS) {
      // Checked here rather than in the schema: structured outputs reject
      // `maxLength`, so the bound has to live where the rule codes do.
      ruleCodes.push("brief_too_long");
    }
  }
  if (
    state.degradedMode &&
    decision.decision === "speak" &&
    ((decision.selectedOpportunityId &&
      state.opportunities.find((item) => item.id === decision.selectedOpportunityId)?.kind !== "direct_question") ||
      (!decision.selectedOpportunityId && decision.evidence !== "relevant_unsurfaced_information"))
  ) {
    ruleCodes.push("degraded_mode_disallows_inferred_speech");
  }
  return ruleCodes.length ? { ok: false, ruleCodes } : { ok: true, value: decision, ruleCodes: [] };
}

/**
 * The exact set of opportunities the Main Judge is allowed to see and choose
 * from on this turn.
 *
 * Unselectable opportunities are historical context, not choices. Two classes
 * are removed. Terminal opportunities used to be serialized into the prompt's
 * `Exact structured decision ledger` even though the prose summary above it
 * listed only open ones; the model read the JSON, selected a consumed id,
 * failed deterministic validation, and the retry capitulated to silence. An
 * opportunity that no longer stands is dropped for the same reason — see
 * `opportunityStillStands`, which is also the rule validation enforces, so the
 * prompt cannot offer a choice validation would reject. Deferred opportunities
 * stay, matching the prose summary, which reports them as context the Judge may
 * not act on.
 *
 * The prose summary and the serialized ledger must be built from this same
 * projection so the two can never disagree again.
 */
export function conversationLedgerDecisionProjection(
  state: ConversationLedgerState,
  options?: { cooldownAvailable?: boolean },
): ConversationLedgerState {
  return {
    ...state,
    opportunities: state.opportunities.filter((opportunity) => {
      if (opportunity.status !== "open" && opportunity.status !== "deferred") return false;
      if (opportunity.status === "open" && !opportunityStillStands(state, opportunity)) {
        return false;
      }
      // Same principle as the two filters above, applied to the last class of
      // option the Judge could see but never take. Without ordinary cooldown
      // only a required opportunity or the current uptake cluster is
      // selectable; everything else is rejected by
      // `selected_opportunity_requires_cooldown`. T-C2-037 turn 2 listed one
      // such opportunity and nothing else, the model selected it twice, and the
      // turn ended in `ledger_judge_failure` — no decision at all.
      if (
        options?.cooldownAvailable === false &&
        !opportunityMayBypassCooldown(state, opportunity)
      ) {
        return false;
      }
      return true;
    }),
  };
}

/**
 * Which of these opportunities are requests nobody has answered, oldest first.
 *
 * [Issue 13B] Making an unanswered request reachable again is only half of it.
 * The other half is that the Judge must be able to see that it outranks a
 * voluntary act — and it must see that *before* it decides. The alternative was
 * to let it choose freely and then reject the answer, but the retry's cheapest
 * always-valid output is `silent`, so a ranking enforced by rejection buys
 * silences rather than answers. The same trade is why
 * `canonicalizeConversationLedgerJudgeDecision` exists.
 *
 * So the ranking is a fact in the prompt, beside the ids, and nothing here
 * rewrites the Judge's answer. It ranks a request above the acts the Judge
 * chooses for itself and nothing further: an ordering *among* requests would
 * contradict `current_required_opportunity_not_selected`, which forces a
 * required opportunity opened on this turn ahead of any older one, and a prompt
 * that argues with its own validator buys the retry's cheapest answer again.
 *
 * Uptakes are excluded because they are not requests: nobody asked. Ordering is
 * by `originSeq`, the message the request was actually made in, not by when the
 * opportunity was last given evidence — the group has been waiting since it was
 * asked.
 *
 * Takes the opportunities rather than the state, so the caller settles what
 * "on offer" means and this cannot quietly disagree with it. The Judge's prompt
 * passes the decision projection's open set; the silence audit passes whatever
 * was open on a turn Alex never got to.
 */
export function unansweredRequestsForAlex(
  opportunities: readonly ResponseOpportunity[],
): ResponseOpportunity[] {
  return opportunities
    .filter((opportunity) => opportunity.status === "open" && opportunity.kind !== "uptake")
    .sort((left, right) => left.originSeq - right.originSeq);
}

/**
 * The router's verdict, when it is already knowable without asking the Judge.
 *
 * Two of the router's vetoes are pure functions of state the reducer has
 * already settled: a held human floor, and the ordinary cooldown. Both used to
 * be applied *after* a full Observer and a full Judge had run. Every silence in
 * T-C1-024 and T-C1-025, and both non-greeting silences in T-C2-041, took that
 * path — a model call, and then a second one, to reach a conclusion arithmetic
 * had already reached.
 *
 * The cooldown does not veto unconditionally: a `required` expectation, or an
 * `uptake` invitation on the foreground thread, speaks through it. So the test
 * is not "is the cooldown available" but "is there anything left that Alex
 * could take" — and that question is answered by the decision projection, which
 * is the same filter the Judge's prompt and its validation are built from. A
 * separately written rule for the same question is how the prose summary and
 * the serialized ledger came to disagree once already.
 *
 * The order matters: the router checks the floor first, so this does too.
 * Reporting the cooldown for a floor-held turn would conflate two silences the
 * invariants require to stay distinct.
 *
 * Returns the veto that applies, or null when the Judge has a real decision to
 * make. Nothing here reads the condition, and nothing here may: which turns
 * Alex can speak on is held constant across conditions.
 */
export type DeterministicJudgeVeto = "human_floor_held" | "cooldown";

export function deterministicVetoBeforeJudge(
  state: ConversationLedgerState,
  options: { cooldownAvailable: boolean },
): DeterministicJudgeVeto | null {
  if (floorHeldForDecisions(state)) return "human_floor_held";
  if (options.cooldownAvailable || !guardEnabled("cooldown")) return null;
  const takeable = conversationLedgerDecisionProjection(state, options).opportunities.some(
    (opportunity) => opportunity.status === "open" && opportunity.targets.includes("alex"),
  );
  return takeable ? null : "cooldown";
}

/**
 * Repairs a Judge output whose shape is wrong in a way that cannot change what
 * Alex would say, before deterministic validation sees it.
 *
 * Validation exists to reject decisions that mean the wrong thing. It was also
 * rejecting decisions that meant the right thing in the wrong fields, and the
 * retry's cheapest always-valid answer is `silent` — so a stray field became a
 * silence. In T-C2-037 the same violation, `trait_present_for_non_trait_evidence`,
 * cost four turns this way.
 *
 * One repair qualifies today: a silent decision that still carries a brief or a
 * disclosure list has both cleared, since a silent turn broadcasts nothing either
 * way. The trait clearing that was the other one went with `docs/adr/0010`.
 * Anything that could change meaning must still be rejected.
 */
export function canonicalizeConversationLedgerJudgeDecision(
  decision: ConversationLedgerJudgeDecision,
): { decision: ConversationLedgerJudgeDecision; repairCodes: string[] } {
  const repairCodes: string[] = [];
  let next = decision;
  // Silence cannot carry an instruction or a disclosure. Both are shape errors
  // rather than meaning changes — a silent turn broadcasts nothing either way —
  // so they are repaired rather than rejected.
  if (next.decision !== "speak" && (next.discloseTraitIds.length || next.brief.trim())) {
    next = { ...next, discloseTraitIds: [], brief: "" };
    repairCodes.push("silent_decision_carried_speech_fields");
  }
  // The trait clearing that used to live here is gone. It existed because
  // evidence and disclosure were coupled, and `docs/adr/0010` uncouples them:
  // naming a fact is now legitimate on any act the Judge chose, so a list that
  // does not belong is rejected by validation rather than quietly emptied.
  return { decision: next, repairCodes };
}

/**
 * True when the Judge asked to speak, deterministic validation rejected the
 * request, and the retry then answered `silent`.
 *
 * The retry prompt reports the violated rule codes and asks for a correction.
 * `silent` is the one output that always validates, so it is the cheapest way
 * out of a rejection — and the resulting record is indistinguishable from a
 * turn where the Judge genuinely had nothing worth saying, because both land as
 * `evidence: "no_useful_move"`. Session T-C2-034 shows the pattern three times
 * (turns 22, 25 and 26: attempt 1 selects an opportunity, is rejected, attempt
 * 2 goes silent).
 *
 * This does not decide whether the silence was wrong. A capitulation can be
 * correct — the model may have had no valid move. It exists so the two cases
 * stop sharing one label and speech-volume loss can be attributed. Treat a
 * rising capitulation rate as a signal to fix the contract the Judge keeps
 * violating, not as a licence to force speech.
 */
export function judgeCapitulatedToSilence(
  decision: ConversationLedgerJudgeDecision | null,
  attempts: readonly ConversationLedgerJudgeCallAttempt[],
): boolean {
  if (!decision || decision.decision === "speak") return false;
  return attempts.some(
    (attempt) =>
      attempt.status === "validation_failed" && attempt.parsedOutput?.decision === "speak",
  );
}

/** The rule codes a capitulating Judge backed away from, for the silence audit. */
export function judgeCapitulationRuleCodes(
  attempts: readonly ConversationLedgerJudgeCallAttempt[],
): string[] {
  return [
    ...new Set(
      attempts
        .filter(
          (attempt) =>
            attempt.status === "validation_failed" && attempt.parsedOutput?.decision === "speak",
        )
        .flatMap((attempt) => attempt.ruleCodes ?? []),
    ),
  ].sort();
}

export interface LedgerJudgeCallInput {
  messages: ObserverTranscriptMessage[];
  state: ConversationLedgerState;
  conditionCode: ConditionCode;
  cooldownAvailable: boolean;
  backchannelAvailable: boolean;
  eligibleTraitIds: string[];
  /** The board: the leader's coverage note and, in every condition, Alex's own read. Absent means neither is added. */
  revealStats?: unknown;
  /** Whether `recap` is one of this turn's moves. Absent reads as not offered. */
  recapAvailable?: boolean;
  /**
   * Whether `mediate` is one of this turn's moves. Absent reads as not offered,
   * which is what a Member always gets.
   *
   * The act has been in the Chair's schema since the schema existed and was
   * chosen zero times in every recorded session, because the moves block never
   * listed it and the system prompt says a move not listed is not a choice. The
   * engine meanwhile kept a latch of the discussion-state evidence that opens
   * it, wrote it to the session on every turn, and never read it back: in
   * S-C2-002 that latch was on from seq 16 to the end and no mediation turn
   * ever ran.
   */
  mediationAvailable?: boolean;
  /** Which discussion-state evidence opened it, for the moves line. */
  mediationEvidence?: readonly string[];
}

/**
 * The one line of the live candidate list the leader's Judge is given.
 *
 * [Q6/Q7, `.scratch/leader-decision-frame` issues 02-04] The list has been
 * computed every turn since issue 02 and reached nothing but the record. The
 * leader's generator already receives the whole board and the "Still to cover"
 * agenda line; the *Judge* did not, so it wrote the turn's purpose without
 * knowing which candidates the group had barely touched. In T-C4-024 that gap
 * showed: on a turn where A and D had nothing on them, the Judge told the
 * writer to "propose a clear criterion to decide", and Alex invented a rule
 * that weighted trait categories — the one thing the equal-weight task standard
 * forbids. Naming the uncovered candidates gives that turn a legitimate move.
 *
 * Issue 04's first two moves are built — naming an uncovered candidate, and saying
 * what the humans have pooled — and so is the narrowing half of the third: the
 * Judge raises a shortfall once when the people move to set a candidate aside,
 * narrow or decide, which it reads from what they wrote. A shortfall at the close
 * is not built.
 *
 * **"Thin" now means the humans have said nothing of their own.** Under the
 * coverage bar this replaced (`docs/adr/0011`), Alex's own disclosures retired
 * candidates from the list, so the sentence went quiet on the one thing a leader
 * can act on. T-C2-051 seq 23 is the case: the Judge was told every candidate
 * was covered, and told the group so, while all four of the pooled answer's
 * human-only traits were still unsaid — and they were still unsaid when the
 * session ended.
 *
 * **Peer conditions get null.** Owning the discussion procedure is the status
 * manipulation (`.scratch/leader-decision-frame/spec.md`, "Receives the live
 * candidate list: leader yes / peer no"). The gate is here, in one function, so
 * a test can hold it.
 *
 * Numbers deliberately do not appear. The brief rules forbid the writer being
 * told a count, and a Judge handed coverage integers is a Judge that can leak
 * one — so it is handed the reading, not the arithmetic.
 */
export function leaderCoverageNote(
  conditionCode: ConditionCode,
  revealStats: unknown,
): string | null {
  if (!isLeaderCondition(conditionCode)) return null;
  // The wording lives in `coverageGapNote`, beside the list it reads, because
  // the mediation writer needs the same sentence and cannot import this file.
  return coverageGapNote(revealStats);
}

/**
 * How many of the most recent human messages count as "the last stretch".
 *
 * Chosen, not derived, and this is how. Read against the three completed Chair
 * sessions: at four the reading flickers (T-C2-051 goes A, C then A then A, B, C
 * across three messages); at five and six it does not, and the two agree on every
 * transition. Five reacts one message sooner, and the cost of being early here is
 * a note given before it was useful rather than a candidate dropped.
 *
 * It is recorded on the turn so a session can be re-read against a different
 * window, the same reason `coverage` is still written beside the list it no
 * longer decides (`docs/adr/0011`).
 */
export const NARROWING_WINDOW_HUMAN_MESSAGES = 5;

/**
 * Which candidates the humans have been naming lately, once they have had all
 * four in view.
 *
 * Recorded on every turn as `narrowedCandidates`, and no longer given to the
 * Judge. [T-C2-053, 2026-09-14] From seq 24 this read "the last stretch named only
 * C and D" while the people were arguing both of them out, and Alex's next two
 * voluntary turns (seqs 28 and 34) brought A and B traits in over what had just
 * been said. Attention and intent point opposite ways exactly when a group argues
 * a candidate out, so the Judge reads the move from what the people wrote and
 * this stays a record.
 *
 * **It reads attention, not intent.** Deciding *why* a candidate left the
 * conversation means reading "let's drop C", "it's between A and B" and "C is
 * weak so I'd rather not" as the same move, which is a sentence-shape problem
 * with no end — this repository has patched a word list three times to learn
 * that. What it reports instead is a fact that cannot be wrong: the last few
 * human messages named these and not those. T-C2-051's Candidate C was forgotten
 * rather than rejected; T-C2-053's C and D were argued out, and read the same.
 *
 * **The precondition is what makes it mean narrowing.** Early on, "only B and C
 * have been named" is the discussion not having started, not the group closing
 * in. So this returns null until every candidate has been named by a human at
 * least once. All three Chair sessions cross that line within two messages of
 * each other (seqs 22, 24, 25), and the readings after it are identical in
 * shape: three candidates, then two.
 *
 * Alex's own messages are not counted. Alex names candidates constantly, and a
 * group has not narrowed because Alex kept talking about D.
 */
export function humanNarrowedCandidates(
  messages: readonly ObserverTranscriptMessage[],
  window = NARROWING_WINDOW_HUMAN_MESSAGES,
): Candidate[] | null {
  const named: Candidate[][] = [];
  const everNamed = new Set<Candidate>();
  for (const message of messages) {
    if (message.senderRole === "ai") continue;
    const mentions = literalCandidateMentions(message.content ?? "") as Candidate[];
    named.push(mentions);
    for (const candidate of mentions) everNamed.add(candidate);
  }
  if (everNamed.size < CANDIDATES.length) return null;
  const recent = new Set(named.slice(-window).flat());
  if (recent.size === 0 || recent.size >= CANDIDATES.length) return null;
  return CANDIDATES.filter((candidate) => recent.has(candidate));
}

/**
 * Alex's own read of the candidates, as one sentence with no numbers in it.
 *
 * [T-C2-051 seq 24-25] A participant asked "Alex, why do you think D is the
 * best?". Alex had never said D was best. It answered "My current read is
 * Candidate D" — taking the lean from the question's premise — while the server
 * computing the same thing from Alex's card and the board had A and D level at
 * that moment and A ahead by seq 37. The same thing happened again at seq 38.
 *
 * The computation was not wrong and did not disagree with the turn. It was
 * **absent**: the preference cue reaches the generator only when the turn's
 * request is classified as one of four kinds, and seq 24 was classified as no
 * request at all, so nothing carried a lean into that turn and the model filled
 * the gap. Across the whole of T-C2-051 the cue never fired once.
 *
 * So the lean is given to the Judge on every turn instead, beside the other turn
 * facts, the way the coverage note is. The Judge decides whether the turn
 * expresses it; the generator's cue still carries the wording deterministically
 * on the turns it fires, and both read the same function on the same board, so
 * they cannot name different candidates.
 *
 * **The whole order, not the top of it.** Narrowing is the Judge's call
 * (`.scratch/leader-decision-frame/spec.md`), and a group that has narrowed to
 * two candidates Alex does not lead with cannot be answered from the leader
 * alone. T-C2-051 seq 27 narrowed to A and B; the top of the order says nothing
 * about which of those two Alex is closer to.
 *
 * **Condition-blind.** Having a view of the candidates is not owning the
 * discussion procedure; the role goal already decides whether Alex volunteers it
 * or waits to be asked. Contrast `leaderCoverageNote`, which is the leader's
 * alone.
 *
 * **No numbers, for the third time in this file.** A count reads as a budget,
 * and every requirement weighing the same is the study's control — a sentence
 * carrying ratios invites a brief that argues from them.
 */
export function alexPreferenceNote(revealStats: unknown): string | null {
  if (!revealStats) return null;
  const decision = decidePreferenceFromKnownCoverage(revealStats);
  const opening = "Weighing every requirement the same, your card plus what is on the board";
  if (!decision.eligible || !decision.ranking.length) {
    return `${opening} does not yet separate the candidates.`;
  }
  const name = (group: Candidate[]) =>
    group.length === 1
      ? `Candidate ${group[0]}`
      : `${group.slice(0, -1).map((candidate) => `Candidate ${candidate}`).join(", ")} and Candidate ${group.at(-1)} together`;
  const qualifier =
    decision.scope === "partial"
      ? `, among the ones there is enough on both sides to compare`
      : "";
  const groups = decision.ranking;
  if (groups.length === 1) {
    return `${opening}${qualifier} leaves ${name(groups[0]!)} level.`;
  }
  const middle = groups.slice(1, -1).map((group) => `then ${name(group)}`);
  return `${opening}${qualifier} puts ${name(groups[0]!)} first, ${[...middle, `and ${name(groups.at(-1)!)} last`].join(", ")}.`;
}

/**
 * Which candidates in this thread's scope Alex has nothing further to say
 * about, stated rather than left to be inferred from an absence.
 *
 * [T-C2-050 seq 19] Alex had put all six of its Candidate A traits on the board
 * across seqs 15 and 17. The group came back to A, the Judge set
 * `focusCandidate: "A"`, and for `discloseTraitIds` it emitted `["A"]` — the
 * bare candidate letter where a trait id goes. There was no A id left in the
 * eligible list to emit, and nothing in the prompt said so. The decision was
 * rejected as ineligible and the turn broadcast an empty message.
 *
 * The eligible list already carried the fact, but only by omission, and noticing
 * which prefix has gone missing from a list of ids is the thing a model is worst
 * at — it answered with the letter itself. So the absence is named.
 *
 * This is not an edge case. A hidden-profile discussion that works properly
 * through one candidate exhausts Alex's card for that candidate by design, and
 * the group then keeps talking about it — which is exactly when the Judge is
 * most likely to follow the topic instead of the list.
 *
 * Condition-blind, and it must stay that way. What Alex still holds is Alex's
 * own card, which every condition already receives in full through the eligible
 * list; naming what is absent from that list tells a Peer nothing it did not
 * already have. Contrast `leaderCoverageNote`, which reports the *group's*
 * coverage and is the leader's alone.
 *
 * No numbers, for the same reason as the coverage note: a count reads as a
 * budget, and a budget is a fact about when Alex speaks (`docs/adr/0001`).
 */
export function exhaustedCandidateNote(
  eligibleTraitIds: readonly string[],
  scopeCandidates: readonly Candidate[],
): string | null {
  if (!scopeCandidates.length) return null;
  const stillHeld = new Set(
    eligibleTraitIds
      .map((id) => TRAIT_BY_ID.get(id)?.candidate)
      .filter((candidate): candidate is Candidate => candidate !== undefined),
  );
  const spent = scopeCandidates.filter((candidate) => !stillHeld.has(candidate));
  if (!spent.length) return null;
  const name = (candidate: Candidate) => `Candidate ${candidate}`;
  const remaining = scopeCandidates.filter((candidate) => stillHeld.has(candidate));
  if (!remaining.length) {
    return `Everything on your card about ${spent.map(name).join(", ")} is already on the board, and this thread covers nothing else. You hold no unsurfaced fact to add here.`;
  }
  return `Everything on your card about ${spent.map(name).join(", ")} is already on the board. What you still hold is about ${remaining.map(name).join(", ")}.`;
}

/**
 * The human messages since Alex last spoke, oldest first.
 *
 * What a turn replies to. The Judge was handed the trigger and the transcript and
 * built the turn around the trigger, so a message the cooldown kept Alex from
 * answering, or one overtaken by a newer message before any decision, was context
 * the turn could pass over — and did: T-C2-052 seqs 28 and 39, T-C2-053 seqs 31
 * and 32, the last of them the room asking for everyone's top choice.
 */
export function humanMessagesSinceAlexSpoke(
  messages: readonly Pick<ObserverTranscriptMessage, "seq" | "senderRole">[],
  throughSeq: number,
): number[] {
  const seqs: number[] = [];
  const visible = messages.filter((message) => message.seq <= throughSeq);
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (visible[index]!.senderRole === "ai") break;
    seqs.unshift(visible[index]!.seq);
  }
  return seqs;
}

/**
 * The Judge's user message.
 *
 * Exported because what this text does and does not contain is the substance of
 * a decision, not an implementation detail. It used to carry `Messages since
 * Alex` and `Ordinary cooldown available` — two facts about *time*, on a stage
 * that must not decide when Alex speaks. What replaces them is a list of the
 * moves available on this turn: a fact about the options, which is the same
 * shape the opportunity list already had.
 *
 * The reason that distinction matters is not stylistic. A counter can be read
 * as a budget, and a Judge with a condition-dependent role goal plus a budget
 * decides *when* differently by condition. An availability flag has nothing to
 * spend.
 *
 * The message numbers it does carry are not that counter. They say which
 * messages the turn replies to (`humanMessagesSinceAlexSpoke`), so the cooldown
 * can delay a reply without erasing what it replies to; the prompt tells the
 * Judge they are content and never pacing.
 */
export function buildLedgerJudgeUserMessage(
  input: Pick<
    LedgerJudgeCallInput,
    "messages" | "state" | "cooldownAvailable" | "backchannelAvailable" | "eligibleTraitIds"
  > &
    Partial<
      Pick<
        LedgerJudgeCallInput,
        "conditionCode" | "revealStats" | "recapAvailable" | "mediationAvailable" | "mediationEvidence"
      >
    >,
): string {
  // Both of the board-derived sentences require a board. `revealStats` has been
  // documented as "absent means no note is added" since it was added, and was
  // not honoured: `computeCandidateList(undefined)` returns nothing pooled for
  // all four candidates, so an absent board produced "nobody has brought
  // anything from their own notes about any candidate" — a fabrication, not a
  // silence. A live session always
  // has one (`Session.revealStats` is defaulted at creation), so nothing on the
  // speaking path loses a note; the caller that passes nothing is the offline
  // replay eval, whose corpus carries no surfaced-trait ids on any of its 1451
  // messages. An eval that feeds the Judge an invented board cannot measure the
  // Judge.
  const boardKnown = input.revealStats !== undefined;
  const coverageNote =
    input.conditionCode === undefined || !boardKnown
      ? null
      : leaderCoverageNote(input.conditionCode, input.revealStats);
  // Condition-blind, and gated on the same board the other two sentences are:
  // an absent board reads as "nothing separates them", which is a claim, not a
  // silence.
  const preferenceNote = boardKnown ? alexPreferenceNote(input.revealStats) : null;
  const saidSinceAlex = humanMessagesSinceAlexSpoke(input.messages, input.state.contextThroughSeq);
  const decisionState = conversationLedgerDecisionProjection(input.state, {
    cooldownAvailable: input.cooldownAvailable,
  });
  const transcript = input.messages
    .filter((message) => message.seq <= input.state.contextThroughSeq)
    .map((message) => `[${message.seq}] ${message.speaker}: ${message.content}`)
    .join("\n");
  const eligible = input.eligibleTraitIds
    .map((id) => {
      const trait = TRAIT_BY_ID.get(id);
      return trait ? `${id} | ${trait.valence === "pos" ? "MATCH" : "MISS"} | ${trait.text}` : null;
    })
    .filter((value): value is string => Boolean(value));
  const foreground = decisionState.foregroundThreadId
    ? decisionState.threads.find((thread) => thread.id === decisionState.foregroundThreadId)
    : undefined;
  const openOpportunities = decisionState.opportunities.filter((item) => item.status === "open");
  // Ordered for prefix caching: the transcript is append-only, so leading it
  // gives every later turn a long stable prefix, while the ledger changes on
  // every turn and must sit behind it. The previous order put the volatile
  // ledger first and the judge reported `cachedInputTokens: 0` on every call in
  // both T-C1-020 and T-C2-039 — the system block alone falls under the 1024
  // token minimum, so nothing was cacheable at all.
  const availability = (available: boolean) => (available ? "available" : "not available");
  const requiredNow = currentRequiredOpportunityIdsFor(decisionState);
  // The card note reads the eligible list, so it has to be gated by the same
  // test the eligible list was built under. `foreground` above is "the thread in
  // the foreground" and is right for the Decision-inputs lines, which describe
  // that thread whatever its status; `liveForegroundThread` is "a thread Alex
  // can still act in", which is what an empty eligible list means. Deriving the
  // sentence from the wrong one of those turned a resolved thread into the
  // claim that Alex's whole card was spent.
  const liveThread = boardKnown ? liveForegroundThread(decisionState) : undefined;
  const cardNote = liveThread
    ? exhaustedCandidateNote(input.eligibleTraitIds, candidateSalienceOrder(liveThread))
    : null;
  return `Complete transcript:\n${transcript}\n\nCurrent selectable ledger situation:\n${describeConversationLedger(decisionState)}\n\nDecision inputs:\n- Said by the humans since Alex last spoke: ${saidSinceAlex.length ? `messages ${saidSinceAlex.join(", ")}` : "none"}\n- Focus candidate: ${foreground?.focusCandidate ?? "none"}\n- Focus basis: ${foreground?.focusBasis ?? "none"}\n- Candidates ordered by what the group is currently on: ${foreground ? candidateSalienceOrder(foreground).join(", ") || "none" : "none"}\n- Degraded mode: ${decisionState.degradedMode === true}\n\nMoves available on this turn:\n- Selectable open opportunity ids: ${openOpportunities.map((item) => item.id).join(", ") || "none"}\n- ${requiredNow.length ? `You must select one of these, opened by the message you are judging: ${requiredNow.join(", ")}. The older unanswered requests below are context; taking one of them instead is rejected.` : "No opportunity is required this turn."}\n- Unanswered requests addressed to Alex, oldest first: ${unansweredRequestsForAlex(openOpportunities).map((item) => `${item.id} (asked at message ${item.originSeq})`).join(", ") || "none"}\n- Voluntary acts (contribute, follow): ${availability(input.cooldownAvailable)}\n- acknowledge: ${availability(input.cooldownAvailable && input.backchannelAvailable)}${input.recapAvailable === undefined ? "" : `\n- recap: ${availability(input.cooldownAvailable && input.recapAvailable)}`}${input.mediationAvailable === undefined ? "" : `\n- mediate: ${availability(input.cooldownAvailable && input.mediationAvailable)}${input.mediationAvailable && input.mediationEvidence?.length ? ` (the discussion state that opened it: ${input.mediationEvidence.join(", ")})` : ""}`}${cardNote ? `\n- Your card: ${cardNote}` : ""}${coverageNote ? `\n- Coverage: ${coverageNote}` : ""}${preferenceNote ? `\n- Your read: ${preferenceNote}` : ""}\n\nExact structured decision ledger:\n${JSON.stringify(decisionState)}\n\nEligible exact unsurfaced Alex facts:\n${eligible.length ? eligible.join("\n") : "none"}\n\nJudge current trigger message ${decisionState.currentTriggerSeq}. Output JSON only.`;
}

export async function judgeConversationLedgerTurn(
  input: LedgerJudgeCallInput,
): Promise<ConversationLedgerJudgeCallResult> {
  const user = buildLedgerJudgeUserMessage(input);
  const requiredIdsForRetry = currentRequiredOpportunityIdsFor(input.state);
  // The same projection the prompt was built from, so validation can never
  // reject a choice the prompt offered.
  const decisionState = conversationLedgerDecisionProjection(input.state, {
    cooldownAvailable: input.cooldownAvailable,
  });
  const attempts: ConversationLedgerJudgeCallAttempt[] = [];
  let priorRuleCodes: string[] = [];
  let priorDecisionJson = "none";
  let priorDiscloseTraitIds: string[] = [];
  for (let attempt = 0; attempt < CONVERSATION_LEDGER_JUDGE_PARAMETERS.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CONVERSATION_LEDGER_JUDGE_PARAMETERS.timeoutMs,
    );
    const started = Date.now();
    try {
      const response = await client.responses.parse(
        {
          model: JUDGE_MODEL,
          ...LEDGER_JUDGE_REQUEST_PARAMS,
          input: [
            { role: "system", content: LEDGER_JUDGE_SYSTEM },
            // The role goal is its own message, and sits between the fixed
            // rules and the turn's facts. It is constant for a session, so it
            // extends the cacheable prefix rather than perturbing it.
            { role: "developer", content: ledgerJudgeRoleGoal(input.conditionCode) },
            {
              role: "user",
              content:
                attempt > 0 && priorRuleCodes.length
                  ? ledgerJudgeRetryMessage({
                      user,
                      priorDecisionJson,
                      priorRuleCodes,
                      priorDiscloseTraitIds,
                      requiredOpportunityIds: requiredIdsForRetry,
                      eligibleTraitIds: input.eligibleTraitIds,
                    })
                  : user,
            },
          ],
          text: {
            format: zodTextFormat(
              ledgerJudgeSchemaFor(input.conditionCode),
              "conversation_ledger_turn_decision",
            ),
          },
        },
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      const baseAttempt = {
        attempt: attempt + 1,
        responseId: response.id,
        model: response.model ?? JUDGE_MODEL,
        latencyMs: Date.now() - started,
        ...(response.usage
          ? {
              usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                totalTokens: response.usage.total_tokens,
                cachedInputTokens: response.usage.input_tokens_details.cached_tokens,
              },
            }
          : {}),
      };
      if (!response.output_parsed) {
        attempts.push({ ...baseAttempt, status: "output_parsed_null" });
        continue;
      }
      const canonical = canonicalizeConversationLedgerJudgeDecision(response.output_parsed);
      const validation = validateConversationLedgerJudgeDecision({
        decision: canonical.decision,
        state: decisionState,
        eligibleTraitIds: input.eligibleTraitIds,
        transcriptSeqs: new Set(input.messages.map((message) => message.seq)),
        cooldownAvailable: input.cooldownAvailable,
        recapAvailable: input.recapAvailable,
        mediationAvailable: input.mediationAvailable,
      });
      if (validation.ok && validation.value) {
        attempts.push({
          ...baseAttempt,
          status: "accepted",
          ...(canonical.repairCodes.length
            ? { parsedOutput: response.output_parsed, repairCodes: canonical.repairCodes }
            : {}),
        });
        return { decision: validation.value, attempts };
      }
      attempts.push({
        ...baseAttempt,
        status: "validation_failed",
        parsedOutput: response.output_parsed,
        ruleCodes: validation.ruleCodes,
        ...(canonical.repairCodes.length ? { repairCodes: canonical.repairCodes } : {}),
      });
      priorRuleCodes = validation.ruleCodes;
      priorDecisionJson = JSON.stringify(canonical.decision);
      priorDiscloseTraitIds = canonical.decision.discloseTraitIds;
    } catch (error: any) {
      clearTimeout(timeout);
      const message = error?.message ?? String(error);
      attempts.push({
        attempt: attempt + 1,
        status: "error",
        model: JUDGE_MODEL,
        latencyMs: Date.now() - started,
        error: message,
      });
      console.error(
        `[judge] ledger call failed attempt=${attempt + 1}: ${message}`,
      );
    }
  }
  return { decision: null, attempts };
}
