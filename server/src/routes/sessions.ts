//Admin API - Session CRUD
//
//Endpoints:
//  POST   /api/sessions          세션 생성 (condition + isTest 받아서)
//  GET    /api/sessions          목록
//  GET    /api/sessions/:code    단건 + 참가자
//  DELETE /api/sessions/:code    cascade 삭제 (Participant + Message + AIIntervention)
//
//인증: x-admin-token 헤더 필수

import { Router } from "express";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import { Message } from "../models/Message.js";
import { AIIntervention } from "../models/AIIntervention.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import {
  generateNextSeq,
  buildSessionCode,
  buildParticipantCode,
  getParticipantSlots,
} from "../lib/codeGen.js";
import type { ConditionCode } from "../types.js";

export const sessionsRouter = Router();

//admin 인증
sessionsRouter.use(requireAdmin);

const VALID_CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

//---POST /api/sessions: 세션 생성---
//body: { conditionCode: "C1"|..., isTest?: boolean }
//isTest 기본값 true (안전한 기본값 — 실수로 실험 번호 발급 방지)
sessionsRouter.post("/", async (req, res) => {
  try {
    const { conditionCode, isTest = true } = req.body as {
      conditionCode?: string;
      isTest?: boolean;
    };

    if (!conditionCode || !VALID_CONDITIONS.includes(conditionCode as ConditionCode)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid conditionCode. Use one of: ${VALID_CONDITIONS.join(", ")}`,
      });
    }

    const cond = conditionCode as ConditionCode;

    //1. seq 생성 (T-/S- prefix별 독립 카운터)
    const seq = await generateNextSeq(cond, isTest);

    //2. session 생성
    const sessionCode = buildSessionCode(cond, seq, isTest);
    const session = await Session.create({
      sessionCode,
      conditionCode: cond,
      aiProfile: cond === "CTRL" ? null : "Z",
      status: "waiting",
    });

    //3. participant 생성 (CTRL은 3명, 그 외는 2명)
    const slots = getParticipantSlots(cond);
    const participants = await Participant.insertMany(
      slots.map((s) => ({
        sessionId: session._id,
        participantCode: buildParticipantCode(s.role, cond, seq, isTest),
        role: s.role,
        assignedProfile: s.profile,
      })),
    );

    res.json({
      ok: true,
      isTest,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        createdAt: session.get("createdAt"),
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
      })),
    });
  } catch (error) {
    console.error("[POST /api/sessions]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---GET /api/sessions: 목록---
sessionsRouter.get("/", async (_req, res) => {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 }).lean();

    //각 세션별 참가자 수 집계 (가볍게)
    const sessionsWithCount = await Promise.all(
      sessions.map(async (s) => {
        const participantCount = await Participant.countDocuments({ sessionId: s._id });
        return {
          sessionCode: s.sessionCode,
          conditionCode: s.conditionCode,
          status: s.status,
          isTest: s.sessionCode.startsWith("T-"),
          participantCount,
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          createdAt: s.createdAt,
        };
      }),
    );

    res.json({ ok: true, sessions: sessionsWithCount });
  } catch (error) {
    console.error("[GET /api/sessions]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---GET /api/sessions/:code: 단건 + 참가자---
sessionsRouter.get("/:code", async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participants = await Participant.find({ sessionId: session._id })
      .sort({ assignedProfile: 1 })
      .lean();

    res.json({
      ok: true,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        isTest: session.sessionCode.startsWith("T-"),
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
        connectedAt: p.connectedAt,
        lastSeenAt: p.lastSeenAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/sessions/:code]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---DELETE /api/sessions/:code: cascade 삭제---
//단순 모드: 모든 상태 삭제 가능 (실험 데이터 보호 정책은 운영자가 직접)
sessionsRouter.delete("/:code", async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    //cascade: Participant + Message + AIIntervention + Session
    const [pDel, mDel, aiDel] = await Promise.all([
      Participant.deleteMany({ sessionId: session._id }),
      Message.deleteMany({ sessionId: session._id }),
      AIIntervention.deleteMany({ sessionId: session._id }),
    ]);
    await session.deleteOne();

    res.json({
      ok: true,
      deleted: {
        sessionCode: req.params.code,
        participants: pDel.deletedCount,
        messages: mDel.deletedCount,
        aiInterventions: aiDel.deletedCount,
      },
    });
  } catch (error) {
    console.error("[DELETE /api/sessions/:code]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});
