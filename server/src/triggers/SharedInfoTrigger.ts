import type { Trigger, SessionContext } from "./types.js";

//shared info 평가 트리거 (나중에 구현)
export const sharedInfoTrigger: Trigger = {
  name: "shared-info",
  shouldFire(ctx: SessionContext) {
    //로직 나중에 구현
    return false;
  },
};
