// poolingDV — Information Pooling Rate DV (Step 19).
// byProfile.X/Y = 사람이 자기 unshared 정보를 얼마나 풀에 올렸나 (주 DV, byCandidate.revealedIds 기반)
// byProfile.Z   = Alex가 자기 Z를 얼마나 표면화했나 (별도 DV, aiSurfacedIds 기반 — passive-Z 정량화)
// 카운트는 저장이 아니라 표면화 ID 집합에서 파생(byCandidate와 동일 철학, race 회피).
// 분석에서 "누구든 표면화" union이 필요하면 두 원천 집합으로 언제든 재계산 가능.
import { Session } from "../models/Session.js";
import { TRAIT_DB, TRAIT_BY_ID } from "./traitData.js";

// AI(Alex) 표면화 집합 갱신 — 원자 $addToSet (동시 async 추출 안전, dedup)
export async function updateAiSurfaced(sessionId: string, ids: string[]): Promise<void> {
  const valid = ids.filter((id) => TRAIT_BY_ID.has(id));
  if (!valid.length) return;
  await Session.updateOne(
    { _id: sessionId },
    { $addToSet: { "revealStats.aiSurfacedIds": { $each: valid } } },
  );
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

// X·Y = 사람 표면화(byCandidate.revealedIds union) / Z = AI 표면화(aiSurfacedIds)
export function computePoolingDV(revealStats: any): PoolingDV {
  const human = new Set<string>();
  for (const c of ["A", "B", "C", "D"]) {
    for (const id of revealStats?.byCandidate?.[c]?.revealedIds ?? []) human.add(id);
  }
  const ai = new Set<string>(revealStats?.aiSurfacedIds ?? []);
  return { X: dvFor("X", human), Y: dvFor("Y", human), Z: dvFor("Z", ai) };
}
