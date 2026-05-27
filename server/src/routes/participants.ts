//Participant 관련 라우트
//- PATCH /api/participants/:code/progress : progress step 마킹
//- GET /api/participants/:code/state : 재접속 시 현재 상태 반환

import { Router } from "express";
import { Participant } from "../models/Participant.js";
import type { ProgressStep } from "../types.js";

const router = Router();

const VALID_STEPS: ProgressStep[] = [
  "consent",
  "demographics",
  "infoCards",
  "preDiscussion",
  "waiting",
  "teamDecision",
  "postSurvey",
  "debrief",
  "complete",
];

//PATCH /api/participants/:code/progress
//body: { step: ProgressStep }
//progress[step] = true 로 마킹
router.patch("/:code/progress", async (req, res) => {
  try {
    const { code } = req.params;
    const { step } = req.body;

    if (!step || !VALID_STEPS.includes(step)) {
      return res
        .status(400)
        .json({ error: "invalid step", message: `step must be one of: ${VALID_STEPS.join(", ")}` });
    }

    //$set으로 부분 업데이트
    const participant = await Participant.findOneAndUpdate(
      { participantCode: code },
      { $set: { [`progress.${step}`]: true, lastSeenAt: new Date() } },
      { returnDocument: "after", lean: true },
    );
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }
    res.json({ ok: true, progress: participant.progress });
  } catch (error) {
    console.error("[PATCH /participants/:code/progress]", error);
    res.status(500).json({ error: "server_error" });
  }
});

//PATCH /api/participants/:code/pre-choice
//body: { choice: Candidate }
router.patch("/:code/pre-choice", async (req, res) => {
  try {
    const { code } = req.params;
    const { choice } = req.body;

    const VALID_CHOICES = ["A", "B", "C", "D"];
    if (!choice || !VALID_CHOICES.includes(choice)) {
      return res.status(400).json({
        error: "invalid_choice",
        message: `choice must be one of: ${VALID_CHOICES.join(", ")}`,
      });
    }

    const participant = await Participant.findOneAndUpdate(
      { participantCode: code },
      { $set: { preDiscussionChoice: choice, lastSeenAt: new Date() } },
      { returnDocument: "after", lean: true },
    );
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }
    res.json({ ok: true, choice: participant.preDiscussionChoice });
  } catch (error) {
    console.error("[PATCH /participants/:code/pre-choice]", error);
    res.status(500).json({ error: "server_error" });
  }
});

//GET /api/participants/:code/state
//재접속 시 클라이언트가 호출 - progress + session 정보 반환
router.get("/:code/state", async (req, res) => {
  try {
    const { code } = req.params;

    //participant + session populate (sessionCode와 conditionCode 필요)
    const participant = await Participant.findOne({ participantCode: code })
      .populate<{
        sessionId: { sessionCode: string; conditionCode: string };
      }>("sessionId", "sessionCode conditionCode")
      .lean();
    if (!participant) {
      return res.status(404).json({ error: "participant_not_found" });
    }

    //lastSeenAt 업데이트
    Participant.updateOne({ participantCode: code }, { $set: { lastSeenAt: new Date() } }).catch(
      (error) => console.error("[lastSeenAt update failed]", error),
    );

    res.json({
      ok: true,
      state: {
        participantCode: participant.participantCode,
        role: participant.role,
        assignedProfile: participant.assignedProfile,
        sessionCode: participant.sessionId.sessionCode,
        conditionCode: participant.sessionId.conditionCode,
        progress: participant.progress,
        preDiscussionChoice: participant.preDiscussionChoice,
        completedAt: participant.completedAt,
      },
    });
  } catch (error) {
    console.error("[GET /participants/:code/state]", error);
    res.status(500).json({ error: "server_error" });
  }
});

export default router;
