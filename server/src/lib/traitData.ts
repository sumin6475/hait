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

export const TRAIT_DB: Trait[] = [
  // A — 긍정 4(공유) / 부정 6(분산)
  { id: "A_p1", candidate: "A", valence: "pos", text: "has a very good sense for recognizing dangerous situations", profiles: ["X", "Y", "Z"] },
  { id: "A_p2", candidate: "A", valence: "pos", text: "has a good overview of complex contexts", profiles: ["X", "Y", "Z"] },
  { id: "A_p3", candidate: "A", valence: "pos", text: "has excellent spatial awareness", profiles: ["X", "Y", "Z"] },
  { id: "A_p4", candidate: "A", valence: "pos", text: "is very well organized", profiles: ["X", "Y", "Z"] },
  { id: "A_n1", candidate: "A", valence: "neg", text: "does not tolerate criticism", profiles: ["X"] },
  { id: "A_n2", candidate: "A", valence: "neg", text: "is sometimes a bit hectic", profiles: ["X"] },
  { id: "A_n3", candidate: "A", valence: "neg", text: "is a show-off", profiles: ["Y"] },
  { id: "A_n4", candidate: "A", valence: "neg", text: "is not open to new ideas", profiles: ["Y"] },
  { id: "A_n5", candidate: "A", valence: "neg", text: "is unfriendly", profiles: ["Z"] },
  { id: "A_n6", candidate: "A", valence: "neg", text: "transmits restlessness", profiles: ["Z"] },
  // B — 긍정 4(공유) / 부정 6(분산)
  { id: "B_p1", candidate: "B", valence: "pos", text: "keeps a cool head in crisis situations", profiles: ["X", "Y", "Z"] },
  { id: "B_p2", candidate: "B", valence: "pos", text: "you can rely on 100%", profiles: ["X", "Y", "Z"] },
  { id: "B_p3", candidate: "B", valence: "pos", text: "can assess weather conditions very well", profiles: ["X", "Y", "Z"] },
  { id: "B_p4", candidate: "B", valence: "pos", text: "is good at multitasking", profiles: ["X", "Y", "Z"] },
  { id: "B_n1", candidate: "B", valence: "neg", text: "is considered nagging", profiles: ["X"] },
  { id: "B_n2", candidate: "B", valence: "neg", text: "is not very cooperative", profiles: ["X"] },
  { id: "B_n3", candidate: "B", valence: "neg", text: "has a below-average memory for numbers", profiles: ["Y"] },
  { id: "B_n4", candidate: "B", valence: "neg", text: "gossips about coworkers", profiles: ["Y"] },
  { id: "B_n5", candidate: "B", valence: "neg", text: "is considered arrogant", profiles: ["Z"] },
  { id: "B_n6", candidate: "B", valence: "neg", text: "is sometimes abusive in tone", profiles: ["Z"] },
  // C — 긍정 7(분산) / 부정 3(공유)  ← 정답 (pooled 7:3)
  { id: "C_p1", candidate: "C", valence: "pos", text: "can make the right decisions very quickly", profiles: ["X", "Y", "Z"] },
  { id: "C_p2", candidate: "C", valence: "pos", text: "is stress resistant", profiles: ["X"] },
  { id: "C_p3", candidate: "C", valence: "pos", text: "promotes a good atmosphere within the crew", profiles: ["X"] },
  { id: "C_p4", candidate: "C", valence: "pos", text: "is very conscientious", profiles: ["Y"] },
  { id: "C_p5", candidate: "C", valence: "pos", text: "is skilled in dealing with complicated technology", profiles: ["Y"] },
  { id: "C_p6", candidate: "C", valence: "pos", text: "puts the safety of people above everything", profiles: ["Z"] },
  { id: "C_p7", candidate: "C", valence: "pos", text: "performs very well in sustained attention", profiles: ["Z"] },
  { id: "C_n1", candidate: "C", valence: "neg", text: "is not verbally skillful", profiles: ["X", "Y", "Z"] },
  { id: "C_n2", candidate: "C", valence: "neg", text: "is considered egocentric", profiles: ["X", "Y", "Z"] },
  { id: "C_n3", candidate: "C", valence: "neg", text: "is reluctant to take part in training", profiles: ["X", "Y", "Z"] },
  // D — 긍정 4(공유) / 부정 6(분산)
  { id: "D_p1", candidate: "D", valence: "pos", text: "can react adequately to unforeseen events", profiles: ["X", "Y", "Z"] },
  { id: "D_p2", candidate: "D", valence: "pos", text: "can concentrate very well", profiles: ["X", "Y", "Z"] },
  { id: "D_p3", candidate: "D", valence: "pos", text: "is very resilient", profiles: ["X", "Y", "Z"] },
  { id: "D_p4", candidate: "D", valence: "pos", text: "is very responsible", profiles: ["X", "Y", "Z"] },
  { id: "D_n1", candidate: "D", valence: "neg", text: "is considered arrogant", profiles: ["X"] },
  { id: "D_n2", candidate: "D", valence: "neg", text: "is not well suited for leading a team", profiles: ["X"] },
  { id: "D_n3", candidate: "D", valence: "neg", text: "is considered a know-all", profiles: ["Y"] },
  { id: "D_n4", candidate: "D", valence: "neg", text: "is quick-tempered", profiles: ["Y"] },
  { id: "D_n5", candidate: "D", valence: "neg", text: "is considered moody", profiles: ["Z"] },
  { id: "D_n6", candidate: "D", valence: "neg", text: "has strong prejudices", profiles: ["Z"] },
];

export const ALEX_Z_IDS = TRAIT_DB.filter((t) => t.profiles.includes("Z")).map((t) => t.id);
export const TRAIT_BY_ID = new Map(TRAIT_DB.map((t) => [t.id, t]));
