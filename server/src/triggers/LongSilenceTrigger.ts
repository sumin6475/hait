import type { Trigger, SessionContext } from "./types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";

//마지막 메시지 (누구든) 후 N초 정적 시 평가
export const longSilenceTrigger: Trigger = {
  name: "long-silence",
  shouldFire(ctx: SessionContext) {
    if (ctx.totalMessageCount === 0) return false;
    if (ctx.secondsSinceLastMessage === null) return false;
    return ctx.secondsSinceLastMessage >= TRIGGER_CONFIG.LONG_SILENCE_SECONDS;
  },
};
