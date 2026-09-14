//AIIntervention 모델 - AI 평가 로그
//AI가 평가할 때마다 1행 -  "speak"/"stay_silent"
//previous_response_id로 컨텍스트 관리

import mongoose from "mongoose";
import { disabledGuards } from "../lib/guardFlags.js";
import type { AIDecision, RouteKind, RerouteReason, ExemptReason } from "../types.js";

const outputRepairAttemptSchema = new mongoose.Schema(
  {
    stage: { type: String, enum: ["initial", "repair"], required: true },
    outcome: { type: String, enum: ["accepted", "rejected", "failed"], required: true },
    content: { type: String },
    responseId: { type: String },
    model: { type: String, required: true },
    latencyMs: { type: Number },
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    systemFingerprint: { type: String },
    extractedTraitIds: { type: [String], default: undefined },
    violations: { type: [String], default: undefined },
    softViolations: { type: [String], default: undefined },
    error: { type: String },
  },
  { _id: false },
);

const outputRepairGuardSchema = new mongoose.Schema(
  {
    candidate: { type: String, enum: ["A", "B", "C", "D"] },
    reason: { type: String, required: true },
    // 과거 행 전용 — docs/adr/0010이 네 개수 제한을 없앴다. 이전 세션 export가 읽으므로 남긴다.
    maxTraitIds: { type: Number },
    maxRestatedTraitIds: { type: Number },
    maxSentences: { type: Number },
    maxWords: { type: Number },
    allowedTraitIds: { type: [String], default: undefined },
    requiredTraitId: { type: String },
  },
  { _id: false },
);

// What Alex was allowed to reveal on this turn, and what it revealed.
//
// `inForce: false` is a recorded fact. T-C2-041 seq 4 named all four candidates
// on Alex's second turn and the export could not distinguish a guard that passed
// from a guard that was never set, because both left nothing behind. Trait ids
// are pool identifiers; no participant text and no message content is written
// here.
const outputGuardSchema = new mongoose.Schema(
  {
    inForce: { type: Boolean, required: true },
    reason: { type: String },
    candidate: { type: String, enum: ["A", "B", "C", "D"] },
    // The counts that used to sit here went with `docs/adr/0010`. What a turn
    // was permitted to introduce is now a named list, so the record holds the
    // list rather than a number nobody can check a message against afterwards.
    allowedTraitIds: { type: [String] },
    requiredTraitId: { type: String },
    traitIds: { type: [String], default: [] },
    violation: { type: String },
  },
  { _id: false },
);

// The candidates that still needed the group's attention when this turn was
// taken, and the two counts read off the board. Shadow only: nothing in
// routing, cadence or generation reads it, and it is here so that a real
// session can be read against the bar before any of it steers speech.
//
// `score` is recorded and is deliberately not an input to `live` — over a
// shared-dominated board it ranks the candidates backwards (`docs/adr/0009`).
// Both counts are kept so the record can be re-read against a different bar
// afterwards, which the list alone does not allow.
const candidateListSchema = new mongoose.Schema(
  {
    coverage: { A: Number, B: Number, C: Number, D: Number },
    score: { A: Number, B: Number, C: Number, D: Number },
    // What a human put on the board that Alex does not hold — the quantity the
    // list is built on since `docs/adr/0011`. Absent on rows written before it.
    pooled: { A: Number, B: Number, C: Number, D: Number },
    live: { type: [String], default: [] },
    covered: { type: [String], default: [] },
  },
  { _id: false },
);

const outputRepairAuditSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    guard: { type: outputRepairGuardSchema, default: undefined },
    attempts: { type: [outputRepairAttemptSchema], required: true },
  },
  { _id: false },
);

const aiInterventionSchema = new mongoose.Schema(
  {
    //어느 세션
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    //평가가 일어난 시점의 메시지 순번 - stay_silent일때 분석 위해
    turnIndex: { type: Number, required: true },

    //평가 트리거 사유 (네이티브 언어 사용)
    triggerReason: { type: String, required: true },

    //이 턴의 speaking reason(cue) — provenance/분석용 (Step 6)
    cue: { type: String },

    //판단 결과
    decision: { type: String, enum: ["speak", "stay_silent"] as AIDecision[], required: true },

    //speak일 때만 - 생성된 message와 연결
    generateMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    //OpenAI Responses API 응답 ID
    responseId: { type: String },

    //호출에 사용한 모델명 (예: "gpt-5.5")
    model: { type: String },

    //응답 원문. prompt는 2026-09-08 삭제된 aiTurn 경로만 썼다 — 과거 행 전용
    prompt: { type: String },
    response: { type: String },

    //메타 - 토큰 수, 지연시간(ms)
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    latencyMs: { type: Number },

    //OpenAI 모델 버전 식별자
    systemFingerprint: { type: String },

    //judge 사유 문자열 — Step 20. aiTurn 경로 전용이라 과거 행 전용. 라이브 사유는 judgeEvidence·routeReason·silenceReason
    why: { type: String },

    //[Step 30] 지목 호명 overlay — aiTurn 경로 전용이라 과거 행 전용 (tail 조립기는 2026-09-14 삭제)
    calloutTarget: { type: String },
    calloutCand: { type: String },

    //[Tier 0] 경로 종류 — 분석용
    routeKind: {
      type: String,
      enum: [
        "address",
        "followup",
        "long_silence",
        "build_on",
        "mediation",
        "backchannel",
        "greeting",
        "summary",
        "closing",
      ] as RouteKind[],
    },
    //[Tier 0] judge 원시 출력 (reroute 전 값)
    judgeSpeak: { type: Boolean },
    judgeReason: { type: String },
    //[Tier 0] 리라우트 여부 + 사유
    rerouted: { type: Boolean, default: false },
    rerouteReason: {
      type: String,
      enum: ["judge_silent", "peer_mediation", "opening", "none"] as RerouteReason[],
    },
    //[Tier 0] 면제 사유 (쿨다운 bypass)
    exemptReason: {
      type: String,
      enum: ["address", "followup", "long_silence", "none"] as ExemptReason[],
    },
    //[Tier 0] 지연/예약 정보
    delayMs: { type: Number },
    scheduledFor: { type: Date },

    // V2 provenance. Legacy fields above remain for old pilot exports.
    source: { type: String },
    reservationId: { type: String },
    anchorSeq: { type: Number },
    conversationEpoch: { type: Number },
    interactionObligationEpoch: { type: Number },
    postGenerationReevaluation: { type: Boolean },
    priorityRoute: { type: String },
    priorityEvidence: { type: String },
    mainJudgeDecision: { type: String },
    judgeEvidence: { type: String },
    communicativeAct: {
      type: String,
      enum: ["answer", "participate", "follow", "contribute", "acknowledge", "mediate", "recap"],
    },
    judgeEvidenceSeqs: { type: [Number], default: undefined },
    controllerMode: {
      type: String,
      enum: ["legacy", "ledger_shadow", "ledger_active"],
    },
    ledgerVersion: { type: String },
    ledgerJudgeVersion: { type: String },
    ledgerJudgePromptVersion: { type: String },
    ledgerJudgeSchemaVersion: { type: String },
    ledgerJudgeAttempts: { type: mongoose.Schema.Types.Mixed, default: undefined },
    selectedOpportunityId: { type: String },
    selectedOpportunitySourceSeq: { type: Number },
    selectedOpportunityThreadId: { type: String },
    selectedOpportunityKind: {
      type: String,
      enum: ["direct_question", "invitation", "group_request", "uptake"],
    },
    selectedOpportunityExpectation: {
      type: String,
      enum: ["required", "invited"],
    },
    selectedOpportunityTargets: { type: [String], default: undefined },
    selectedOpportunityRequestedAction: { type: String },
    selectedOpportunityAlexBroadcastSeq: { type: Number },
    selectedOpportunityTransition: { type: mongoose.Schema.Types.Mixed, default: undefined },
    // Main Judge selection provenance. Cadence mediation can supersede the
    // build-on route, so this may be recorded even when the trait is not used.
    selectedTraitId: { type: String },
    // What the Judge said this turn could put on the board, and the instruction
    // it wrote for the writer. Both are recorded because `docs/adr/0010` moves
    // decisions the deterministic layer used to make into a model call, and a
    // decision made by a model that is not written down cannot be audited later.
    discloseTraitIds: { type: [String] },
    judgeBrief: { type: String },
    /**
     * [Issue 13B] The requests that were open, and unanswered, on a turn Alex
     * stayed silent.
     *
     * The invariant is that a silence is attributable, and "cooldown" alone
     * does not say that somebody was also still waiting for an answer. Half B
     * makes that pairing more common by design — a request now survives the
     * turn it was made on, so it is open across the cooldown turns that follow
     * — which is exactly why the pairing has to be visible in the record rather
     * than reconstructed from `ledgerStateAfter` by re-running the filter.
     *
     * Pool-free: opportunity ids only, no participant text.
     */
    owedRequestIds: { type: [String], default: undefined },
    // Explicit provenance for separating pre-judge gates, Judge output, and timers.
    decisionStage: { type: String },
    routeReason: { type: String },
    outcome: { type: String },
    silenceReason: { type: String },
    promptKey: { type: String },
    promptVersion: { type: String },
    promptHash: { type: String },
    // Which turn-killing checks were switched off when this row was written.
    // Empty on every normal run. It is a schema default rather than a field the
    // four create sites each pass, because a comparison transcript that forgot
    // to record its flags reads exactly like an ordinary one — the whole point
    // is that a reader can never mistake the two.
    disabledGuards: { type: [String], default: disabledGuards },
    contextFromSeq: { type: Number },
    contextToSeq: { type: Number },
    floorMs: { type: Number },
    generationSucceeded: { type: Boolean },
    interventionSaved: { type: Boolean },
    broadcastSucceeded: { type: Boolean },
    mediationLatched: { type: Boolean },
    mediationEvidence: { type: [String], default: undefined },
    buildOnsSinceMediation: { type: Number },
    mediationTrigger: {
      type: String,
      enum: ["evidence_latch", "cadence_after_two_build_ons"],
    },
    outputScopeCandidate: { type: String },
    outputScopeRepaired: { type: Boolean },
    outputScopeViolation: { type: String },
    outputGuard: { type: outputGuardSchema, default: undefined },
    // [Issue 25] What the delivered message actually put on the board, written
    // after the bounded verifier has settled the near matches. `outputGuard
    // .traitIds` is the pre-broadcast evidence the guard decided on and cannot
    // be more than that; these two disagree whenever a near match turns out to
    // be real, and until now only the first was recorded.
    surfacedTraitIds: { type: [String], default: undefined },
    // The bound the delivered message broke, measured against `surfacedTraitIds`
    // and recorded only. A pre-broadcast `outputGuard.violation` cost the turn;
    // this one did not, because the message was already out.
    postBroadcastViolation: { type: String },
    candidateList: { type: candidateListSchema, default: undefined },
    // The candidates the last stretch of human messages named, absent while the
    // group still has the whole field in view. Recorded so a completed session
    // can be re-read against a different window (`interventionJudge`).
    narrowedCandidates: { type: [String], default: undefined },
    // Internal subject-control audit. These fields are never included in the visible message.
    focusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    focusBasis: { type: String },
    focusHumanConfirmedCount: { type: Number },
    focusDepthThreshold: { type: Number },
    focusDirective: { type: String, enum: ["stay", "free"] },
    focusGuarded: { type: Boolean },
    internalMetadataRepaired: { type: Boolean },
    internalMetadataViolation: { type: String },
    // [RequestIntent] anchor 인간 발화의 요청 분류 — scope block/guard/cue 주입의 단일 근거.
    requestIntentKind: { type: String },
    requestIntentSource: { type: String },
    // Diagnostic output audit. It may record a hard repair or accepted soft signals.
    repairAudit: { type: outputRepairAuditSchema, default: undefined },

    //API 호출 실패 시 에러 메시지
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

//인덱스
aiInterventionSchema.index({ sessionId: 1, turnIndex: 1 });
export const AIIntervention = mongoose.model("AIIntervention", aiInterventionSchema);
