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
import type { ConditionCode, Candidate } from "../types.js";
import { STATUS_CODES } from "http";

export const sessionsRouter = Router();

const VALID_CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

//---POST /api/sessions: 세션 생성---
//body: { conditionCode: "C1"|..., isTest?: boolean }
//isTest 기본값 true (안전한 기본값 — 실수로 실험 번호 발급 방지)
sessionsRouter.post("/", requireAdmin, async (req, res) => {
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
sessionsRouter.get("/", requireAdmin, async (_req, res) => {
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
sessionsRouter.get("/:code", requireAdmin, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participants = await Participant.find({ sessionId: session._id })
      .sort({ assignedProfile: 1 })
      .lean();

    const messages = await Message.find({ sessionId: session._id }).sort({ seq: 1 }).lean();

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
      messages: messages.map((m) => ({
        seq: m.seq,
        sender: m.sender,
        senderRole: m.senderRole,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/sessions/:code]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---DELETE /api/sessions/:code: cascade 삭제---
//단순 모드: 모든 상태 삭제 가능 (실험 데이터 보호 정책은 운영자가 직접)
sessionsRouter.delete("/:code", requireAdmin, async (req, res) => {
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

//---PATCH /api/sessions/:code/team-decision: 팀 결정---
//body: { teamDecision: "A" | "B" | "C" | "D" }
sessionsRouter.patch("/:code/team-decision", async (req, res) => {
  try {
    const { code } = req.params;
    const { participantCode, decision } = req.body as {
      participantCode?: string;
      decision?: string;
    };
    if (!participantCode) {
      return res.status(400).json({ ok: false, error: "participantCode is required" });
    }
    if (!decision || !["A", "B", "C", "D"].includes(decision)) {
      return res.status(400).json({ ok: false, error: "Invalid team decision (must be A/B/C/D)" });
    }

    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    //status 가드 : in_progress 또는 completed 상태만 허용
    if (session.status !== "in_progress") {
      return res.status(400).json({
        ok: false,
        error: `Cannot submit team-decision in status="${session.status}"`,
      });
    }

    //참가자 조회 + 중복 제출 방지
    const participant = await Participant.findOne({ sessionId: session._id, participantCode });
    if (!participant) {
      return res.status(404).json({ ok: false, error: "Participant not found" });
    }
    if (participant.teamDecisionChoice) {
      return res.status(409).json({ ok: false, error: "Team decision already submitted" });
    }

    //1.해당 참가자의 개인 응답 저장
    participant.teamDecisionChoice = decision as Candidate;
    await participant.save();

    //2.Session.teamDecision 배열에 append
    session.teamDecision = [...(session.teamDecision ?? []), decision as Candidate];

    //3. 전원 제출 완료 시에만 completed 전환
    const expected = session.conditionCode === "CTRL" ? 3 : 2;
    const submittedCount = session.teamDecision.length;

    let transitioned = false;
    if (submittedCount >= expected) {
      session.status = "completed";
      session.endedAt = new Date();
      transitioned = true;
    }
    await session.save();

    if (transitioned) {
      console.log(
        `[sessions] ${code} status: in_progress -> completed (all ${expected} submitted)`,
      );
    }

    res.json({
      ok: true,
      sessionCode: session.sessionCode,
      teamDecision: session.teamDecision,
      status: session.status,
      submittedCount,
      expected,
    });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/team-decision]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---PATCH /api/participants/:code/finalize ---
//PostSurvey + Debrief 완료 시 호출
//status: completed -> data_ready
sessionsRouter.patch("/:code/finalize", async (req, res) => {
  try {
    const { code } = req.params;
    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    //이미 data_ready면 그대로 반환
    if (session.status === "data_ready") {
      return res.json({
        ok: true,
        sessionCode: session.sessionCode,
        status: session.status,
      });
    }

    //status 가드 : completed 상태만 허용
    if (session.status !== "completed") {
      return res.status(409).json({
        ok: false,
        error: `Cannot finalize in status="${session.status}"`,
      });
    }

    session.status = "data_ready";
    await session.save();

    res.json({
      ok: true,
      sessionCode: session.sessionCode,
      status: session.status,
    });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/finalize]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});
