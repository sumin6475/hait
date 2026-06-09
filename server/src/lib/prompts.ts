//AI prompt 빌더
//Common Prompt + Z-profile
//condition별 layer 2 prompt 분기 (XAI/ACI × Leader/Peer)
import { Message } from "../models/Message.js";
import { ConditionCode } from "../types.js";
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
//전체 세션 메시지를 seq 순서대로 sender: content transcript로 직렬화
//줄바꿈/연속 공백은 단일 공백으로 치환 (transcript 라인 무결성)
export async function buildUserPrompt(sessionId: string): Promise<string> {
  const messages = await Message.find({ sessionId }).sort({ seq: 1 });
  return buildUserPromptFromMessages(messages);
}

//순수 함수 - mock 데이터로도 호출 가능 (eval 스크립트용)
export function buildUserPromptFromMessages(
  messages: { sender: string; content: string }[],
): string {
  if (messages.length === 0) {
    return "[No messages yet. The discussion is about to begin.]";
  }

  const transcript = messages
    .map((m) => `${m.sender}: ${m.content.replace(/\s+/g, " ").trim()}`)
    .join("\n");

  return `Discussion so far:\n${transcript}\n\n---\nNow respond as Alex with your next single message.`;
}
