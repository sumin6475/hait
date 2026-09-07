//Session - 실험 세션 1개
//모든 컬렉션이 sessionId로 이 도큐먼트 참조
//
//revealStats - 캐시된 카운터
//메시지 저장 시마다 업데이트. AI가 매번 aggregate 없이 1회 조회로 현황 파악

import mongoose from "mongoose";
import type { ConditionCode, SessionStatus, ProfileSlot, Candidate } from "../types.js";

//프로필별 shared 통계
const profileStatsSchema = new mongoose.Schema(
  {
    uniqueRevealed: { type: Number, default: 0 }, // unshared 정보 중 공유된 수
    totalUnique: { type: Number, default: 0 }, // unshared 정보 총 수
    sharedRevealed: { type: Number, default: 0 }, // shared 정보 중 공유된 수
    totalShared: { type: Number, default: 0 }, // shared 정보 총 수
  },
  { _id: false },
);

//후보별 공유 통계
const candidateStatsSchema = new mongoose.Schema(
  {
    // Legacy cached counters are no longer written; readers derive counts from revealedIds.
    positiveRevealed: { type: Number, default: 0 },
    negativeRevealed: { type: Number, default: 0 },
    revealedIds: { type: [String], default: [] }, // 표면화된 trait id 집합 (Step 14a, $addToSet로 dedup)
  },
  { _id: false },
);

// [Step 62] 각 trait를 누가 '처음' 테이블에 올렸는가. 재진술과 기여를 사후에 가르기 위한 기록.
// key = traitId, value = { by, seq }. 기존 집합 필드(byCandidate.revealedIds · aiSurfacedIds)는 불변.
const firstBySchema = new mongoose.Schema(
  {
    by: { type: String, enum: ["human", "ai"], required: true },
    seq: { type: Number, required: true },
  },
  { _id: false },
);

const revealStatsSchema = new mongoose.Schema(
  {
    byProfile: {
      X: profileStatsSchema,
      Y: profileStatsSchema,
      Z: profileStatsSchema,
    },
    byCandidate: {
      A: candidateStatsSchema,
      B: candidateStatsSchema,
      C: candidateStatsSchema,
      D: candidateStatsSchema,
    },
    aiSurfacedIds: { type: [String], default: [] }, // Alex가 표면화한 trait id (Z DV용, $addToSet dedup) — Step 19
    // Human-grounded discussion state is separate from both human and AI surface events.
    // Existing byCandidate.revealedIds remains the human-surfaced source for export compatibility.
    humanConfirmedIds: { type: [String], default: [] },
    lastHumanDiscussion: {
      candidate: { type: String, enum: ["A", "B", "C", "D"] as Candidate[] },
      seq: Number,
    },
    firstBy: { type: Map, of: firstBySchema, default: undefined }, // [Step 62]
  },
  { _id: false },
);

//게이트별 타임스탬프 (Step 32) — Session.gateApprovals / Participant.gateArrivals 공용 모양
const gateDatesSchema = new mongoose.Schema(
  {
    consent: Date,
    demographics: Date,
    infoCards: Date,
    waiting: Date,
    teamDecision: Date,
    debrief: Date,
  },
  { _id: false },
);

//세션 메타 (요약 통계)
const metadataSchema = new mongoose.Schema(
  {
    totalTurns: { type: Number, default: 0 },
    humanTurns: { type: Number, default: 0 },
    aiTurns: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const aiStateSchema = new mongoose.Schema(
  {
    lifecycle: { type: String, enum: ["active", "closing", "muted"], default: "active" },
    closingReason: { type: String },
    closingAt: { type: Date },
    summaryStatus: {
      type: String,
      enum: ["not_eligible", "pending", "generating", "done"],
      default: "not_eligible",
    },
    summaryEligibleAt: { type: Date },
    summaryMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    // [LOW-5] closing 발화가 실제로 저장된 Message id — 재시작 시 이중 closing 감지용.
    // AIIntervention 로그 기록 실패와 무관하게 closing 완료 여부를 판단하는 별도 경로.
    closingMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    mediationLatched: { type: Boolean, default: false },
    mediationEvidence: { type: [String], default: [] },
    mediationLatchedAt: { type: Date },
    mediationLatchedHumanCount: { type: Number },
    buildOnsSinceMediation: { type: Number, default: 0 },
    buildOnFocusCandidate: { type: String, enum: ["A", "B", "C", "D"] },
    lastBackchannelAt: { type: Date },
    longSilenceBroadcastCount: { type: Number, default: 0 },
    lastLongSilenceAt: { type: Date },
    // Incremented atomically with every human sequence allocation. A running
    // generation records the epoch it started from; later human turns are
    // coalesced and re-evaluated after that generation finishes.
    conversationEpoch: { type: Number, default: 0 },
    // Highest human epoch whose explicit Alex/group interaction obligation was
    // fulfilled by a successfully broadcast address/followup turn.
    interactionServedThroughEpoch: { type: Number, default: 0 },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    //어드민이 발급하는 세션 코드
    sessionCode: { type: String, required: true, unique: true, index: true },

    //실험 조건
    conditionCode: {
      type: String,
      enum: ["C1", "C2", "C3", "C4", "CTRL"] as ConditionCode[],
      required: true,
      index: true,
    },

    //AI가 받는 정보셋 - C1~C4는 "Z", CTRL은 null
    aiProfile: { type: String, enum: ["X", "Y", "Z", null] as ProfileSlot[], default: null },

    //세션 상태
    status: {
      type: String,
      enum: ["waiting", "in_progress", "completed", "data_ready"] as SessionStatus[],
      default: "waiting",
      index: true,
    },

    // [KO-PILOT] 파일럿 한국어 채팅 토글 — 기본 en(영어 세션 무영향)
    language: { type: String, enum: ["en", "ko"], default: "en" },

    //시작/종료 시간
    startedAt: Date,
    endedAt: Date,

    //팀 결정 (최종 의견)
    teamDecision: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[], default: [] },

    seqCounter: { type: Number, default: 0 }, // 메시지 seq 원자 발급용 단조 카운터 (Step 18)

    //연구자 승인 게이트 — gateId → 승인 시각 (Step 32). 미존재 = 미승인 (기존 도큐먼트 마이그레이션 불필요)
    gateApprovals: { type: gateDatesSchema, default: () => ({}) },

    //팀 결정 정답성 (완료 시 1회 계산, Step 20)
    decisionAccuracy: {
      optimal: { type: String }, // "C"
      teamChoice: { type: String }, // 만장일치면 그 값, 불일치면 최빈값(동률이면 null)
      correct: { type: Boolean }, // teamChoice === optimal
      unanimous: { type: Boolean }, // teamDecision 전원 동일
    },

    //캐시된 통계 — default로 byCandidate 경로를 처음부터 보장 ($addToSet 대상 경로, Step 14a)
    revealStats: {
      type: revealStatsSchema,
      default: () => ({ byCandidate: { A: {}, B: {}, C: {}, D: {} } }),
    },

    //메타 데이터
    metadata: metadataSchema,

    // Short 2–3 second reservations stay in memory; durable lifecycle state survives restarts.
    aiState: { type: aiStateSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const Session = mongoose.model("Session", sessionSchema);
