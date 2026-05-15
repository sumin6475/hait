//Condition 모델 - 실험 조건 정의 (C1~C4, CTRL)
//총 5개 도큐먼트, 어드민 대시보드에서 시스템 프롬프트/스크립트 편집 

import mongoose from 'mongoose';
import type {ConditionCode, AIStatus, CommStrategy} from '../types.js';
import { resourceUsage } from 'node:process';

//리더 스크립트 (조건에 따라 optional)
const leaderScriptsSchema = new mongoose.Schema({
    opening: String,
    transition: String,
    midCheck: String,
    turnAssignment: String,
    finalPrompt: String,
},{_id: false});

const conditionSchema = new mongoose.Schema({
    //조건 식별자
    code: {
        type: String,
        enum: ["C1", "C2", "C3", "C4", "CTRL"] as ConditionCode[],
        required: true, 
        unique: true,
        index: true,
    },

    //AI 지위 - leader / peer
    //CTRL은 AI없으므로 requried 제외
    status: {
        type: String,
        enum: ["leader", "peer"] as AIStatus[],
    },

    //AI 커뮤니케이션 전략
    strategy: {
        type: String,
        enum: ["xai", "aci"] as CommStrategy[],
    },

    //시스템 프롬프트 (대시보드 편집)
    systemPrompt: {type: String, default: ""},

    //리더 조건일 떄만 사용
    leaderScritps: leaderScriptsSchema,
},{timestamps: true});

export const Condition = mongoose.model('Condition', conditionSchema);