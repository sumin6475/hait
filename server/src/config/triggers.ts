//Trigger - 조정 가능하도록 환경변수로 분리
export const TRIGGER_CONFIG = {
  //매 N개 사람 메시지 후 평가
  MESSAGE_COUNT_THRESHOLD: 5,

  //마지막 AI 발화 후 N초 경과 시 평가
  TIME_INTERVAL_SECONDS: 90,

  //마지막 메시지 (누구든) 후 N초 정적 시 평가
  LONG_SILENCE_SECONDS: 30,

  //Pull 트리거 평가 추기 (setInterval 간격)
  PULL_EVALUATION_INTERVAL_MS: 5_000,

  // 토론 총 길이 — 클라이언트 Timer(ChatRoom.tsx durationMinutes, 현재 20)와 반드시 일치. (단일소스화 추후)
  DISCUSSION_DURATION_MS: 20 * 60 * 1000,
  // 종료 N ms 전부터 leader 조건은 일반 트리거 차단 + closing 1회. (쉽게 조정 가능)
  CLOSING_LEAD_MS: 60 * 1000,
} as const;
