// poolingTally — revealStats 갱신($addToSet) + Alex-시점 tally 계산 + task 턴 주입 블록 포맷 (Step 14a).
// tally = Alex의 Z(상시 보유) ∪ 표면화된 것(revealedIds) — on-table만, hidden-profile 보존, 조건 무관(통제).
import { Session } from "../models/Session.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";

// (a) 갱신: 원자적 $addToSet — 동시 async 추출에 안전, dedup 자동.
// 카운트는 저장하지 않고 읽을 때 revealedIds에서 파생한다 (read-modify-write 레이스 회피).
// [Step 36] 새로 추가된 distinct id 수 반환 (no-yield 추적용). best-effort: 동시 추출이 같은 id를
// 둘 다 'new'로 셀 수 있으나 over-count = yield 과다 = 소진 under-trigger = 안전한 방향.
export async function updateRevealStats(sessionId: string, ids: string[]): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return 0;
  const sess = await Session.findById(sessionId).select("revealStats").lean();
  const rs = (sess as any)?.revealStats;
  const already = new Set<string>();
  for (const c of CANDS) for (const id of rs?.byCandidate?.[c]?.revealedIds ?? []) already.add(id);
  const newIds = new Set(valid.filter((id) => !already.has(id)));
  const add: Record<string, { $each: string[] }> = {};
  for (const id of valid) {
    const c = TRAIT_BY_ID.get(id)!.candidate;
    const path = `revealStats.byCandidate.${c}.revealedIds`;
    (add[path] ??= { $each: [] }).$each.push(id);
  }
  await Session.updateOne({ _id: sessionId }, { $addToSet: add });
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
  for (const c of CANDS) {
    const revealed: string[] = revealStats?.byCandidate?.[c]?.revealedIds ?? [];
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

// 표면화된 distinct trait 총수 (사람 revealedIds ∪ AI aiSurfacedIds) — summary 게이트 가드① (Step 22)
export function countSurfaced(revealStats: any): number {
  const ids = new Set<string>();
  for (const c of CANDS) {
    for (const id of revealStats?.byCandidate?.[c]?.revealedIds ?? []) ids.add(id);
  }
  for (const id of revealStats?.aiSurfacedIds ?? []) ids.add(id);
  return ids.size;
}

// [Step 30] 후보별 깔린 정보 수(사람 revealedIds ∪ AI aiSurfaced 중 해당 후보) 최소 후보.
// 동률 → tally 비율 낮은 쪽(덜 검증된 쪽) → 그래도 동률이면 알파벳. (C4 callout 지정 후보용, 순수 함수)
export function leastCoveredCandidate(revealStats: any): Cand {
  const counts = {} as Record<Cand, number>;
  const ai: string[] = revealStats?.aiSurfacedIds ?? [];
  for (const c of CANDS) {
    const ids = new Set<string>(revealStats?.byCandidate?.[c]?.revealedIds ?? []);
    for (const id of ai) if (TRAIT_BY_ID.get(id)?.candidate === c) ids.add(id);
    counts[c] = ids.size;
  }
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
  const out: Record<Cand, number> = { A: 0, B: 0, C: 0, D: 0 };
  const ai: string[] = revealStats?.aiSurfacedIds ?? [];
  for (const c of CANDS) {
    const set = new Set<string>(revealStats?.byCandidate?.[c]?.revealedIds ?? []);
    for (const id of ai) if (TRAIT_BY_ID.get(id)?.candidate === c) set.add(id);
    out[c] = set.size;
  }
  return out;
}

// [Step 37] 도입(≥1)됐지만 얕은(<threshold) 후보 = 조기 이탈 방지 대상.
// count===0(미도입)은 leader의 정당한 다음 의제라 제외 → {c | 1 <= count(c) < threshold}.
export function underCoveredCandidates(revealStats: any, threshold: number): Cand[] {
  const by = surfacedByCandidate(revealStats);
  return CANDS.filter((c) => by[c] >= 1 && by[c] < threshold);
}

// (c) 포맷: task 턴 주입 블록. 숫자는 "읽고 추론"용 — 발화 금지(OUTPUT_DISCIPLINE와 양립).
export function formatTally(t: Tally): string {
  const r = t.rows;
  const line = `A ${r.A.pos} strong / ${r.A.neg} rough · B ${r.B.pos} / ${r.B.neg} · C ${r.C.pos} / ${r.C.neg} · D ${r.D.pos} / ${r.D.neg}`;
  const lead = t.leader ? ` ${t.leader} has the best balance right now.` : "";
  return `[Where things stand from what's on the table — your own notes plus what the team has shared: ${line}.${lead} Reason from this standing; do not recite these numbers.]`;
}
