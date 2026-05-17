//AIIntervention 모델 - AI 평가 로그
//AI가 평가할 때마다 1행 -  "speak"/"stay_silent"
//previous_response_id로 컨텍스트 관리

import mongoose from "mongoose";
import type { AIDecision } from "../types.js";

const aiInterventionSchema = new mongoose.Schema(
  {
    //어느 세션
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    //평가가 일어난 시점의 메시지 순번
    turnIndex: { type: Number, required: true },

    //평가 트리거 사유 (네이티브 언어 사용)
    triggerReason: { type: String, required: true },

    //판단 결과
    decision: { type: String, enum: ["speak", "stay_silent"] as AIDecision[], required: true },

    //speak일 때만 - 생성된 message와 연결
    generateMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },

    //OpenAI Responses API 응답 ID
    responseID: { type: String },

    //호출에 사용한 모델명 (예: "gpt-5.5")
    model: { type: String },

    //디버깅/분석용 - 프롬프트 원문, 응답 원문
    prompt: { type: String },
    response: { type: String },

    //메타 - 토큰 수, 지연시간(ms)
    inputTokens: { type: Number },
    outputTokens: { type: Number },
    latencyMs: { type: Number },

    //API 호출 실패 시 에러 메시지
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

//인덱스
aiInterventionSchema.index({ sessionId: 1, turnIndex: 1 });
export const AIIntervention = mongoose.model("AIIntervention", aiInterventionSchema);
