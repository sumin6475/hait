// poolingTally — revealStats 갱신($addToSet) + Alex-시점 tally 계산 + task 턴 주입 블록 포맷 (Step 14a).
// tally = Alex의 Z(상시 보유) ∪ 표면화된 것(revealedIds) — on-table만, hidden-profile 보존, 조건 무관(통제).
import { Session } from "../models/Session.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";
import { TRIGGER_CONFIG } from "../config/triggers.js"; // [Step 39] DEPTH_LOOKBACK_MSGS
import { recordFirstSurfacer } from "./poolingDV.js";
import {
  allSurfacedIds,
  coverageByCandidate,
  humanSurfacedIds,
} from "./informationPools.js";

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

// (b) 계산: 후보별 distinct pos/neg (Z ∪ revealed). leader = 최고 pos/neg 비율, 동점이면 null.
export interface Tally {
  rows: Record<Cand, { pos: number; neg: number }>;
  leader: Cand | null;
}

const CANDS: Cand[] = ["A", "B", "C", "D"];

export function computeTally(revealStats: any): Tally {
  const rows = {} as Tally["rows"];
  const revealed = humanSurfacedIds(revealStats);
  for (const c of CANDS) {
    const ids = new Set(
      [...ALEX_Z_IDS, ...revealed].filter((id) => TRAIT_BY_ID.get(id)?.candidate === c),
    );
    let pos = 0;
    let neg = 0;
    for (const id of ids) {
      if (TRAIT_BY_ID.get(id)!.valence === "pos") pos++;
      else neg++;
    }
    rows[c] = { pos, neg };
  }
  // leader: 최고 비율 1명 (Z만으로도 neg≥2 보장 → div0 없음). 동점이면 null.
  let leader: Cand | null = null;
  let best = -1;
  let tied = false;
  for (const c of CANDS) {
    const ratio = rows[c].pos / rows[c].neg;
    if (ratio > best) {
      best = ratio;
      leader = c;
      tied = false;
    } else if (ratio === best) {
      tied = true;
    }
  }
  if (tied) leader = null;
  return { rows, leader };
}

// 표면화된 distinct trait 총수 — summary 게이트 가드① (Step 22).
// 보드의 정의는 informationPools 한 곳에만 있다.
export function countSurfaced(revealStats: any): number {
  return allSurfacedIds(revealStats).size;
}

// [Step 30] 후보별 깔린 정보 수(사람 revealedIds ∪ AI aiSurfaced 중 해당 후보) 최소 후보.
// 동률 → tally 비율 낮은 쪽(덜 검증된 쪽) → 그래도 동률이면 알파벳. (C4 callout 지정 후보용, 순수 함수)
export function leastCoveredCandidate(revealStats: any): Cand {
  const counts = coverageByCandidate(revealStats);
  const t = computeTally(revealStats);
  return [...CANDS].sort(
    (a, b) =>
      counts[a] - counts[b] ||
      t.rows[a].pos / t.rows[a].neg - t.rows[b].pos / t.rows[b].neg ||
      a.localeCompare(b),
  )[0]!;
}

// [Step 37] Depth 데이터 훅 — 후보별 distinct 표면화 수 (사람 revealedIds ∪ AI aiSurfaced 중 해당 후보).
// Alex 미발화 Z 패는 revealedIds·aiSurfacedIds 어디에도 없어 자동 제외 = "테이블에 올라온 것"만 카운트.
export function surfacedByCandidate(revealStats: any): Record<Cand, number> {
  return coverageByCandidate(revealStats);
}

// [Step 45] 양면 floor — 네 후보 각각 surfaced에 pos≥1 ∧ neg≥1 표면화됐나 (수렴 마무리 게이트용).
// surfacedByCandidate와 동일 소스(사람 revealedIds ∪ AI aiSurfaced) — Alex 미발화 Z는 자동 제외.
// 소진 총개수는 countSurfaced(rs) 재사용 (별도 totalSurfaced 불필요 — 동일 정의).
export function floorMet(revealStats: any): boolean {
  const sides = {} as Record<Cand, { pos: boolean; neg: boolean }>;
  for (const c of CANDS) sides[c] = { pos: false, neg: false };
  for (const id of allSurfacedIds(revealStats)) {
    const trait = TRAIT_BY_ID.get(id)!;
    sides[trait.candidate][trait.valence] = true;
  }
  // 한 후보라도 한쪽 면이 비면 floor 미달
  return CANDS.every((c) => sides[c].pos && sides[c].neg);
}

// [Step 37] 도입(≥1)됐지만 얕은(<threshold) 후보 = 조기 이탈 방지 대상.
// count===0(미도입)은 leader의 정당한 다음 의제라 제외 → {c | 1 <= count(c) < threshold}.
// [Step 39] depthNote가 currentTopicCandidate로 교체되어 미사용화 — 보존만(다른 분석 진입점 가능성).
export function underCoveredCandidates(revealStats: any, threshold: number): Cand[] {
  const by = surfacedByCandidate(revealStats);
  return CANDS.filter((c) => by[c] >= 1 && by[c] < threshold);
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

// [Step 65] 사람 메시지에 후보가 '하나라도' 언급됐는가.
// currentTopicCandidate는 '정확히 1개'일 때만 값을 내므로 2개 이상(비교)을 못 잡는다.
// 오프닝 창을 닫을지만 판단하는 용도 — 정규식은 위와 동일한 것을 재사용한다.
export function anyCandidateMentioned(
  msgs: { sender: string; content: string }[],
  aiLabel = "Alex",
  lookback = TRIGGER_CONFIG.DEPTH_LOOKBACK_MSGS,
): boolean {
  const recent = msgs.filter((m) => m.sender !== aiLabel).slice(-lookback);
  for (const m of recent) {
    CAND_EXPLICIT.lastIndex = 0;
    if (CAND_EXPLICIT.test(m.content)) return true;
    CAND_TOKEN.lastIndex = 0;
    if (CAND_TOKEN.test(m.content)) return true;
  }
  return false;
}

// (c) 포맷: 주입 블록. 숫자는 "읽고 추론"용 — 발화 금지(OUTPUT_DISCIPLINE와 양립).
// [Step 51 §3.7] withLeader 옵션. task 턴은 리더 문장 포함(기본값 true = 기존 호출 불변).
// natural(peer 자기 read) 경로는 withLeader:false — 승자를 건네면 read가 verdict가 됨. 숫자만 준다.
export function formatTally(t: Tally, opts?: { withLeader?: boolean }): string {
  const r = t.rows;
  const line = `A ${r.A.pos} matches / ${r.A.neg} misses · B ${r.B.pos} / ${r.B.neg} · C ${r.C.pos} / ${r.C.neg} · D ${r.D.pos} / ${r.D.neg}`;
  const withLeader = opts?.withLeader ?? true;
  const lead =
    withLeader && t.leader ? ` ${t.leader} has the highest match-to-miss ratio right now.` : "";
  return `[Where things stand from what's on the table — your own notes plus what the team has shared: ${line}.${lead} Reason from this standing; do not recite these numbers.]`;
}
