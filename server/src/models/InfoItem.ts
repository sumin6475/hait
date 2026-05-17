//InfoItem 모델 - 정보 카드

import mongoose from "mongoose";
import type { ProfileSlot, Candidate, Valence } from "../types.js";

const infoItemSchema = new mongoose.Schema(
  {
    //식별자
    itemId: { type: String, required: true, unique: true, index: true },

    //어느 프로필에 속하는가
    profile: {
      type: String,
      enum: ["X", "Y", "Z"] as ProfileSlot[],
      required: true,
      index: true,
    },
    //어느 후보에 대한 정보인가
    candidate: {
      type: String,
      enum: ["A", "B", "C", "D"] as Candidate[],
      required: true,
    },
    //실제 문구
    attribute: { type: String, required: true },
    //긍정/부정
    valence: {
      type: String,
      enum: ["positive", "negative"] as Valence[],
      required: true,
    },
    //shared vs. unshared
    //실험 중 노출주의 - API 응답에서 제거
    isShared: { type: Boolean, required: true },
  },
  { timestamps: true },
);

//인덱스
infoItemSchema.index({ profile: 1, candidate: 1 });

export const InfoItem = mongoose.model("InfoItem", infoItemSchema);
