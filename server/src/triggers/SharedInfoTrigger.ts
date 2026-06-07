// 2026-06-01 사용 안함 : shared info 정보로 트리거를 다르게 하면 2X2 조건의 효과를 제대로 볼 수 없음.
import type { Trigger, SessionContext } from "./types.js";

//shared info 평가 트리거 (나중에 구현)
export const sharedInfoTrigger: Trigger = {
  name: "shared-info",
  shouldFire(ctx: SessionContext) {
    //로직 나중에 구현
    return false;
  },
};
