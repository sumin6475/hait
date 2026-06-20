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
import { computePoolingDV, computeDecisionAccuracy } from "../lib/poolingDV.js";
import { stopPullEvalution, forceMuteAI } from "../sockets/index.js"; // [Step 31-⑦] 라우트→sockets 단방향 (순환 없음)
import { GATE_ORDER, type ConditionCode, type Candidate, type GateId } from "../types.js";
import { STATUS_CODES } from "http";

export const sessionsRouter = Router();

const VALID_CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

//---POST /api/sessions: 세션 생성---
//body: { conditionCode: "C1"|..., isTest?: boolean }
//isTest 기본값 true (안전한 기본값 — 실수로 실험 번호 발급 방지)
sessionsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const { conditionCode, isTest = true, language = "en" } = req.body as {
      conditionCode?: string;
      isTest?: boolean;
      language?: "en" | "ko"; // [KO-PILOT]
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
      language: language === "ko" ? "ko" : "en", // [KO-PILOT] 화이트리스트 — ko만 ko, 그 외 en
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

    //각 세션별 참가자 수 + 게이트 도착 집계 (Step 32 — 쿼리 수는 countDocuments 시절과 동일)
    const sessionsWithCount = await Promise.all(
      sessions.map(async (s) => {
        const parts = await Participant.find({ sessionId: s._id }).select("gateArrivals").lean();
        return {
          sessionCode: s.sessionCode,
          conditionCode: s.conditionCode,
          status: s.status,
          isTest: s.sessionCode.startsWith("T-"),
          participantCount: parts.length,
          gates: {
            approvals: s.gateApprovals ?? {},
            arrivals: Object.fromEntries(
              GATE_ORDER.map((g) => [g, parts.filter((p) => p.gateArrivals?.[g]).length]),
            ),
          },
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
        language: (session as any).language ?? "en", // [KO-PILOT] 발급 확인용
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

//---GET /api/sessions/:code/export: 런 전체 덤프 (메시지 + AI 개입 결정)---
//Test Harness 다운로드용. 대화 품질 분석을 위해 AI가 매 턴 왜 말했/침묵했는지(why)까지 포함.
sessionsRouter.get("/:code/export", requireAdmin, async (req, res) => {
  try {
    const session = await Session.findOne({ sessionCode: req.params.code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participants = await Participant.find({ sessionId: session._id })
      .sort({ assignedProfile: 1 })
      .lean();
    const messages = await Message.find({ sessionId: session._id }).sort({ seq: 1 }).lean();
    const interventions = await AIIntervention.find({ sessionId: session._id })
      .sort({ turnIndex: 1, createdAt: 1 })
      .lean();

    res.json({
      ok: true,
      session: {
        sessionCode: session.sessionCode,
        conditionCode: session.conditionCode,
        status: session.status,
        isTest: session.sessionCode.startsWith("T-"),
        language: (session as any).language ?? "en",
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        createdAt: session.createdAt,
      },
      participants: participants.map((p) => ({
        participantCode: p.participantCode,
        role: p.role,
        assignedProfile: p.assignedProfile,
      })),
      messages: messages.map((m) => ({
        seq: m.seq,
        sender: m.sender,
        senderRole: m.senderRole,
        content: m.content,
        createdAt: m.createdAt,
      })),
      interventions: interventions.map((i) => ({
        turnIndex: i.turnIndex,
        decision: i.decision,
        triggerReason: i.triggerReason,
        cue: i.cue,
        why: i.why,
        calloutTarget: i.calloutTarget,
        calloutCand: i.calloutCand,
        model: i.model,
        latencyMs: i.latencyMs,
        inputTokens: i.inputTokens,
        outputTokens: i.outputTokens,
        error: i.error,
        createdAt: (i as any).createdAt,
      })),
    });
  } catch (error) {
    console.error("[GET /api/sessions/:code/export]", error);
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

//---PATCH /api/sessions/:code/gates/:gate/approve: 게이트 승인 (Step 32)---
//연구자가 대시보드에서 클릭 — 참가자 Hold 화면 폴링이 2.5초 내 감지해 다음 단계로 전환.
//status 가드 없음 (연구자 escape hatch — 전원 도착 규칙은 UI가 담당)
sessionsRouter.patch("/:code/gates/:gate/approve", requireAdmin, async (req, res) => {
  try {
    const { code, gate } = req.params;
    if (!GATE_ORDER.includes(gate as GateId)) {
      return res.status(400).json({
        ok: false,
        error: `Invalid gate. Use one of: ${GATE_ORDER.join(", ")}`,
      });
    }

    const session = await Session.findOne({ sessionCode: code }).lean();
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    //이미 승인 → 그대로 ok (멱등 — 더블클릭/동시요청 안전)
    if (session.gateApprovals?.[gate as GateId]) {
      return res.json({ ok: true, approvals: session.gateApprovals });
    }

    const updated = await Session.findOneAndUpdate(
      { sessionCode: code },
      { $set: { [`gateApprovals.${gate}`]: new Date() } },
      { returnDocument: "after", lean: true },
    );
    console.log(`[approve-gate] ${gate} approved for ${code}`);
    res.json({ ok: true, approvals: updated?.gateApprovals ?? {} });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/gates/:gate/approve]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

//---POST /api/sessions/:code/stop-ai: 연구자 킬스위치 (Alex 음소거)---
//연구자가 대시보드 버튼으로 특정 세션의 Alex를 영구 음소거. 사람·채팅·타이머는 그대로.
//토론을 끝내거나 team-decision으로 넘기지 않음(그건 Exit 버튼). status 가드 없음 — escape hatch.
sessionsRouter.post("/:code/stop-ai", requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;
    const session = await Session.findOne({ sessionCode: code });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }
    forceMuteAI(session.sessionCode); // [Step 31-⑦] 패턴: 모델의 sessionCode(string) 전달
    console.log(`[stop-ai] AI muted by researcher for ${session.sessionCode}`);
    res.json({ ok: true, sessionCode: session.sessionCode, muted: true });
  } catch (error) {
    console.error("[POST /api/sessions/:code/stop-ai]", error);
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
      // Step 19: 완료 시점 pooling DV 스냅샷 (분석 편의 — 원천 집합 revealedIds/aiSurfacedIds는 그대로 보존).
      // fresh read로 async 추출이 적재한 최신 집합을 반영. save()는 수정된 path만 쓰므로
      // byCandidate/aiSurfacedIds에 대한 동시 $addToSet을 덮어쓰지 않는다.
      const fresh = await Session.findById(session._id).select("revealStats").lean();
      session.set("revealStats.byProfile", computePoolingDV((fresh as any)?.revealStats));
      // Step 20: Decision Accuracy (팀이 정답 C를 골랐나)
      session.set("decisionAccuracy", computeDecisionAccuracy(session.teamDecision ?? []));
      transitioned = true;
    }
    await session.save();

    if (transitioned) {
      console.log(
        `[sessions] ${code} status: in_progress -> completed (all ${expected} submitted)`,
      );
      stopPullEvalution(session.sessionCode); // [Step 31-⑦] 5초 틱 정지 — 빈 방 long-silence 유령 발화 차단
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
