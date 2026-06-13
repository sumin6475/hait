//연구자 승인 게이트 단일 소스 (Step 32) — 서버는 임의 gateId의 도착/승인을 저장·노출만 한다.
//게이트 켜고 끄기 = 아래 enabled 1줄. id는 "잠금 해제하는 단계명".
//주의: api.ts를 import하지 않는다 — api.ts가 이 파일을 import (단방향, 순환 방지)

export type GateId = "consent" | "demographics" | "infoCards" | "waiting" | "teamDecision" | "debrief";
export type GateApprovals = Partial<Record<GateId, string>>;

export interface GateDef {
  id: GateId;
  enabled: boolean; //끄기 = 이 줄만 false
  nextPath: string; //승인 시 이동
  nextLabel: string; //Hold 화면 "Next: ..." 표시
  holdNote?: string; //게이트별 추가 안내 1줄 (영어 — 실험 언어 고정)
}

export const GATES: GateDef[] = [
  { id: "consent", enabled: true, nextPath: "/chat/consent", nextLabel: "Consent Form" },
  { id: "demographics", enabled: true, nextPath: "/chat/demographics", nextLabel: "Pre-Survey" },
  { id: "infoCards", enabled: true, nextPath: "/chat/info-cards", nextLabel: "Candidate Information" },
  { id: "waiting", enabled: true, nextPath: "/chat/waiting", nextLabel: "Team Discussion" },
  {
    id: "teamDecision",
    enabled: true,
    nextPath: "/chat/team-decision",
    nextLabel: "Team Decision",
    holdNote: "The discussion has ended.",
  },
  {
    id: "debrief",
    enabled: true,
    nextPath: "/chat/debrief",
    nextLabel: "Debrief",
    holdNote: "Please stay on the Zoom call — the researcher will speak with your team first.",
  },
];

export const gateById = (id: string) => GATES.find((g) => g.id === id);

//게이트 통과 여부 — disabled 게이트는 항상 통과
export const gateOpen = (id: GateId, approvals: GateApprovals | undefined) => {
  const g = gateById(id);
  return !g?.enabled || Boolean(approvals?.[id]);
};
