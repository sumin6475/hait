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

    //팀 결정 (최종 의견)
    teamDecisionChoice: { type: String, enum: ["A", "B", "C", "D"] as Candidate[] },

    //인구통계 - Qultric 으로 진행할 경우 수정필요
    demographics: demographicsSchema,

    //진행 단계 - 각 step 완료 시 true
    progress: { type: progressSchema, default: () => ({}) },

    //접속/종료 시점
    connectedAt: Date,
    lastSeenAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

export const Participant = mongoose.model("Participant", participantSchema);
