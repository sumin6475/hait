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
import { ConversationObservation } from "../models/ConversationObservation.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import {
  generateNextSeq,
  buildSessionCode,
  buildParticipantCode,
  getParticipantSlots,
} from "../lib/codeGen.js";
import { computePoolingDV, computeDecisionAccuracy } from "../lib/poolingDV.js";
import { closeInterventionSession, stopInterventionSession } from "../lib/interventionEngine.js";
import { GATE_ORDER, type ConditionCode, type Candidate, type GateId } from "../types.js";
import { STATUS_CODES } from "http";

export const sessionsRouter = Router();

const VALID_CONDITIONS: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

//---POST /api/sessions: 세션 생성---
//body: { conditionCode: "C1"|..., isTest?: boolean }
//isTest 기본값 true (안전한 기본값 — 실수로 실험 번호 발급 방지)
sessionsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const {
      conditionCode,
      isTest = true,
      language = "en",
    } = req.body as {
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
        aiState: (session as any).aiState ?? null,
        // The board itself. Without it a session's trait figures can only be
        // re-derived by hand from the transcript, and the one answer that is
        // computed rather than written — the match/miss count Alex gives when
        // asked — cannot be checked at all. T-C4-022 and T-C4-023 both recorded
        // this gap; it is the state the count is read from.
        revealStats: (session as any).revealStats ?? null,
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
    const [interventions, conversationObservations] = await Promise.all([
      AIIntervention.find({ sessionId: session._id }).sort({ turnIndex: 1, createdAt: 1 }).lean(),
      ConversationObservation.find({ sessionId: session._id }).sort({ anchorSeq: 1 }).lean(),
    ]);

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
        aiState: (session as any).aiState ?? null,
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
        // What this message actually put on the board, and what it declined to.
        // Information release is the dependent variable, and until now it could
        // not be counted from the export — every trait figure in
        // `docs/measurements.md` was read straight out of the database instead.
        sharedInfoIds: m.sharedInfoIds,
        declinedTraitIds: (m as any).declinedTraitIds,
      })),
      interventions: interventions.map((i) => ({
        // Field list checked against the schema by `test:intervention-v2`. A new
        // field is either named here or named in that test's not-exported list;
        // it cannot be added and silently left out of the export, which is how
        // `owedRequestIds`, `outputGuard` and `candidateList` came to be written
        // by the server and invisible to every analysis that reads the export.
        turnIndex: i.turnIndex,
        decision: i.decision,
        triggerReason: i.triggerReason,
        cue: i.cue,
        why: i.why,
        routeKind: i.routeKind,
        source: i.source,
        reservationId: i.reservationId,
        anchorSeq: i.anchorSeq,
        conversationEpoch: i.conversationEpoch,
        interactionObligationEpoch: i.interactionObligationEpoch,
        postGenerationReevaluation: i.postGenerationReevaluation,
        priorityRoute: i.priorityRoute,
        priorityEvidence: i.priorityEvidence,
        mainJudgeDecision: i.mainJudgeDecision,
        judgeEvidence: i.judgeEvidence,
        communicativeAct: i.communicativeAct,
        judgeEvidenceSeqs: i.judgeEvidenceSeqs,
        controllerMode: i.controllerMode,
        ledgerVersion: i.ledgerVersion,
        ledgerJudgeVersion: i.ledgerJudgeVersion,
        ledgerJudgePromptVersion: i.ledgerJudgePromptVersion,
        ledgerJudgeSchemaVersion: i.ledgerJudgeSchemaVersion,
        ledgerJudgeAttempts: i.ledgerJudgeAttempts,
        selectedOpportunityId: i.selectedOpportunityId,
        selectedOpportunitySourceSeq: i.selectedOpportunitySourceSeq,
        selectedOpportunityThreadId: i.selectedOpportunityThreadId,
        selectedOpportunityKind: i.selectedOpportunityKind,
        selectedOpportunityExpectation: i.selectedOpportunityExpectation,
        selectedOpportunityTargets: i.selectedOpportunityTargets,
        selectedOpportunityRequestedAction: i.selectedOpportunityRequestedAction,
        selectedOpportunityAlexBroadcastSeq: i.selectedOpportunityAlexBroadcastSeq,
        selectedOpportunityTransition: i.selectedOpportunityTransition,
        selectedTraitId: i.selectedTraitId,
        // What the Judge said the turn could put on the board, and the sentence
        // it wrote for the writer. `docs/adr/0010` moves those decisions into a
        // model call, so the export has to carry them or the decision is
        // unauditable after the session.
        discloseTraitIds: i.discloseTraitIds,
        judgeBrief: i.judgeBrief,
        disabledGuards: i.disabledGuards,
        decisionStage: i.decisionStage,
        routeReason: i.routeReason,
        outcome: i.outcome,
        silenceReason: i.silenceReason,
        promptKey: i.promptKey,
        promptVersion: i.promptVersion,
        promptHash: i.promptHash,
        contextFromSeq: i.contextFromSeq,
        contextToSeq: i.contextToSeq,
        floorMs: i.floorMs,
        generationSucceeded: i.generationSucceeded,
        interventionSaved: i.interventionSaved,
        broadcastSucceeded: i.broadcastSucceeded,
        mediationLatched: i.mediationLatched,
        mediationEvidence: i.mediationEvidence,
        buildOnsSinceMediation: i.buildOnsSinceMediation,
        mediationTrigger: i.mediationTrigger,
        focusCandidate: i.focusCandidate,
        focusBasis: i.focusBasis,
        focusHumanConfirmedCount: i.focusHumanConfirmedCount,
        focusDepthThreshold: i.focusDepthThreshold,
        focusDirective: i.focusDirective,
        focusGuarded: i.focusGuarded,
        internalMetadataRepaired: i.internalMetadataRepaired,
        internalMetadataViolation: i.internalMetadataViolation,
        outputScopeCandidate: i.outputScopeCandidate,
        outputScopeRepaired: i.outputScopeRepaired,
        outputScopeViolation: i.outputScopeViolation,
        // What the turn was allowed to say, what the guard decided on, and what
        // the delivered message actually carried. The last two are different
        // questions with different answers — see `docs/adr/` and issue 25.
        outputGuard: i.outputGuard,
        surfacedTraitIds: i.surfacedTraitIds,
        postBroadcastViolation: i.postBroadcastViolation,
        // The board this turn was taken against. Shadow only: nothing reads it
        // at runtime, and it is here so a session can be read against the bar.
        candidateList: i.candidateList,
        narrowedCandidates: i.narrowedCandidates,
        // [Issue 17] What the group was still waiting for when this turn went
        // silent. The largest silence class recorded none of it before.
        owedRequestIds: i.owedRequestIds,
        requestIntentKind: i.requestIntentKind,
        requestIntentSource: i.requestIntentSource,
        repairAudit: i.repairAudit,
        calloutTarget: i.calloutTarget,
        calloutCand: i.calloutCand,
        model: i.model,
        responseId: i.responseId,
        systemFingerprint: i.systemFingerprint,
        latencyMs: i.latencyMs,
        inputTokens: i.inputTokens,
        outputTokens: i.outputTokens,
        error: i.error,
        createdAt: (i as any).createdAt,
      })),
      conversationObservations: conversationObservations.map((observation: any) => ({
        anchorSeq: observation.anchorSeq,
        conversationEpoch: observation.conversationEpoch,
        observerVersion: observation.observerVersion,
        mode: observation.mode,
        participantRoster: observation.participantRoster,
        ledgerVersion: observation.ledgerVersion,
        ledgerDelta: observation.ledgerDelta,
        ledgerTransition: observation.ledgerTransition,
        ledgerStateAfter: observation.ledgerStateAfter,
        observerCallAttempts: observation.observerCallAttempts,
        ledgerJudgeVersion: observation.ledgerJudgeVersion,
        ledgerJudgePromptVersion: observation.ledgerJudgePromptVersion,
        ledgerJudgeSchemaVersion: observation.ledgerJudgeSchemaVersion,
        ledgerJudgeDecision: observation.ledgerJudgeDecision,
        ledgerJudgeAttempts: observation.ledgerJudgeAttempts,
        ledgerJudgeReobserved: observation.ledgerJudgeReobserved,
        ledgerBroadcastTransition: observation.ledgerBroadcastTransition,
        repairCodes: observation.repairCodes,
        conflictCodes: observation.conflictCodes,
        degradedMode: observation.degradedMode,
        addressees: observation.addressees,
        replyToSeq: observation.replyToSeq,
        speechAct: observation.speechAct,
        activeCandidates: observation.activeCandidates,
        mentionedCandidates: observation.mentionedCandidates,
        scopeCandidates: observation.scopeCandidates,
        focusCandidate: observation.focusCandidate,
        focusBasis: observation.focusBasis,
        threadGoal: observation.threadGoal,
        requestedScope: observation.requestedScope,
        requestExplicitness: observation.requestExplicitness,
        transitionState: observation.transitionState,
        relationToPendingAlexQuestion: observation.relationToPendingAlexQuestion,
        expectedHumanResponder: observation.expectedHumanResponder,
        conversationPhase: observation.conversationPhase,
        alexRelation: observation.alexRelation,
        activeThread: observation.activeThread,
        floor: observation.floor,
        fieldConfidence: observation.fieldConfidence,
        observerReviewed: observation.observerReviewed,
        confidence: observation.confidence,
        explicitAlexDefer: observation.explicitAlexDefer,
        explicitAlexDeferEvidence: observation.explicitAlexDeferEvidence,
        pendingQuestionRootSeq: observation.pendingQuestionRootSeq,
        questionThreadAfter: observation.questionThreadAfter,
        stateAfter: observation.stateAfter,
        uptakeJudgeCalled: observation.uptakeJudgeCalled,
        uptakeDecision: observation.uptakeDecision,
        uptakeEvidence: observation.uptakeEvidence,
        uptakeSelectedTraitId: observation.uptakeSelectedTraitId,
        uptakeModel: observation.uptakeModel,
        uptakeResponseId: observation.uptakeResponseId,
        uptakeLatencyMs: observation.uptakeLatencyMs,
        uptakeError: observation.uptakeError,
        followupCandidateEligible: observation.followupCandidateEligible,
        followupJudgeCalled: observation.followupJudgeCalled,
        followupJudgeResult: observation.followupJudgeResult,
        followupWindowMessageCount: observation.followupWindowMessageCount,
        followupWindowSpeakerRole: observation.followupWindowSpeakerRole,
        model: observation.model,
        responseId: observation.responseId,
        latencyMs: observation.latencyMs,
        error: observation.error,
        createdAt: observation.createdAt,
        updatedAt: observation.updatedAt,
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

    //cascade: Participant + Message + AIIntervention + ConversationObservation + Session
    const [pDel, mDel, aiDel, observationDel] = await Promise.all([
      Participant.deleteMany({ sessionId: session._id }),
      Message.deleteMany({ sessionId: session._id }),
      AIIntervention.deleteMany({ sessionId: session._id }),
      ConversationObservation.deleteMany({ sessionId: session._id }),
    ]);
    await session.deleteOne();

    res.json({
      ok: true,
      deleted: {
        sessionCode: req.params.code,
        participants: pDel.deletedCount,
        messages: mDel.deletedCount,
        aiInterventions: aiDel.deletedCount,
        conversationObservations: observationDel.deletedCount,
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
    await closeInterventionSession(session.sessionCode);
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

    //참가자 조회 + 중복 제출 방지 (원자적 claim — 동시 더블클릭 안전)
    //teamDecisionChoice가 아직 없을 때만 설정 성공. 이미 있으면 null → 409.
    //(MongoDB에서 { teamDecisionChoice: null }은 필드 부재/명시적 null 모두 매칭)
    const claimed = await Participant.findOneAndUpdate(
      { sessionId: session._id, participantCode, teamDecisionChoice: null },
      { $set: { teamDecisionChoice: decision as Candidate } },
      { returnDocument: "after" },
    );
    if (!claimed) {
      const exists = await Participant.findOne({ sessionId: session._id, participantCode });
      if (!exists) {
        return res.status(404).json({ ok: false, error: "Participant not found" });
      }
      return res.status(409).json({ ok: false, error: "Team decision already submitted" });
    }

    // [합의 게이트] 이미 제출된 팀 결정이 있으면 일치 여부 확인.
    // 불일치 시 claim을 롤백하고 409 반환 → 참가자는 team-decision 페이지에 머물며 재제출.
    const currentSession = await Session.findOne({ sessionCode: code }).lean();
    if (!currentSession) {
      await Participant.updateOne({ _id: claimed._id }, { $unset: { teamDecisionChoice: 1 } });
      return res.status(500).json({ ok: false, error: "Session disappeared after claim" });
    }
    const existingDecisions = currentSession.teamDecision ?? [];
    if (existingDecisions.length > 0 && existingDecisions[0] !== decision) {
      await Participant.updateOne({ _id: claimed._id }, { $unset: { teamDecisionChoice: 1 } });
      return res.status(409).json({
        ok: false,
        error: "team_decision_mismatch",
        message: "Your team submitted different decisions. Please reach a consensus and resubmit.",
      });
    }

    // [HIGH-1] Session.teamDecision은 read-modify-write가 아니라 원자적 $push로 append.
    // 첫 제출이거나 기존 팀 결정과 같은 값일 때만 append하여, 서로 다른 첫 제출이
    // 동시에 들어오는 경우에도 MongoDB의 단일-document 원자성으로 합의 게이트를 지킨다.
    const updated = await Session.findOneAndUpdate(
      {
        sessionCode: code,
        status: "in_progress",
        $or: [{ teamDecision: { $size: 0 } }, { teamDecision: decision as Candidate }],
      },
      { $push: { teamDecision: decision as Candidate } },
      { returnDocument: "after", lean: true },
    );
    if (!updated) {
      await Participant.updateOne(
        { _id: claimed._id, teamDecisionChoice: decision as Candidate },
        { $unset: { teamDecisionChoice: 1 } },
      );
      const fresh = await Session.findOne({ sessionCode: code }).lean();
      if (!fresh) {
        return res.status(500).json({ ok: false, error: "Session disappeared after claim" });
      }
      if ((fresh.teamDecision ?? []).some((value) => value !== decision)) {
        return res.status(409).json({
          ok: false,
          error: "team_decision_mismatch",
          message:
            "Your team submitted different decisions. Please reach a consensus and resubmit.",
        });
      }
      return res.status(409).json({ ok: false, error: "Team decision already closed" });
    }

    // 전원 제출 완료 시에만 completed 전환 (조건부 업데이트로 1회만 성공)
    const expected = updated.conditionCode === "CTRL" ? 3 : 2;
    const submittedCount = updated.teamDecision.length;

    let transitioned = false;
    let finalStatus: string = updated.status;
    let finalTeamDecision: Candidate[] = updated.teamDecision;
    if (submittedCount >= expected) {
      // Step 19: 완료 시점 pooling DV 스냅샷 (분석 편의 — 원천 집합 revealedIds/aiSurfacedIds는 그대로 보존).
      // fresh read로 async 추출이 적재한 최신 집합을 반영.
      const fresh = await Session.findById(session._id).select("revealStats").lean();
      // Step 20: Decision Accuracy (팀이 정답 C를 골랐나)
      const decisionAccuracy = computeDecisionAccuracy(updated.teamDecision ?? []);
      const completedDoc = await Session.findOneAndUpdate(
        { _id: session._id, status: "in_progress" },
        {
          $set: {
            status: "completed",
            endedAt: new Date(),
            "revealStats.byProfile": computePoolingDV((fresh as any)?.revealStats),
            decisionAccuracy,
          },
        },
        { returnDocument: "after", lean: true },
      );
      if (completedDoc) {
        transitioned = true;
        finalStatus = "completed";
        finalTeamDecision = completedDoc.teamDecision;
      }
    }

    if (transitioned) {
      console.log(
        `[sessions] ${code} status: in_progress -> completed (all ${expected} submitted)`,
      );
      await stopInterventionSession(session.sessionCode);
    }

    res.json({
      ok: true,
      sessionCode: session.sessionCode,
      teamDecision: finalTeamDecision,
      status: finalStatus,
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

    //이미 data_ready면 그대로 반환 (멱등)
    if (session.status === "data_ready") {
      return res.json({
        ok: true,
        sessionCode: session.sessionCode,
        status: session.status,
      });
    }

    // [HIGH-2] 조건부 업데이트 — 두 참가자가 동시에 finalize해도 completed→data_ready는 1회만 전환.
    const updated = await Session.findOneAndUpdate(
      { sessionCode: code, status: "completed" },
      { $set: { status: "data_ready" } },
      { returnDocument: "after", lean: true },
    );
    if (updated) {
      return res.json({
        ok: true,
        sessionCode: updated.sessionCode,
        status: updated.status,
      });
    }

    // 전환 실패 = status가 completed가 아님 (경쟁에서 졌거나 아직 completed 전)
    const fresh = await Session.findOne({ sessionCode: code }).lean();
    if (!fresh) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }
    if (fresh.status === "data_ready") {
      return res.json({ ok: true, sessionCode: fresh.sessionCode, status: fresh.status });
    }
    return res.status(409).json({
      ok: false,
      error: `Cannot finalize in status="${fresh.status}"`,
    });
  } catch (error) {
    console.error("[PATCH /api/sessions/:code/finalize]", error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});
