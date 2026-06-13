//재접속 시 ParticipantState를 보고 어디로 보낼지 결정
//매트릭스: 우선순위 높은 조건부터 매칭, 첫 매치만 적용
//[Step 32] 게이트 경계는 viaGate로 — 승인 전이면 hold, 승인됐거나 disabled면 직행

import { ParticipantState } from "./api";
import { gateOpen, type GateId } from "./gates";

export type ChatPath =
  | "/chat/consent"
  | "/chat/demographics"
  | "/chat/info-cards"
  | "/chat/pre-discussion"
  | "/chat/waiting"
  | "/chat/room"
  | "/chat/team-decision"
  | "/chat/post-survey"
  | "/chat/debrief"
  | "/chat/complete"
  | `/chat/hold/${GateId}`;

//게이트가 닫혀 있으면 hold, 열려 있으면(승인됨 or disabled) 직행
function viaGate(state: ParticipantState, gate: GateId, direct: ChatPath): ChatPath {
  return gateOpen(gate, state.approvals) ? direct : (`/chat/hold/${gate}` as ChatPath);
}

export function resolveResumePath(state: ParticipantState): ChatPath {
  //1. 완전 종료
  if (state.completedAt) {
    return "/chat/complete";
  }

  //1.5 [Step 25 — 무수정] 세션이 이미 진행 중이면 토론방 직행 (progress가 waiting이어도 대기실 안 거침)
  //    G5(토론 종료) 대기 중 재입장도 여기로 — ChatRoom 타이머가 만료 상태면
  //    첫 1초 틱에 onExpired가 hold/teamDecision으로 재이동시킴 (Timer.tsx left===0 분기, 설계된 경로)
  if (state.sessionStatus === "in_progress") {
    return "/chat/room";
  }
  //    세션이 끝났으면(토론 종료) 사후 절차로 — postSurvey 전이면 team-decision부터
  if (state.sessionStatus === "completed" || state.sessionStatus === "data_ready") {
    if (!state.progress.teamDecision) return "/chat/team-decision";
    if (!state.progress.postSurvey) return "/chat/post-survey";
    return viaGate(state, "debrief", "/chat/debrief"); //G6 — 인터뷰 게이트
  }

  const p = state.progress;

  //2. PostSurvey까지 완료 - debrief만 남음
  if (p.postSurvey) return viaGate(state, "debrief", "/chat/debrief");

  //3. PreDiscussion까지 완료 - 토론 진입 직전 (G4 — 토론 시작 통제)
  if (p.preDiscussion) return viaGate(state, "waiting", "/chat/waiting");

  //4. InfoCards까지 완료 (게이트 없음 — InfoCards→PreDiscussion 연속)
  if (p.infoCards) return "/chat/pre-discussion";

  //5. Demographics까지 완료 (G3 — 본 실험 시작)
  if (p.demographics) return viaGate(state, "infoCards", "/chat/info-cards");

  //6. Consent까지 완료 (G2)
  if (p.consent) return viaGate(state, "demographics", "/chat/demographics");

  //7. 신규 또는 진행 없음 (G1 — 둘 다 접속 확인 후 시작)
  return viaGate(state, "consent", "/chat/consent");
}
