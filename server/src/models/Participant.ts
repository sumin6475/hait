//Participant 모델 - 세션 참가자 1명

import mongoose from "mongoose";
import type { ParticipantRole, ProfileSlot, Candidate } from "../types.js";

//설문 응답 - Qultric 으로 진행할 경우 수정필요
const demographicsSchema = new mongoose.Schema(
  {
    age: Number,
    gender: String,
    major: String,
  },
  { _id: false },
);
//토의 전 회상 검사 — 학습 직후 각 후보 속성 자유서술 (4개 모두 필수)
const recallTestSchema = new mongoose.Schema(
  { A: String, B: String, C: String, D: String },
  { _id: false },
);
//진행 상태 - 재접속 분기용 5개 step
const progressSchema = new mongoose.Schema(
  {
    consent: { type: Boolean, default: false },
    demographics: { type: Boolean, default: false },
    infoCards: { type: Boolean, default: false },
    preDiscussion: { type: Boolean, default: false },
    waiting: { type: Boolean, default: false },
    teamDecision: { type: Boolean, default: false },
    postSurvey: { type: Boolean, default: false },
    debrief: { type: Boolean, default: false },
    complete: { type: Boolean, default: false },
  },
  { _id: false },
);

//게이트별 도착 시각 (Step 32) — Session.gateApprovals와 공용 모양. progress와 분리:
//progress는 "단계 완료" 의미론, 도착은 hold 화면 진입 시점 (G1·G5는 대응 progress flag 없음)
const gateDatesSchema = new mongoose.Schema(
  { consent: Date, demographics: Date, infoCards: Date, waiting: Date, teamDecision: Date, debrief: Date },
  { _id: false },
);

const participantSchema = new mongoose.Schema(
  {
    //참가자 코드 - unique
    participantCode: { type: String, required: true, index: true, unique: true },

    //어느 세션에 속하는가
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    //세션 내 역할
    role: {
      type: String,
      enum: ["humanX", "humanY", "humanZ"] as ParticipantRole[],
      required: true,
    },

    //이 참가자에게 배정된 정보셋
    assignedProfile: {
      type: String,
      enum: ["X", "Y", "Z"] as ProfileSlot[],
      required: true,
    },

    //토의 전 개인 선택
    preDiscussionChoice: {
      type: String,
      enum: ["A", "B", "C", "D"] as Candidate[],
    },

    //토의 전 회상 검사 (recall test) — 학습 내용 기반 각 후보 속성 자유서술
    recallTest: { type: recallTestSchema, default: undefined },

    //팀 결정 (최종 의견)
    teamDecisionChoice: { type: String, enum: ["A", "B", "C", "D"] as Candidate[] },

    //인구통계 - Qultric 으로 진행할 경우 수정필요
    demographics: demographicsSchema,

    //진행 단계 - 각 step 완료 시 true
    progress: { type: progressSchema, default: () => ({}) },

    //게이트 도착 — Hold 화면 마운트 시각 (Step 32, 대시보드 "n/m 도착" 표시용)
    gateArrivals: { type: gateDatesSchema, default: () => ({}) },

    //접속/종료 시점
    connectedAt: Date,
    lastSeenAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const Participant = mongoose.model("Participant", participantSchema);
