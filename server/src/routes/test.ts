import { Router } from "express";
import { Session } from "../models/Session.js";

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
