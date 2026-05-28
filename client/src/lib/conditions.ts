import type { ConditionCode } from "./api";

//5개 조건 코드 (UI 표시 순서)
export const CONDITION_CODES: ConditionCode[] = ["C1", "C2", "C3", "C4", "CTRL"];

//조건별 사람-읽기용 라벨
//IRB 프로토콜 기준 (2×2 factorial: AI status × communication strategy)
export const conditionLabel: Record<ConditionCode, string> = {
  C1: "Peer × XAI",
  C2: "Leader × XAI",
  C3: "Peer × ACI",
  C4: "Leader × ACI",
  CTRL: "Control",
};

//조건의 2×2 factorial 의미
//status: AI가 leader인지 peer인지 (CTRL은 AI 없음 → null)
//strategy: XAI(explanatory) vs ACI(adaptive) (CTRL은 null)
export const conditionMeta: Record<
  ConditionCode,
  { status: "leader" | "peer" | null; strategy: "xai" | "aci" | null }
> = {
  C1: { status: "peer", strategy: "xai" },
  C2: { status: "leader", strategy: "xai" },
  C3: { status: "peer", strategy: "aci" },
  C4: { status: "leader", strategy: "aci" },
  CTRL: { status: null, strategy: null },
};
