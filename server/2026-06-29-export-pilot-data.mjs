// 2026-06-29 Pilot data export for DV analysis (read-only).
// Run from the server/ folder:   node 2026-06-29-export-pilot-data.mjs
// It connects to your Atlas (via MONGODB_URI in server/.env), pulls every
// session with its messages / participants / AI interventions, and writes
// ./pilot-export.json . Nothing is written to the database.

import fs from "fs";
import mongoose from "mongoose";

// --- read MONGODB_URI from .env (no extra deps) ---
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8")
    .split("\n").filter(Boolean)
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const uri = env.MONGODB_URI;
if (!uri) { console.error("MONGODB_URI not found in .env"); process.exit(1); }

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
const db = mongoose.connection.db;

const sessions = await db.collection("sessions").find({}).sort({ createdAt: 1 }).toArray();
const out = [];

for (const s of sessions) {
  const messages = await db.collection("messages")
    .find({ sessionId: s._id }).sort({ seq: 1 }).toArray();
  const participants = await db.collection("participants")
    .find({ sessionId: s._id }).toArray();
  const interventions = await db.collection("aiinterventions")
    .find({ sessionId: s._id }).sort({ turnIndex: 1 }).toArray();

  out.push({
    sessionCode: s.sessionCode,
    conditionCode: s.conditionCode,
    aiProfile: s.aiProfile,
    createdAt: s.createdAt,
    metadata: s.metadata,
    revealStats: s.revealStats,            // includes aiSurfacedIds + byProfile/byCandidate
    participants: participants.map((p) => ({
      participantCode: p.participantCode, role: p.role, assignedProfile: p.assignedProfile,
      preDiscussionChoice: p.preDiscussionChoice, teamDecisionChoice: p.teamDecisionChoice,
      recallTest: p.recallTest, demographics: p.demographics,
    })),
    messages: messages.map((m) => ({
      seq: m.seq, senderRole: m.senderRole, sender: m.sender,
      content: m.content, sharedInfoIds: m.sharedInfoIds, createdAt: m.createdAt,
    })),
    interventions: interventions.map((a) => ({
      turnIndex: a.turnIndex, triggerReason: a.triggerReason, decision: a.decision,
      cue: a.cue, why: a.why, calloutTarget: a.calloutTarget, calloutCand: a.calloutCand,
      response: a.response,
    })),
  });

  console.log(
    `${s.sessionCode}  ${s.conditionCode}  msgs=${messages.length}  ` +
    `aiSurfaced=${s.revealStats?.aiSurfacedIds?.length ?? 0}  ` +
    `parts=${participants.length}`
  );
}

fs.writeFileSync("pilot-export.json", JSON.stringify(out, null, 2));
console.log(`\nWrote pilot-export.json  (${out.length} sessions)`);
await mongoose.disconnect();
