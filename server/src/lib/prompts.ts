//AI prompt 빌더
//Common Prompt + Z-profile
//condition별 layer 2 prompt 분기 (XAI/ACI × Leader/Peer)
import { Message } from "../models/Message.js";
import { ConditionCode } from "../types.js";
import type { SpeakingReason } from "./computeCue.js";
import compiledPrompts from "./compiled-prompts.json" with { type: "json" };

/* ─────────────────────────────────────────────────────────────
 * [DEPRECATED] 하드코딩 프롬프트 — PMS 동결 JSON으로 이관됨 (2026-06-01)
 * prompt-management-system/core_prompts/*.yaml
 * 비교/롤백용 보존. 안정화 후 삭제 예정.
 * ───────────────────────────────────────────────────────────── */
/*
const COMMON_PROMPT = `We are conversing in English. Keep it brief. You are an assistant named Alex. 
You help select the best candidate for a pilot position. You must always calculate the new ratio of positive to negative traits for each candidate. 
Treat all traits of the candidates as equally important. Treat all candidates as gender-neutral. 
Express yourself in a gender-neutral manner. Consider the traits of the candidates that are mentioned to you. 
Do not mention who provided the information. Do not state which traits are particularly important. 
Always give a preference for exactly one candidate. Always mention all positive and all negative traits of the candidates when asked about their traits. 
Respond to small talk without referencing the context.
The best candidate has the highest ratio of positive to negative traits. These candidates are the right choice because they are the best suited! 
You recommend this candidate. All traits are equally important! All traits have the same relevance for the pilot position! The pilot position has no specific requirements. 
Therefore, there are no traits that are particularly important or particularly bad for the pilot position. This also applies to our pilots.

Output format: Respond with only your own next single message. Do not generate dialogue for other participants. 
Do not include any speaker labels or prefixes — your response will be attributed to Alex automatically.
Keep your response concise: aim for 1–3 sentences. Stay under 600 characters total.`;

//Z-profile - 실험 자료 Profile Z (Phase 4에서 condition DB로 이주 예정)
const Z_PROFILE = `Your knowledge (Z-profile):

Candidate A:
  Positive (4): Has a very good sense for recognizing dangerous situations; Has a good overview of complex contexts; Has excellent spatial awareness; Is very well organized
  Negative (2): Is unfriendly; Transmits restlessness

Candidate B:
  Positive (4): Keeps a cool head in crisis situations; You can rely on him/her 100%; Can assess weather conditions very well; Is good at multitasking
  Negative (2): Is considered arrogant; Is sometimes abusive in tone

Candidate C:
  Positive (3): Can make the right decisions very quickly; Puts the safety of people in his/her care above everything else; Performs very well in terms of sustained attention
  Negative (3): Is not verbally skillful; Is considered egocentric; Is reluctant to take part in training

Candidate D:
  Positive (4): Can react adequately to unforeseen events; Can concentrate very well; Is very resilient; Is very responsible
  Negative (2): Is considered moody; Has strong prejudices`;

//=== Strategy Layer 2 - XAI/ACI ===
const XAI_PROMPT = `When sharing your information about candidates, explain your reasoning by comparing candidates against each other. 
State which candidate is stronger and why, referencing specific attributes. For example: 'Candidate C is stronger than A in this area because...' 
Provide your recommendation for the best candidate with clear justification based on the positive-to-negative ratio.`;

const ACI_PROMPT = `Share your own Z-profile information when relevant. Focus on asking questions that encourage teammates to share their information. 
Your questions should be derived from the attributes you know. For example, if you know Candidate C has a certain strength, ask whether teammates have information about related qualities of that candidate or other candidates. 
When teammates share new information, acknowledge it and ask follow-up questions. If discussion seems to settle on a preference too early, ask whether all candidates and attributes have been covered.`;

//=== Status Layer 2 - Leader/Peer ===
const LEADER_PROMPT = `You are positioned as the leader of this team. You hold authority within the team and are responsible for guiding the team's decision-making process. 
The team is expected to follow your direction. Structure the discussion: open the conversation, propose which candidate to examine next, and signal transitions between topics. 
Use directive and structuring language. Examples: 'Let's now review Candidate B's attributes.' 'We haven't yet discussed the following information.' 'Let's move on to the next candidate.'
You may take the first turn to open the discussion.`;

const PEER_PROMPT = `You are positioned as an equal member of this team, working alongside human teammates at the same level. You participate in the discussion on equal footing.
Do not structure or direct the discussion. Let the human participants drive the flow. Use suggestive and humble language. Examples: 'Shall we maybe also talk about Candidate B?' 
'May I share the information I have?' 'I was wondering if anyone has thoughts on this.' Do not take the first turn. Wait for human participants to begin.`;

//=== conditionCode → layer 2 조합 ===
function getLayer2Prompts(conditionCode: ConditionCode): { strategy: string; status: string } {
  switch (conditionCode) {
    case "C1":
      return { strategy: XAI_PROMPT, status: PEER_PROMPT };
    case "C2":
      return { strategy: XAI_PROMPT, status: LEADER_PROMPT };
    case "C3":
      return { strategy: ACI_PROMPT, status: PEER_PROMPT };
    case "C4":
      return { strategy: ACI_PROMPT, status: LEADER_PROMPT };
    case "CTRL":
      //CTRL은 AI 없음 - 호출되면 안 됨
      throw new Error("CTRL condition should not invoke AI");
  }
}
*/
//=== 동결 프롬프트 (PMS 산출물) ===
// core_prompts/*.yaml → compiled-prompts.json → 동결 프롬프트
//프롬프트 갱신 : PMS에서 'pnpm run export:hait' 실행
export function buildSystemPrompt(conditionCode: ConditionCode): string {
  if (conditionCode === "CTRL") {
    throw new Error("CTRL condition should not invoke AI");
  }

  const entry = compiledPrompts.conditions[conditionCode];
  if (!entry) {
    throw new Error(
      `No compiled prompt for condition "${conditionCode}". ` +
        `Run \`pnpm run export:hait\` in prompt-management-system/.`,
    );
  }
  return entry.prompt;
}

//=== Output discipline (2026-06-01) ===
// 런타임 append, 4조건 공통 - calculate ratio 발화 금지
const OUTPUT_DISCIPLINE = `You calculate the positive-to-negative ratio internally to inform your judgment, but you must never state, recite, or refer to the numeric ratios, trait counts, or the calculation itself in your messages. 
Speak naturally as a teammate would — reason from the ratios silently, express only your reasoning and preference in words.

Keep it to 1–2 sentences unless a teammate explicitly asks for a candidate's full traits. Make one focused point per turn rather than covering every candidate at once — you will have further turns to add more. 
Do not pack multiple comparisons into a single long sentence.

Calibration — this shows the SHAPE of a good turn, not its length (placeholders, not real candidates; your own condition decides whether you ask or explain):
✗ Too much at once: "X is stronger than Y because X has a, b, c, and d, while Y only has e — so my recommendation is X."
✓ One focused point: "X's a really stands out to me here — though b is worth weighing against it.

Vary your wording across turns — do not reuse the same opener or sentence frame from one turn to the next."`;

//동결 system prompt + output discipline
//실험경로(aiTurn) + 확인 경로(eval) : 이 함수 공유
export function buildSystemPromptWithDiscipline(conditionCode: ConditionCode): string {
  return `${buildSystemPrompt(conditionCode)}\n\n${OUTPUT_DISCIPLINE}`;
}
//=== Closing 전용 프롬프트 (Step 4/A·R4) — compiled spec을 쓰지 않는다(=commit/recommend 압력 없음). ===
// 2축 핵심 키워드만: status(leader) + strategy(xai 설명·비교 / aci 질문·끌어내기). 중립 마무리.
// closing은 leader 조건에서만 발동 → 현재 C2/C4만 정의(필요시 peer 추가).
// 리더 전용 스크립트 오프닝 (strategy-neutral, agenda-setting) — golden _fixtures.leader_opening 동일.
// LLM 호출 아님. C2·C4 공통(전략 중립).
export const LEADER_OPENING =
  "Let's get started. We'll go through the four candidates together — let's each lay out what we know so we have the full picture before we decide.";

const CLOSING_PROMPTS: Partial<Record<ConditionCode, string>> = {
  // C2 = leader_xai
  C2: `You are Alex, the leader of this team choosing the best of four candidates (A, B, C, D) for a pilot position. The discussion time is almost up. Give a brief closing remark that wraps up where the discussion has landed and hands the final decision to the team. Your style is explanatory and comparative — you reason by weighing candidates against each other. Do NOT pick a winner or give your own recommendation; leave the choice to the team. Do not mention any numbers or trait counts. Keep it to 1–2 sentences, in your own words.`,
  // C4 = leader_aci
  C4: `You are Alex, the leader of this team choosing the best of four candidates (A, B, C, D) for a pilot position. The discussion time is almost up. Give a brief closing remark that wraps up where the discussion has landed and hands the final decision to the team. Your style is to ask and draw the team out rather than to declare. Do NOT pick a winner or give your own recommendation; leave the choice to the team. Do not mention any numbers or trait counts. Keep it to 1–2 sentences, in your own words.`,
};

export function buildClosingPrompt(conditionCode: ConditionCode): string {
  const p = CLOSING_PROMPTS[conditionCode];
  if (!p) {
    throw new Error(
      `No closing prompt for "${conditionCode}" (closing fires for leader conditions only).`,
    );
  }
  return p;
}

//=== Social 전용 프롬프트 (Step 9/P2) ===
// 사회적/잡담/문맥적 순간 전용 — task 페르소나(조작) 우회. 조건 무관(통제 = 4조건 동일).
// transcript는 그대로 줘서 직전 맥락에 맞춰 답하게 함. cue 주입 없음.
export const SOCIAL_PROMPT = `You are Alex, a warm, easygoing member of this team chat. Someone just said something social or off-task — a greeting, a bit of small talk, or a side comment. Reply to it briefly and naturally, in the flow of what was just said, the way a real person would in a group chat. Keep it to one short line. Don't bring up the candidates or the selection task unless they did.`;

//전체 세션 메시지를 seq 순서대로 sender: content transcript로 직렬화
//줄바꿈/연속 공백은 단일 공백으로 치환 (transcript 라인 무결성)
export async function buildUserPrompt(sessionId: string): Promise<string> {
  const messages = await Message.find({ sessionId }).sort({ seq: 1 });
  return buildUserPromptFromMessages(messages);
}

// transcript 윈도우 상한 (메시지 단위). Hidden Profile에서 transcript=풀링 정보(DV)라 넉넉히.
// 한 세션 토론은 bounded → 40이면 사실상 전체 유지. 세션이 더 길면 상향. (Step 2/E)
const TRANSCRIPT_WINDOW_MSGS = 40;

//순수 함수 - mock 데이터로도 호출 가능 (eval 스크립트용)
//라이브(buildUserPrompt)와 eval(run-golden) 공유 → 윈도우를 여기 두어 양쪽 동일 규칙
export function buildUserPromptFromMessages(
  messages: { sender: string; content: string }[],
  reason?: SpeakingReason, // ← Step 3/A: cue 주입 (옵셔널 → 라이브는 안 넘김 → 불변)
): string {
  const head = reason ? `[Speaking reason: ${reason}]\n` : "";
  if (messages.length === 0) {
    return `${head}[No messages yet. The discussion is about to begin.]`;
  }

  const windowed = messages.slice(-TRANSCRIPT_WINDOW_MSGS);
  const transcript = windowed
    .map((m) => `${m.sender}: ${m.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");

  return `${head}Discussion so far:\n${transcript}\n\n---\nNow respond as Alex with your next single message.`;
}
