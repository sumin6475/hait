// computeCue — 발화 시점의 speaking reason(cue)을 맥락에서 계산한다 (순수 함수).
// 값은 compiled 프롬프트의 cue_routing 어휘와 정확히 일치해야 한다.
// 라이브(Step 6)와 eval(run-golden) 공유. 가정: 호출 맥락의 마지막 메시지는 사람 턴이다
// (트리거는 사람 발화 뒤에 돌고, 라이브 cooldown(Step 5)이 'AI 직후 발화'를 막는다).

export type SpeakingReason =
  | "opening"
  | "build_on"
  | "directed_followup"
  | "mediation"
  | "closing";

export interface ComputeCueInput {
  messages: { sender: string; content: string }[]; // 최근 턴(윈도우된 transcript 또는 골든 context)
  phase?: "main" | "closing";
}

// mediation 키워드(투명 휴리스틱). 골든의 split/조기축소(A6·A7)를 잡는 용도.
// 라이브 일반 대화의 mediation 감지는 더 어렵다 → Step 6/레버 D(judge)에서 다룬다.
const MEDIATION_RE =
  /(going in circles|i disagree|i'?d be fine|deciding between those|decide between those|we'?re split|split between)/i;

// AI 호명(명시). 라이브의 'AI 메시지에 직접 reply'는 Step 6에서 추가.
// 트리거 게이트(evaluate.ts)와 공유 — 단일 소스 (Step 5/F)
// [KO-PILOT] 한국어 호명 "알렉스" 추가 — 영어 세션엔 안 나타나 무해. 제거 시 |알렉스 만 삭제.
export const ADDRESS_RE = /\balex\b|알렉스/i;

export function computeCue(input: ComputeCueInput): SpeakingReason {
  const { messages, phase } = input;

  if (phase === "closing") return "closing"; // 1. 실험 플로우가 closing을 신호
  if (messages.length === 0) return "opening"; // 2. 토론 시작 전

  const lastText = messages[messages.length - 1]?.content ?? "";
  if (ADDRESS_RE.test(lastText)) return "directed_followup"; // 3. AI 호명

  const recentText = messages
    .slice(-4)
    .map((m) => m.content)
    .join(" ");
  if (MEDIATION_RE.test(recentText)) return "mediation"; // 4. split/조기축소

  return "build_on"; // 5. [Step 37] 기본: 마지막 말 받기 (45s 안전망 = 직전 발화 위에 한 포인트)
}
