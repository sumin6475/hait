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

  // [Step 37] 단일 빈도 가드 — AI 발화 후 사람 메시지가 N개 오기 전엔 침묵 (호명 제외). 2 = messagesSinceLastAI<2면 침묵.
  COOLDOWN_MIN_MSGS: 2,

  // 토론 총 길이 — 클라이언트 Timer(ChatRoom.tsx durationMinutes, 현재 20)와 반드시 일치. (단일소스화 추후)
  DISCUSSION_DURATION_MS: 20 * 60 * 1000,
  // 종료 N ms 전부터 leader 조건은 일반 트리거 차단 + closing 1회. (쉽게 조정 가능)
  CLOSING_LEAD_MS: 60 * 1000,

  // [Step 37] Depth 게이트 — 후보당 distinct 표면화 임계. 이 미만이면 "얕은 후보"로 보고 조기 이탈 차단. (튜너블)
  DEPTH_MIN_PER_CAND: 3,
  // [Step 39] 현재 토픽 후보(C*) 탐지 시 거슬러 볼 '사람' 메시지 수 (튜너블)
  DEPTH_LOOKBACK_MSGS: 4,
  // [Step 41] social 발화 최소 간격(메시지) — 직전 social 후 이만큼 안 지나면 억제. (callout 쿨다운과 동급)
  SOCIAL_COOLDOWN_MSGS: 4,

  // [Step 45] 수렴 소진 판정 — 새 trait 0인 메시지 수 임계. 이만큼 지나면 "다 나왔다". 튜닝값(조기종료 보이면 ↑).
  EXHAUST_K: 3,

  EXP_NATURAL_DIRECTED: true, // [EXP] 자연발화 프로빙.

  // [opening] 자연발화 "인사 recipe"를 쓸 토론 극초반 상한(누적 메시지). 이 미만 ∧ 테이블에 후보 0이면 오프닝으로 보고 인사로 받음. (튜너블 — 너무 일찍 의견 내면 ↑)
  NATURAL_OPENING_MAX_MSGS: 6,
} as const;
