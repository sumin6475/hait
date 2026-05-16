import { Router } from "express";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";

export const testRouter = Router();

testRouter.post("/test/create-session", async (req, res) => {
  try {
    const session = await Session.create({
      sessionCode: `S-Test-${Date.now()}`,
      conditionCode: "C1",
      aiProfile: "Z",
      status: "waiting",
    });
    res.json({ ok: true, session });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

testRouter.post("/test/create-participant", async (req, res) => {
  try {
    const { sessionCode, participantCode, role, assignedProfile } = req.body;
    const session = await Session.findOne({ sessionCode });
    if (!session) {
      return res.status(404).json({ ok: false, error: "Session not found" });
    }

    const participant = await Participant.create({
      sessionId: session._id,
      participantCode,
      role,
      assignedProfile,
    });

    res.json({ ok: true, participant });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});
