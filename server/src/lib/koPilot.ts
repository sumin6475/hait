// [KO-PILOT] 임시 파일럿용 한국어 토글 — 단일 소스. 제거 시: 이 파일 삭제 + 각 파일의 [KO-PILOT] 마커 줄 삭제.
// 채팅 발화만 한국어로. 개입 로직/조건 설정/UI 무관. 기록 DV 품질 무관(파일럿 한정).
// 리더 오프닝(LLM 아님, 상수) 한국어판 — 영어 LEADER_OPENING과 같은 취지(전략 중립·의제 설정).
export const KO_LEADER_OPENING =
  "자, 시작해 볼까요. 네 명의 후보를 함께 살펴볼 텐데, 결정하기 전에 각자 아는 내용을 먼저 풀어놓고 전체 그림을 맞춰봐요.";

// [Step 48] peer 오프닝(LLM 아님, 상수) 한국어판 — 영어 PEER_OPENING과 같은 취지(인사만·비주도).
export const KO_PEER_OPENING = "안녕하세요, 저는 Alex예요. 함께하게 되어 반가워요.";

// [Step 49] peer 클로징(하드코딩 상수) 한국어판 — 영어 PEER_CLOSING과 동일 취지.
export const KO_PEER_CLOSING = "시간이 다 됐네요. 최종 결정은 여러분께 맡길게요. 감사합니다.";
