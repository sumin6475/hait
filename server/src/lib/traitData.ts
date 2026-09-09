// traitData — 표준 트레잇 데이터셋 (Step 14a, S14 설계서 §1.1).
// hidden_profile_dataset.pdf 기준. 추출(poolingExtractor)·tally(poolingTally)·DV 공용 단일 출처.
// InfoItem 컬렉션은 세션에 시드되지 않아(DEAD) 코드 상수로 대체한다.
//
// 불변식 (깨지면 데이터 오타 — tests 참고):
//   후보별 전체: A·B·D = 4 pos / 6 neg, C = 7 pos / 3 neg (pooled 정답 = C).
//   Alex(Z)만:  A·B·D = 4 pos / 2 neg, C = 3 pos / 3 neg.

export type Cand = "A" | "B" | "C" | "D";
export type Valence = "pos" | "neg";
export interface Trait {
  id: string;
  candidate: Cand;
  valence: Valence;
  text: string;
  profiles: ("X" | "Y" | "Z")[];
}

//
// 트레잇 문구(text)는 참가자가 실제로 카드에서 읽는 문장과 **글자 단위로 같아야 한다**.
// 참가자 카드(client), Alex 카드(프롬프트 스냅샷), 여기 — 세 벌이 따로 놀면서
// T-C2-047 turn 9가 죽었다: Alex는 자기 카드 문구대로 C_p6를 두 번 말했는데
// 매처는 여기 있던 짧은 판본을 찾고 있었다. 세 벌이 같은지는 test-intervention-v2가 검사한다.
// 매칭 구문은 traitKeywordRegistry의 core/variants가 따로 갖는다 — text는 표시 전용이다.
export const TRAIT_DB: Trait[] = [
  // A — 긍정 4(공유) / 부정 6(분산)
  { id: "A_p1", candidate: "A", valence: "pos", text: "Has a very good sense for recognizing dangerous situations", profiles: ["X", "Y", "Z"] },
  { id: "A_p2", candidate: "A", valence: "pos", text: "Has a good overview of complex contexts", profiles: ["X", "Y", "Z"] },
  { id: "A_p3", candidate: "A", valence: "pos", text: "Has excellent spatial awareness", profiles: ["X", "Y", "Z"] },
  { id: "A_p4", candidate: "A", valence: "pos", text: "Is very well organized", profiles: ["X", "Y", "Z"] },
  { id: "A_n1", candidate: "A", valence: "neg", text: "Sometimes does not tolerate criticism", profiles: ["X"] },
  { id: "A_n2", candidate: "A", valence: "neg", text: "Is sometimes a bit hectic", profiles: ["X"] },
  { id: "A_n3", candidate: "A", valence: "neg", text: "Is considered a show-off", profiles: ["Y"] },
  { id: "A_n4", candidate: "A", valence: "neg", text: "Is not open to new ideas", profiles: ["Y"] },
  { id: "A_n5", candidate: "A", valence: "neg", text: "Is unfriendly", profiles: ["Z"] },
  { id: "A_n6", candidate: "A", valence: "neg", text: "Transmits restlessness", profiles: ["Z"] },
  // B — 긍정 4(공유) / 부정 6(분산)
  { id: "B_p1", candidate: "B", valence: "pos", text: "Keeps a cool head in crisis situations", profiles: ["X", "Y", "Z"] },
  { id: "B_p2", candidate: "B", valence: "pos", text: "You can rely on him/her 100%", profiles: ["X", "Y", "Z"] },
  { id: "B_p3", candidate: "B", valence: "pos", text: "Can assess weather conditions very well", profiles: ["X", "Y", "Z"] },
  { id: "B_p4", candidate: "B", valence: "pos", text: "Is good at multitasking", profiles: ["X", "Y", "Z"] },
  { id: "B_n1", candidate: "B", valence: "neg", text: "Is considered to be nagging", profiles: ["X"] },
  { id: "B_n2", candidate: "B", valence: "neg", text: "Is not considered very cooperative", profiles: ["X"] },
  { id: "B_n3", candidate: "B", valence: "neg", text: "Has a below-average memory for numbers", profiles: ["Y"] },
  { id: "B_n4", candidate: "B", valence: "neg", text: "Gossips about his/her coworkers", profiles: ["Y"] },
  { id: "B_n5", candidate: "B", valence: "neg", text: "Is considered arrogant", profiles: ["Z"] },
  { id: "B_n6", candidate: "B", valence: "neg", text: "Is sometimes abusive in tone", profiles: ["Z"] },
  // C — 긍정 7(분산) / 부정 3(공유)  ← 정답 (pooled 7:3)
  { id: "C_p1", candidate: "C", valence: "pos", text: "Can make the right decisions very quickly", profiles: ["X", "Y", "Z"] },
  { id: "C_p2", candidate: "C", valence: "pos", text: "Is stress resistant", profiles: ["X"] },
  { id: "C_p3", candidate: "C", valence: "pos", text: "Promotes a good atmosphere within the crew", profiles: ["X"] },
  { id: "C_p4", candidate: "C", valence: "pos", text: "Is very conscientious", profiles: ["Y"] },
  { id: "C_p5", candidate: "C", valence: "pos", text: "Is very skilled in dealing with complicated technology", profiles: ["Y"] },
  { id: "C_p6", candidate: "C", valence: "pos", text: "Puts the safety of people in his/her care above everything else", profiles: ["Z"] },
  { id: "C_p7", candidate: "C", valence: "pos", text: "Performs very well in terms of sustained attention", profiles: ["Z"] },
  { id: "C_n1", candidate: "C", valence: "neg", text: "Is not verbally skillful", profiles: ["X", "Y", "Z"] },
  { id: "C_n2", candidate: "C", valence: "neg", text: "Is considered egocentric", profiles: ["X", "Y", "Z"] },
  { id: "C_n3", candidate: "C", valence: "neg", text: "Is reluctant to take part in training", profiles: ["X", "Y", "Z"] },
  // D — 긍정 4(공유) / 부정 6(분산)
  { id: "D_p1", candidate: "D", valence: "pos", text: "Can react adequately to unforeseen events", profiles: ["X", "Y", "Z"] },
  { id: "D_p2", candidate: "D", valence: "pos", text: "Can concentrate very well", profiles: ["X", "Y", "Z"] },
  { id: "D_p3", candidate: "D", valence: "pos", text: "Is very resilient", profiles: ["X", "Y", "Z"] },
  { id: "D_p4", candidate: "D", valence: "pos", text: "Is very responsible", profiles: ["X", "Y", "Z"] },
  { id: "D_n1", candidate: "D", valence: "neg", text: "Is considered arrogant", profiles: ["X"] },
  { id: "D_n2", candidate: "D", valence: "neg", text: "Is not very well suited for leading a team", profiles: ["X"] },
  { id: "D_n3", candidate: "D", valence: "neg", text: "Is considered to be a know-all", profiles: ["Y"] },
  { id: "D_n4", candidate: "D", valence: "neg", text: "Is quick-tempered", profiles: ["Y"] },
  { id: "D_n5", candidate: "D", valence: "neg", text: "Is considered moody", profiles: ["Z"] },
  { id: "D_n6", candidate: "D", valence: "neg", text: "Has strong prejudices", profiles: ["Z"] },
];

export const ALEX_Z_IDS = TRAIT_DB.filter((t) => t.profiles.includes("Z")).map((t) => t.id);
// [Step 36] Alex 고유 패 = Z에만 있는(공유 안 된) trait. Z-drip 모집단 — pos-first 정렬이면
// 고유 긍정 = C_p6/C_p7 먼저 → 고유 부정 = A/B/D의 n5/n6 = hidden-profile 보정 순서 보장.
// (shared 긍정은 humans가 깔게 둠 — 그게 안 깔려도 drip이 distractor 쪽으로 새지 않도록 unique-only.)
export const ALEX_Z_UNIQUE_IDS = TRAIT_DB.filter(
  (t) => t.profiles.length === 1 && t.profiles[0] === "Z",
).map((t) => t.id);
export const TRAIT_BY_ID = new Map(TRAIT_DB.map((t) => [t.id, t]));
export const OPTIMAL_CANDIDATE: Cand = "C"; // pooled 7:3 정답 (Step 20)
