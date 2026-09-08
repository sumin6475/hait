//Message 모델 - 채팅 1건 데이터
//SharedInfoIds로 어떤 InfoItem이 공유됐는지 태깅

import mongoose from "mongoose";
import type { SenderRole } from "../types.js";

const messageSchema = new mongoose.Schema(
  {
    //어느 세션
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },

    //발신자 표시명 (UI용)
    sender: { type: String, required: true },

    //발신자 역할
    senderRole: {
      type: String,
      enum: ["humanX", "humanY", "humanZ", "ai"] as SenderRole[],
      required: true,
    },

    //메시지 본문
    content: { type: String, required: true },

    //서버 부여 시퀀스 번호 - 서버 시계 사용
    //1씩 증가
    seq: { type: Number, required: true },

    //이 메시지가 공유한 InfoItem.itemId
    sharedInfoIds: [{ type: String }],
    // [Issue 15] Trait ids the deterministic matcher found and the bounded
    // verifier then declined. Without this a declined candidate is silent and
    // terminal: T-C2-045 lost two traits that way, and the only way to learn it
    // had happened was to re-run the matcher over an export by hand. Pool
    // identifiers only — no message content, as everywhere else.
    declinedTraitIds: { type: [String], default: undefined },
  },
  { timestamps: true },
);

//인덱스
messageSchema.index({ sessionId: 1, seq: 1 });

export const Message = mongoose.model("Message", messageSchema);
