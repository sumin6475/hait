import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";
import type { MainJudgeSignal } from "./routeContext.js";
import { TRAIT_BY_ID } from "./traitData.js";
import type {
  ConversationObserverSnapshot,
  ObserverTranscriptMessage,
} from "./conversationObserver.js";
import { describeConversationSituation } from "./conversationObserver.js";
import type { CommunicativeAct } from "../types.js";
import {
  candidateSalienceOrder,
  describeConversationLedger,
  opportunityMayBypassCooldown,
  type ConversationLedgerState,
  type OpportunityKind,
} from "./conversationLedger.js";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });
const JUDGE_MODEL = "gpt-4o-mini";
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
        temperature: 0,
        max_output_tokens: JUDGE_MAX_TOKENS,
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
          temperature: 0,
          max_output_tokens: 220,
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

const ConversationLedgerJudgeSchema = z.object({
  decision: z.enum(["speak", "silent", "reobserve"]),
  act: z
    .enum(["answer", "participate", "follow", "contribute", "acknowledge", "mediate"])
    .nullable(),
  selectedOpportunityId: z.string().nullable(),
  evidence: z.enum([
    "selected_open_opportunity",
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
  evidenceSeqs: z.array(z.number().int()).max(12),
});

export type ConversationLedgerJudgeDecision = z.infer<typeof ConversationLedgerJudgeSchema>;
export const CONVERSATION_LEDGER_JUDGE_VERSION = "conversation-ledger-judge-v4";
export const CONVERSATION_LEDGER_JUDGE_PROMPT_VERSION =
  "conversation-ledger-judge-prompt-v5";
export const CONVERSATION_LEDGER_JUDGE_SCHEMA_VERSION =
  "conversation-ledger-judge-schema-v2";
export const CONVERSATION_LEDGER_JUDGE_MODEL = JUDGE_MODEL;
export const CONVERSATION_LEDGER_JUDGE_PARAMETERS = Object.freeze({
  temperature: 0,
  maxOutputTokens: 260,
  timeoutMs: 12_000,
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

const LEDGER_JUDGE_SYSTEM = `You are the condition-blind Main Judge for Alex, an AI participant in a small live group discussion.

Use the complete transcript as the source of truth and the structured ledger as a correctable projection. Decide one of: select exactly one open response opportunity, choose one useful voluntary act, remain silent, or request re-observation for a material state conflict. Do not write Alex's message. Never infer or use an experimental condition.

Opportunity acts are fixed by identity:
- direct_question -> answer
- invitation or group_request -> participate
- uptake -> follow

Only select an opportunity whose exact id is listed with status open. Deferred and terminal opportunities cannot be handled now. An invited opportunity is selectable only when its evidence includes the current trigger message; do not answer an older invited turn after the conversation has moved on. Required opportunities may remain pending across turns. Do not substitute a thread root for the current trigger. Do not combine or consume multiple opportunities.

Voluntary acts have no selectedOpportunityId:
- contribute adds a relevant non-redundant fact, factual correction, or concrete synthesis.
- follow takes up the point the humans just made and carries it one step further. Use it, with evidence=conversation_grounded_synthesis, when the useful move is to build directly on what was just said rather than to introduce a new fact. It needs no opportunity: follow is the act for the uptake opportunity kind when one is open, and is also available voluntarily when none is.
- acknowledge is brief social uptake without a new fact or agenda change.
- mediate is reserved for an explicit unresolved process blockage.

Opportunity acts may bypass ordinary cooldown but never an explicitly held human floor. Voluntary acts require ordinary cooldown. Choose reobserve only for a material conflict affecting target, opportunity identity/lifecycle, thread assignment, or floor. Low confidence alone is not enough.
When an open required opportunity was opened on the current trigger and no human floor is held, select it. Remaining silent in that state is invalid.

For every selected opportunity, use exactly: decision=speak, the act fixed above for its kind, evidence=selected_open_opportunity, and selectedTraitId=null. A selected invited opportunity does not automatically bypass cooldown. Without ordinary cooldown, only a required opportunity or the current foreground uptake cluster with current-trigger evidence may be selected.

For relevant_unsurfaced_information, select exactly one supplied eligible trait id. The eligible list covers every candidate in the thread's scope, ordered by what the group is currently on: the explicit focus candidate first when there is one, then the most recently named candidate. That order is a hint, not a restriction. Pick the id that fits the candidate the humans are actually discussing on this turn, reading the transcript rather than the position in the list; a fact about a candidate the group has moved past is not a useful move. All evidence sequence numbers must exist in the transcript. Output JSON only.`;

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

export function validateConversationLedgerJudgeDecision(input: {
  decision: ConversationLedgerJudgeDecision;
  state: ConversationLedgerState;
  eligibleTraitIds: readonly string[];
  transcriptSeqs: ReadonlySet<number>;
  cooldownAvailable?: boolean;
}): ConversationLedgerJudgeValidation {
  const { decision, state } = input;
  const ruleCodes: string[] = [];
  if (!decision.evidenceSeqs.every((seq) => input.transcriptSeqs.has(seq))) {
    ruleCodes.push("evidence_seq_not_in_transcript");
  }
  const currentRequiredOpportunityIds = new Set(
    state.opportunities
      .filter(
        (opportunity) =>
          opportunity.status === "open" &&
          state.threads.some((thread) => thread.id === opportunity.threadId && (thread.status === "open" || thread.status === "waiting")) &&
          opportunity.expectation === "required" &&
          opportunity.targets.includes("alex") &&
          (opportunity.openedAtSeq ?? opportunity.opportunitySourceSeq) === state.currentTriggerSeq,
      )
      .map((opportunity) => opportunity.id),
  );
  const humanFloorHeld =
    state.floor.transition === "held" &&
    state.floor.holder !== "alex" &&
    state.floor.holder !== "open" &&
    state.floor.holder !== "unclear";
  if (
    currentRequiredOpportunityIds.size > 0 &&
    !humanFloorHeld &&
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
    if (
      opportunity?.expectation === "invited" &&
      !opportunity.evidenceSeqs.includes(state.currentTriggerSeq)
    ) {
      ruleCodes.push("selected_invited_opportunity_not_current");
    }
    if (decision.evidence !== "selected_open_opportunity" || decision.selectedTraitId !== null) {
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
          : decision.act === "mediate"
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
  }
  if (decision.evidence === "relevant_unsurfaced_information") {
    if (
      decision.act !== "contribute" ||
      !decision.selectedTraitId ||
      !input.eligibleTraitIds.includes(decision.selectedTraitId)
    ) {
      ruleCodes.push("relevant_fact_trait_invalid");
    }
  } else if (decision.selectedTraitId !== null) {
    ruleCodes.push("trait_present_for_non_trait_evidence");
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
 * failed deterministic validation, and the retry capitulated to silence. Open
 * invited opportunities without current-trigger evidence are stale for the same
 * reason. Deferred opportunities stay, matching the prose summary, which
 * reports them as context the Judge may not act on.
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
      if (
        opportunity.status === "open" &&
        opportunity.expectation === "invited" &&
        !opportunity.evidenceSeqs.includes(state.currentTriggerSeq)
      ) {
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
 * Repairs a Judge output whose shape is wrong in a way that cannot change what
 * Alex would say, before deterministic validation sees it.
 *
 * Validation exists to reject decisions that mean the wrong thing. It was also
 * rejecting decisions that meant the right thing in the wrong fields, and the
 * retry's cheapest always-valid answer is `silent` — so a stray field became a
 * silence. In T-C2-037 the same violation, `trait_present_for_non_trait_evidence`,
 * cost four turns this way.
 *
 * Only one repair qualifies today. `selectedTraitId` reaches generation solely
 * through `build_on` + `relevant_unsurfaced_information`; under any other
 * evidence the field is inert, so clearing it is provably meaning-preserving.
 * The opposite repair — promoting the evidence to match the trait — is not:
 * it would hand the turn a licence to reveal a private note that the Judge
 * never asked for. Anything that could change meaning must still be rejected.
 */
export function canonicalizeConversationLedgerJudgeDecision(
  decision: ConversationLedgerJudgeDecision,
): { decision: ConversationLedgerJudgeDecision; repairCodes: string[] } {
  if (
    decision.selectedTraitId !== null &&
    decision.evidence !== "relevant_unsurfaced_information"
  ) {
    return {
      decision: { ...decision, selectedTraitId: null },
      repairCodes: ["trait_cleared_for_non_trait_evidence"],
    };
  }
  return { decision, repairCodes: [] };
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

export async function judgeConversationLedgerTurn(input: {
  messages: ObserverTranscriptMessage[];
  state: ConversationLedgerState;
  messagesSinceAlex: number;
  cooldownAvailable: boolean;
  backchannelAvailable: boolean;
  eligibleTraitIds: string[];
}): Promise<ConversationLedgerJudgeCallResult> {
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
  const user = `Current selectable ledger situation:\n${describeConversationLedger(decisionState)}\n\nDecision inputs:\n- Focus candidate: ${foreground?.focusCandidate ?? "none"}\n- Focus basis: ${foreground?.focusBasis ?? "none"}\n- Candidates ordered by what the group is currently on: ${foreground ? candidateSalienceOrder(foreground).join(", ") || "none" : "none"}\n- Selectable open opportunity ids: ${openOpportunities.map((item) => item.id).join(", ") || "none"}\n- Degraded mode: ${decisionState.degradedMode === true}\n\nExact structured decision ledger:\n${JSON.stringify(decisionState)}\n\nInfrastructure availability:\n- Messages since Alex: ${input.messagesSinceAlex}\n- Ordinary cooldown available: ${input.cooldownAvailable}\n- Backchannel interval available: ${input.backchannelAvailable}\n\nEligible exact unsurfaced Alex facts:\n${eligible.length ? eligible.join("\n") : "none"}\n\nComplete transcript:\n${transcript}\n\nJudge current trigger message ${decisionState.currentTriggerSeq}. Output JSON only.`;
  const attempts: ConversationLedgerJudgeCallAttempt[] = [];
  let priorRuleCodes: string[] = [];
  let priorDecisionJson = "none";
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
          temperature: CONVERSATION_LEDGER_JUDGE_PARAMETERS.temperature,
          max_output_tokens: CONVERSATION_LEDGER_JUDGE_PARAMETERS.maxOutputTokens,
          input: [
            { role: "system", content: LEDGER_JUDGE_SYSTEM },
            {
              role: "user",
              content:
                attempt > 0 && priorRuleCodes.length
                  ? `${user}\n\nYour previous decision was ${priorDecisionJson}. It violated: ${priorRuleCodes.join(", ")}. Correct the rejected output fields while keeping the transcript and ledger facts fixed. For a selected opportunity, evidence must be selected_open_opportunity and selectedTraitId must be null.`
                  : user,
            },
          ],
          text: {
            format: zodTextFormat(
              ConversationLedgerJudgeSchema,
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
