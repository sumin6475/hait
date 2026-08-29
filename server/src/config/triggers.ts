//Trigger - 조정 가능하도록 환경변수로 분리
export const TRIGGER_CONFIG = {
  //매 N개 사람 메시지 후 평가 (Step 5/F: 5→3 — cooldown이 과발화를 차단하므로 더 자연스러운 끼어듦)
  MESSAGE_COUNT_THRESHOLD: 3,

  //마지막 AI 발화 후 N초 경과 시 평가
  TIME_INTERVAL_SECONDS: 90,

  // A long-silence route enters immediately after this quiet period.
  LONG_SILENCE_SECONDS: 15,

  // [Step 37] 단일 빈도 가드 — AI 발화 후 사람 메시지가 N개 오기 전엔 침묵 (호명 제외). 2 = messagesSinceLastAI<2면 침묵.
  COOLDOWN_MIN_MSGS: 2,

  // 토론 총 길이 — 클라이언트 sessionConfig.ts DISCUSSION_DURATION_MINUTES(현재 30)와 반드시 일치. (단일소스화 추후)
  DISCUSSION_DURATION_MS: 30 * 60 * 1000,
  // [Step 37] Depth 게이트 — 후보당 distinct 표면화 임계. 이 미만이면 "얕은 후보"로 보고 조기 이탈 차단. (튜너블)
  DEPTH_MIN_PER_CAND: 3,
  // [Step 39] 현재 토픽 후보(C*) 탐지 시 거슬러 볼 '사람' 메시지 수 (튜너블)
  DEPTH_LOOKBACK_MSGS: 4,
  // [Step 41] social 발화 최소 간격(메시지) — 직전 social 후 이만큼 안 지나면 억제. (callout 쿨다운과 동급)
  EXP_NATURAL_DIRECTED: true, // [EXP] 자연발화 프로빙.

  // [Tier 1] 시간 플로어 — exemption이 결정하는 것은 "속도"뿐, "브레이크 유무"가 아님.
  // 정규식/judge가 틀려도 연속 발화는 구조적으로 불가능 (응답이 조금 빠르거나 늦을 뿐).
  ADDRESS_FLOOR_MS: 2_000,
  FOLLOWUP_FLOOR_MS: 2_000,
  MAIN_ROUTE_DELAY_MS: 3_000,
  BACKCHANNEL_GAP_MS: 15_000, // backchannel(리라우트) 최소 간격. rate 0.6 목표.
  BACKCHANNEL_RATE: 0.6,
  SUMMARY_MIN_ELAPSED_MS: 10 * 60 * 1000,
  SUMMARY_MIN_HUMAN_MESSAGES: 12,
  SUMMARY_MIN_SURFACED: 8,
  SUMMARY_MIN_CANDIDATES: 2,
  SUMMARY_LATEST_BEFORE_END_MS: 5 * 60 * 1000,

  MEDIATION_TTL_MS: 3 * 60 * 1000,
  MEDIATION_TTL_HUMAN_MESSAGES: 8,
  MEDIATION_BUILD_ON_THRESHOLD: 2,

  // [opening] 자연발화 "인사 recipe"를 쓸 토론 극초반 상한(누적 메시지). 이 미만 ∧ 테이블에 후보 0이면 오프닝으로 보고 인사로 받음. (튜너블 — 너무 일찍 의견 내면 ↑)
  NATURAL_OPENING_MAX_MSGS: 6,
} as const;
