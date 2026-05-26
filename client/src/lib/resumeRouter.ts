//재접속 시 ParticipantState를 보고 어디로 보낼지 결정
//매트릭스: 우선순위 높은 조건부터 매칭, 첫 매치만 적용

import { ParticipantState } from "./api";

export type ChatPath =
  | "/chat/consent"
  | "/chat/demographics"
  | "/chat/info-cards"
  | "/chat/pre-discussion"
  | "/chat/waiting"
  | "/chat/debrief"
  | "/chat/complete";

export function resolveResumePath(state: ParticipantState): ChatPath {
  //1. 완전 종료
  if (state.completedAt) {
    return "/chat/complete";
  }

  const p = state.progress;

  //2. PostSurvey까지 완료 - debrief만 남음
  if (p.postSurvey) {
    return "/chat/debrief";
  }

  //3. PreDiscussion까지 완료 - 토론 진입 직전
  //일단 waiting room으로
  if (p.preDiscussion) {
    return "/chat/waiting";
  }

  //4. InfoCards까지 완료
  if (p.infoCards) {
    return "/chat/pre-discussion";
  }

  //5. Demographics까지 완료
  if (p.demographics) {
    return "/chat/info-cards";
  }

  //6. Consent까지 완료
  if (p.consent) {
    return "/chat/demographics";
  }

  //7. 신규 또는 진행 없음
  return "/chat/consent";
}
