// [Step 30] 표시명 단일 소스 (서버) — 화면 라벨(aiName 전달)과 Alex transcript 라벨을 여기서 통일.
// 문구 변경 시 이 파일만. DB Message.sender는 계속 participantCode 저장 — 표시·프롬프트 층 전용.
import type { ConditionCode, SenderRole } from "../types.js";

export const PARTICIPANT_LABEL: Record<string, string> = {
  humanX: "Participant X",
  humanY: "Participant Y",
  humanZ: "Participant Z",
};

// 조건별 AI 표시명 — "Moderator"는 peer 조건에 리더성을 누출하므로 조건별로 분리.
// [Step 64] Leader/Peer → Chair/Member (2026-06-24 확정 라벨 반영).
export function aiDisplayName(c: ConditionCode): string | undefined {
  if (c === "C2" || c === "C4") return "Alex — Chair";
  if (c === "C1" || c === "C3") return "Alex — Member";
  return undefined; // CTRL — AI 없음
}

// Alex가 받는 transcript의 화자 라벨 — 화면 라벨과 일치해야 지목이 성립 (역할은 시스템 프롬프트 담당이라 AI는 "Alex"로 짧게).
export function transcriptLabel(senderRole: SenderRole): string {
  return senderRole === "ai" ? "Alex" : (PARTICIPANT_LABEL[senderRole] ?? senderRole);
}
