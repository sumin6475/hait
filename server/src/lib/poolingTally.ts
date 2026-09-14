// poolingTally — 사람 메시지가 보드에 남기는 것을 쓴다($addToSet).
// 보드를 *읽는* 정의는 전부 informationPools에 있다 — 여기 있던 여섯 벌의 손복사본은 지웠다.
import { Session } from "../models/Session.js";
import { TRAIT_BY_ID, type Cand } from "./traitData.js";
import { TRIGGER_CONFIG } from "../config/triggers.js"; // [Step 39] DEPTH_LOOKBACK_MSGS
import { recordFirstSurfacer } from "./poolingDV.js";
import { humanSurfacedIds } from "./informationPools.js";

// (a) 갱신: 원자적 $addToSet — 동시 async 추출에 안전, dedup 자동.
// 카운트는 저장하지 않고 읽을 때 revealedIds에서 파생한다 (read-modify-write 레이스 회피).
// [Step 36] 새로 추가된 distinct id 수 반환 (no-yield 추적용). best-effort: 동시 추출이 같은 id를
// 둘 다 'new'로 셀 수 있으나 over-count = yield 과다 = 소진 under-trigger = 안전한 방향.
export async function updateRevealStats(
  sessionId: string,
  ids: string[],
  seq: number,
): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return 0;
  const sess = await Session.findById(sessionId).select("revealStats").lean();
  const rs = (sess as any)?.revealStats;
  const already = humanSurfacedIds(rs);
  const newIds = new Set(valid.filter((id) => !already.has(id)));
  const add: Record<string, { $each: string[] }> = {};
  for (const id of valid) {
    const c = TRAIT_BY_ID.get(id)!.candidate;
    const path = `revealStats.byCandidate.${c}.revealedIds`;
    (add[path] ??= { $each: [] }).$each.push(id);
  }
  // Seed the separate human-confirmed layer from legacy human surface data on first write.
  add["revealStats.humanConfirmedIds"] = { $each: [...new Set([...already, ...valid])] };
  await Session.updateOne({ _id: sessionId }, { $addToSet: add });
  const candidates = new Set(valid.map((id) => TRAIT_BY_ID.get(id)!.candidate));
  if (candidates.size === 1) {
    await Session.updateOne(
      {
        _id: sessionId,
        $or: [
          { "revealStats.lastHumanDiscussion.seq": { $exists: false } },
          { "revealStats.lastHumanDiscussion.seq": { $lt: seq } },
        ],
      },
      {
        $set: {
          "revealStats.lastHumanDiscussion": { candidate: [...candidates][0], seq },
        },
      },
    );
  }
  await recordFirstSurfacer(sessionId, valid, "human", seq); // [Step 62]
  return newIds.size;
}

// [Step 39] 최근 '사람' 메시지에서 지금 논의 중인 후보 1개 탐지 (정규식 · 순수함수).
// 최신→과거로 사람 메시지를 lookback개까지 보되, 후보 언급이 '처음' 나온 메시지가 결과를 결정:
//   distinct 후보 1개 → 그 후보 / 2개+ (비교 중) → null(광범위 → depth 끔) / 언급 0 → 더 과거로.
// 끝까지 언급 없으면 null. 한계: 문장 첫머리 관사 "A "가 후보로 오탐 가능(수용 — 이 과제는 후보를 글자로 부름).
const CAND_EXPLICIT = /\bCandidate\s+([ABCD])\b/gi; // "Candidate A" (대소문자 무관)
const CAND_TOKEN = /\b([ABCD])(?:'s)?\b/g; // 대문자 단독 토큰 + 소유격 ("A", "C's") — 소문자 관사 "a" 제외
export function currentTopicCandidate(
  msgs: { sender: string; content: string }[],
  aiLabel = "Alex",
  lookback = TRIGGER_CONFIG.DEPTH_LOOKBACK_MSGS,
): Cand | null {
  const recent = msgs
    .filter((m) => m.sender !== aiLabel)
    .slice(-lookback)
    .reverse(); // 사람만, 최신부터
  for (const m of recent) {
    const found = new Set<Cand>();
    let mm: RegExpExecArray | null;
    CAND_EXPLICIT.lastIndex = 0;
    while ((mm = CAND_EXPLICIT.exec(m.content))) found.add(mm[1]!.toUpperCase() as Cand);
    CAND_TOKEN.lastIndex = 0;
    while ((mm = CAND_TOKEN.exec(m.content))) found.add(mm[1]! as Cand);
    if (found.size === 0) continue; // 언급 없음 → 더 과거로
    return found.size === 1 ? [...found][0]! : null; // 1개 → 그 후보 / 2개+ → 비교 → null
  }
  return null;
}
