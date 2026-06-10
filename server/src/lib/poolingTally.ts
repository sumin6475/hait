// poolingTally — revealStats 갱신($addToSet) + Alex-시점 tally 계산 + task 턴 주입 블록 포맷 (Step 14a).
// tally = Alex의 Z(상시 보유) ∪ 표면화된 것(revealedIds) — on-table만, hidden-profile 보존, 조건 무관(통제).
import { Session } from "../models/Session.js";
import { ALEX_Z_IDS, TRAIT_BY_ID, type Cand } from "./traitData.js";

// (a) 갱신: 원자적 $addToSet — 동시 async 추출에 안전, dedup 자동.
// 카운트는 저장하지 않고 읽을 때 revealedIds에서 파생한다 (read-modify-write 레이스 회피).
export async function updateRevealStats(sessionId: string, ids: string[]): Promise<void> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return;
  const add: Record<string, { $each: string[] }> = {};
  for (const id of valid) {
    const c = TRAIT_BY_ID.get(id)!.candidate;
    const path = `revealStats.byCandidate.${c}.revealedIds`;
    (add[path] ??= { $each: [] }).$each.push(id);
  }
  await Session.updateOne({ _id: sessionId }, { $addToSet: add });
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

// (c) 포맷: task 턴 주입 블록. 숫자는 "읽고 추론"용 — 발화 금지(OUTPUT_DISCIPLINE와 양립).
export function formatTally(t: Tally): string {
  const r = t.rows;
  const line = `A ${r.A.pos} strong / ${r.A.neg} rough · B ${r.B.pos} / ${r.B.neg} · C ${r.C.pos} / ${r.C.neg} · D ${r.D.pos} / ${r.D.neg}`;
  const lead = t.leader ? ` ${t.leader} has the best balance right now.` : "";
  return `[Where things stand from what's on the table — your own notes plus what the team has shared: ${line}.${lead} Reason from this standing; do not recite these numbers.]`;
}
