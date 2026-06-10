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
    positiveRevealed: { type: Number, default: 0 }, // positive 정보 중 공유된 수 (미사용 — revealedIds에서 read 시 파생)
    negativeRevealed: { type: Number, default: 0 }, // negative 정보 중 공유된 수 (미사용 — revealedIds에서 read 시 파생)
    revealedIds: { type: [String], default: [] }, // 표면화된 trait id 집합 (Step 14a, $addToSet로 dedup)
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

    //시작/종료 시간
    startedAt: Date,
    endedAt: Date,

    //팀 결정 (최종 의견)
    teamDecision: { type: [String], enum: ["A", "B", "C", "D"] as Candidate[], default: [] },

    seqCounter: { type: Number, default: 0 }, // 메시지 seq 원자 발급용 단조 카운터 (Step 18)

    //캐시된 통계 — default로 byCandidate 경로를 처음부터 보장 ($addToSet 대상 경로, Step 14a)
    revealStats: {
      type: revealStatsSchema,
      default: () => ({ byCandidate: { A: {}, B: {}, C: {}, D: {} } }),
    },

    //메타 데이터
    metadata: metadataSchema,
  },
  { timestamps: true },
);

export const Session = mongoose.model("Session", sessionSchema);
