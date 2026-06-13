// [Step 30] 참가자 표시명 단일 소스 — 문구 변경 시 여기만.
// participantCode(TP-X-C2-010)는 조건 코드를 노출하므로 화면에 쓰지 않는다.
import type { ParticipantRole } from "@/types";

export const ROLE_LABEL: Record<ParticipantRole, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
};
