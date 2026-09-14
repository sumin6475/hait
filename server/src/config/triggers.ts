//Trigger - 조정 가능하도록 환경변수로 분리
export const TRIGGER_CONFIG = {
  // Long silence is a restrained backup route, not the primary speaking path.
  LONG_SILENCE_SECONDS: 60,
  LONG_SILENCE_MAX_BROADCASTS: 3,
  LONG_SILENCE_MIN_INTERVAL_MS: 5 * 60 * 1000,
  LONG_SILENCE_MIN_HUMAN_MSGS_SINCE_AI: 2,

  // [Step 37] 단일 빈도 가드 — AI 발화 후 사람 메시지가 N개 오기 전엔 침묵 (호명 제외). 2 = messagesSinceLastAI<2면 침묵.
  COOLDOWN_MIN_MSGS: 2,

  // 토론 총 길이. 클라이언트 sessionConfig.ts DISCUSSION_DURATION_MINUTES와 반드시 일치하며,
  // test:intervention-v2가 두 파일을 읽어 검사한다 — 어긋나면 화면의 타이머와 Alex가 닫는
  // 시점이 달라지고, 그건 참가자에게 보인다. (별도 패키지라 import로 묶을 수 없음)
  DISCUSSION_DURATION_MS: 30 * 60 * 1000,
  // [Step 37] Depth 게이트 — 후보당 distinct 표면화 임계. 이 미만이면 "얕은 후보"로 보고 조기 이탈 차단. (튜너블)
  DEPTH_MIN_PER_CAND: 3,
  // [Step 39] 현재 토픽 후보(C*) 탐지 시 거슬러 볼 '사람' 메시지 수 (튜너블)
  DEPTH_LOOKBACK_MSGS: 4,

  // [Tier 1] 시간 플로어 — exemption이 결정하는 것은 "속도"뿐, "브레이크 유무"가 아님.
  // 정규식/judge가 틀려도 연속 발화는 구조적으로 불가능 (응답이 조금 빠르거나 늦을 뿐).
  ADDRESS_FLOOR_MS: 2_000,
  FOLLOWUP_FLOOR_MS: 2_000,
  MAIN_ROUTE_DELAY_MS: 3_000,
  BACKCHANNEL_GAP_MS: 15_000, // 의미 Judge를 통과한 backchannel끼리의 최소 간격.
  BACKCHANNEL_RATE: 1,

  MEDIATION_TTL_MS: 3 * 60 * 1000,
  MEDIATION_TTL_HUMAN_MESSAGES: 8,
  MEDIATION_BUILD_ON_THRESHOLD: 2,
} as const;
