//Trigger - 조정 가능하도록 환경변수로 분리
export const TRIGGER_CONFIG = {
  //매 N개 사람 메시지 후 평가 (Step 5/F: 5→3 — cooldown이 과발화를 차단하므로 더 자연스러운 끼어듦)
  MESSAGE_COUNT_THRESHOLD: 3,

  //마지막 AI 발화 후 N초 경과 시 평가
  TIME_INTERVAL_SECONDS: 90,

  //마지막 메시지 (누구든) 후 N초 정적 시 평가 (Step 5/F: 30→45 — 사람 사고시간 안 끊게)
  LONG_SILENCE_SECONDS: 45,

  //Pull 트리거 평가 추기 (setInterval 간격)
  PULL_EVALUATION_INTERVAL_MS: 5_000,

  // [Step 37] 단일 빈도 가드 — AI 직후 연속 발화만 차단 (호명 제외). 1 = messagesSinceLastAI<1이면 침묵.
  COOLDOWN_MIN_MSGS: 1,

  // 토론 총 길이 — 클라이언트 Timer(ChatRoom.tsx durationMinutes, 현재 20)와 반드시 일치. (단일소스화 추후)
  DISCUSSION_DURATION_MS: 20 * 60 * 1000,
  // 종료 N ms 전부터 leader 조건은 일반 트리거 차단 + closing 1회. (쉽게 조정 가능)
  CLOSING_LEAD_MS: 60 * 1000,

  // [Step 37] Depth 게이트 — 후보당 distinct 표면화 임계. 이 미만이면 "얕은 후보"로 보고 조기 이탈 차단. (튜너블)
  DEPTH_MIN_PER_CAND: 3,
} as const;
