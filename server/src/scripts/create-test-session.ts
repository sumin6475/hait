import "dotenv/config";
import mongoose from "mongoose";
import { Session } from "../models/Session.js";
import { Participant } from "../models/Participant.js";
import type { ConditionCode } from "../types.js";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("MONGODB_URI not set");

const arg = process.argv[2] ?? "C1";
const validCodes: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];
if (!validCodes.includes(arg as ConditionCode)) {
  console.error(`Invalid condition: ${arg}. Use C1/C2/C3/C4/CTRL.`);
  process.exit(1);
}
const conditionCode = arg as ConditionCode;

await mongoose.connect(MONGODB_URI);

const sessionCode = `S-${conditionCode}-${Date.now()}`;

//Session 생성
const session = await Session.create({
  sessionCode,
  conditionCode,
  aiProfile: conditionCode === "CTRL" ? null : "Z",
  status: "waiting",
});

//Participant - CTRL은 3명(X,Y,Z), 그 외는 2명(X,Y)
//participantCode가 globally unique이므로 conditionCode + timestamp suffix 사용
const suffix = sessionCode.split("-").slice(1).join("-"); //예: C1-1234567890

const baseParticipants =
  conditionCode === "CTRL"
    ? [
        { role: "humanX" as const, profile: "X" as const },
        { role: "humanY" as const, profile: "Y" as const },
        { role: "humanZ" as const, profile: "Z" as const },
      ]
    : [
        { role: "humanX" as const, profile: "X" as const },
        { role: "humanY" as const, profile: "Y" as const },
      ];

const participants = baseParticipants.map((p) => ({
  sessionId: session._id,
  participantCode: `P-${p.role.slice(5)}-${suffix}`, //P-X-C1-1234567890
  role: p.role,
  assignedProfile: p.profile,
}));

await Participant.insertMany(participants);

console.log(`\n✅ created session`);
console.log(`   sessionCode: ${sessionCode}`);
console.log(`   conditionCode: ${conditionCode}`);
console.log(`   participants:`);
for (const p of participants) {
  console.log(`     ${p.role} → ${p.participantCode}`);
}

console.log(`\n검증 URL (각 브라우저 탭):`);
for (const p of participants) {
  console.log(
    `   http://localhost:8080/chat/room?session=${sessionCode}&participant=${p.participantCode}`,
  );
}

await mongoose.disconnect();
process.exit(0);
