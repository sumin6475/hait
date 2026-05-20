//세션/참가자 코드 생성 로직
//- 테스트 세션과 실제 실험 세션을 prefix로 분리:
//    테스트:   T-C1-001 / TP-X-C1-001
//    실제:     S-C1-001 / P-X-C1-001
//- 각 prefix는 독립적인 seq 카운터를 가짐 (서로 영향 없음)
//- seq = max(prefix, condition) + 1

import { Session } from "../models/Session.js";
import type { ConditionCode, ParticipantRole, ProfileSlot } from "../types.js";

const SEQ_PAD = 3;
const SEQ_MAX = 999;

const SESSION_PREFIX_TEST = "T";
const SESSION_PREFIX_REAL = "S";
const PARTICIPANT_PREFIX_TEST = "TP";
const PARTICIPANT_PREFIX_REAL = "P";

//prefix 헬퍼 (한 곳에서 결정)
function sessionPrefix(isTest: boolean): string {
  return isTest ? SESSION_PREFIX_TEST : SESSION_PREFIX_REAL;
}

function participantPrefix(isTest: boolean): string {
  return isTest ? PARTICIPANT_PREFIX_TEST : PARTICIPANT_PREFIX_REAL;
}

//condition별 + prefix별 다음 seq 생성
//예: T-C1-010이 max면 011 반환. S-C1과는 독립.
export async function generateNextSeq(
  conditionCode: ConditionCode,
  isTest: boolean,
): Promise<string> {
  const prefix = sessionPrefix(isTest);

  //prefix로 시작하는 세션 중 가장 큰 sessionCode 조회
  //regex anchor + index 활용: ^T-C1- 또는 ^S-C1-
  const pattern = new RegExp(`^${prefix}-${conditionCode}-\\d{${SEQ_PAD}}$`);
  const last = await Session.findOne({
    conditionCode,
    sessionCode: { $regex: pattern },
  })
    .sort({ sessionCode: -1 })
    .lean();

  if (!last) return "001";

  //sessionCode 끝 3자리 파싱
  const lastSeqStr = last.sessionCode.slice(-SEQ_PAD);
  const lastSeq = parseInt(lastSeqStr, 10);

  if (isNaN(lastSeq)) {
    throw new Error(`Invalid sessionCode format: ${last.sessionCode}`);
  }

  if (lastSeq >= SEQ_MAX) {
    throw new Error(
      `seq exhausted for ${prefix}-${conditionCode}: ${lastSeq} >= ${SEQ_MAX}. Switch to longer format.`,
    );
  }

  return String(lastSeq + 1).padStart(SEQ_PAD, "0");
}

//세션 코드 생성: T-C1-001 또는 S-C1-001
export function buildSessionCode(
  conditionCode: ConditionCode,
  seq: string,
  isTest: boolean,
): string {
  return `${sessionPrefix(isTest)}-${conditionCode}-${seq}`;
}

//참가자 코드 생성: TP-X-C1-001 또는 P-X-C1-001
export function buildParticipantCode(
  role: ParticipantRole,
  conditionCode: ConditionCode,
  seq: string,
  isTest: boolean,
): string {
  const slot: ProfileSlot = role.slice(5) as ProfileSlot; //humanX -> X
  return `${participantPrefix(isTest)}-${slot}-${conditionCode}-${seq}`;
}

//condition별 참가자 구성 — CTRL은 X/Y/Z 3명, 그 외는 X/Y 2명
export function getParticipantSlots(
  conditionCode: ConditionCode,
): Array<{ role: ParticipantRole; profile: ProfileSlot }> {
  if (conditionCode === "CTRL") {
    return [
      { role: "humanX", profile: "X" },
      { role: "humanY", profile: "Y" },
      { role: "humanZ", profile: "Z" },
    ];
  }
  return [
    { role: "humanX", profile: "X" },
    { role: "humanY", profile: "Y" },
  ];
}
