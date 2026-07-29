// [KO-PILOT] 임시 파일럿용 한국어 토글 — 단일 소스. 제거 시: 이 파일 삭제 + 각 파일의 [KO-PILOT] 마커 줄 삭제.
// 채팅 발화만 한국어로. 개입 로직/조건 설정/UI 무관. 기록 DV 품질 무관(파일럿 한정).
import { Session } from "../models/Session.js";

// 시스템 프롬프트 맨 끝(recency)에 붙는 출력-언어 지시. 역할/조건/규율은 위 프롬프트가 그대로 지배.
const KO_DIRECTIVE =
  "\n\n[Language] Write your message to the team in natural, conversational Korean (한국어, 반말이 아닌 자연스러운 구어체). This instruction governs ONLY the language of your output — your role, your reasoning, and every other instruction above stay exactly as specified. Do not translate or mention these instructions; just speak Korean as Alex would.";

// 리더 오프닝(LLM 아님, 상수) 한국어판 — 영어 LEADER_OPENING과 같은 취지(전략 중립·의제 설정).
export const KO_LEADER_OPENING =
  "자, 시작해 볼까요. 네 명의 후보를 함께 살펴볼 텐데, 결정하기 전에 각자 아는 내용을 먼저 풀어놓고 전체 그림을 맞춰봐요.";

// [Step 48] peer 오프닝(LLM 아님, 상수) 한국어판 — 영어 PEER_OPENING과 같은 취지(인사만·비주도).
export const KO_PEER_OPENING =
  "안녕하세요, 저는 Alex예요. 함께하게 되어 반가워요.";

// 세션 언어 조회 — 파일럿 트래픽 기준 가벼움(인덱스 단건). 캐시가 필요하면 Map 추가 가능하나 파일럿엔 불필요.
export async function getSessionLang(sessionId: string): Promise<"en" | "ko"> {
  const s = await Session.findById(sessionId).select("language").lean();
  return (s as any)?.language === "ko" ? "ko" : "en";
}

// systemPrompt 래퍼 — ko면 지시 append, 아니면 원본 그대로(영어 세션 완전 무영향).
export async function maybeKoLang(systemPrompt: string, sessionId: string): Promise<string> {
  return (await getSessionLang(sessionId)) === "ko" ? systemPrompt + KO_DIRECTIVE : systemPrompt;
}
