// poolingDV — Information Pooling Rate DV (Step 19).
// byProfile.X/Y = 사람이 자기 unshared 정보를 얼마나 풀에 올렸나 (주 DV, byCandidate.revealedIds 기반)
// byProfile.Z   = Alex가 자기 Z를 얼마나 표면화했나 (별도 DV, aiSurfacedIds 기반 — passive-Z 정량화)
// 카운트는 저장이 아니라 표면화 ID 집합에서 파생(byCandidate와 동일 철학, race 회피).
// 분석에서 "누구든 표면화" union이 필요하면 두 원천 집합으로 언제든 재계산 가능.
import { Session } from "../models/Session.js";
import { TRAIT_DB, TRAIT_BY_ID, OPTIMAL_CANDIDATE, type Cand } from "./traitData.js";
import { aiSurfacedIds, humanSurfacedIds } from "./informationPools.js";

// [Step 62] first-surfacer 기록 — id별로 '더 작은 seq'가 이긴다.
// ⚠️ '먼저 쓴 쪽이 이김'이면 안 된다: AI 추출은 fire-and-forget이라 seq 7의 기록이
//    seq 6의 기록보다 먼저 도착할 수 있다. 조건에 seq 비교를 넣어 도착 순서와 무관하게 만든다.
export async function recordFirstSurfacer(
  sessionId: string,
  ids: string[],
  by: "human" | "ai",
  seq: number,
): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  let recorded = 0;
  for (const id of valid) {
    const path = `revealStats.firstBy.${id}`;
    const res = await Session.updateOne(
      {
        _id: sessionId,
        $or: [{ [path]: { $exists: false } }, { [`${path}.seq`]: { $gt: seq } }],
      },
      { $set: { [path]: { by, seq } } },
    );
    if (res.modifiedCount) recorded++;
  }
  return recorded; // 이 턴에서 '처음'으로 기록된 수
}

// AI(Alex) 표면화 집합 갱신 — 원자 $addToSet (동시 async 추출 안전, dedup)
export async function updateAiSurfaced(sessionId: string, ids: string[], seq: number): Promise<number> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return 0;
  await Session.updateOne(
    { _id: sessionId },
    { $addToSet: { "revealStats.aiSurfacedIds": { $each: valid } } },
  );
  return recordFirstSurfacer(sessionId, valid, "ai", seq); // [Step 62] 이 턴의 '처음' 수를 반환
}

// 프로필별 분류 (모듈 로드 시 1회 계산)
type Prof = "X" | "Y" | "Z";
const UNIQUE: Record<Prof, Set<string>> = { X: new Set(), Y: new Set(), Z: new Set() };
const SHARED: Set<string> = new Set();
for (const t of TRAIT_DB) {
  if (t.profiles.length === 1) UNIQUE[t.profiles[0] as Prof].add(t.id);
  else SHARED.add(t.id); // 이 데이터셋에서 shared = [X,Y,Z] (2-profile trait 없음)
}

export interface ProfileDV {
  totalUnique: number;
  uniqueRevealed: number;
  totalShared: number;
  sharedRevealed: number;
}
export interface PoolingDV {
  X: ProfileDV;
  Y: ProfileDV;
  Z: ProfileDV;
}

function dvFor(p: Prof, surfaced: Set<string>): ProfileDV {
  const uniq = UNIQUE[p];
  let uniqueRevealed = 0;
  for (const id of uniq) if (surfaced.has(id)) uniqueRevealed++;
  let sharedRevealed = 0;
  for (const id of SHARED) if (surfaced.has(id)) sharedRevealed++;
  return { totalUnique: uniq.size, uniqueRevealed, totalShared: SHARED.size, sharedRevealed };
}

// Decision Accuracy (Step 20) — 팀이 정답 C를 골랐나. 완료 전환 시 1회 계산·저장.
// teamChoice: 최빈값 (동률이면 null), unanimous: 전원 동일.
export interface DecisionAccuracy {
  optimal: Cand;
  teamChoice: string | null;
  correct: boolean;
  unanimous: boolean;
}

export function computeDecisionAccuracy(choices: string[]): DecisionAccuracy {
  const counts = choices.reduce<Record<string, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const tie = top.length > 1 && top[0]![1] === top[1]![1];
  const teamChoice = tie ? null : (top[0]?.[0] ?? null);
  const unanimous = choices.length > 0 && new Set(choices).size === 1;
  return {
    optimal: OPTIMAL_CANDIDATE,
    teamChoice,
    correct: teamChoice === OPTIMAL_CANDIDATE,
    unanimous,
  };
}

// X·Y = 사람 표면화 / Z = AI 표면화. 여기서 둘을 합치지 않는 것이 요점이다 —
// Alex의 기여율이 종속변인이라 사람 것과 섞이면 안 된다. 각 집합의 정의는
// informationPools 한 곳에서 읽는다.
export function computePoolingDV(revealStats: any): PoolingDV {
  return {
    X: dvFor("X", humanSurfacedIds(revealStats)),
    Y: dvFor("Y", humanSurfacedIds(revealStats)),
    Z: dvFor("Z", aiSurfacedIds(revealStats)),
  };
}
