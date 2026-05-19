import type { Trigger, SessionContext } from "./types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";

//마지막 AI 발화 후 N초 경과 시 평가
export const timeIntervalTrigger: Trigger = {
  name: "time-interval",
  shouldFire(ctx: SessionContext) {
    if (ctx.secondsSinceLastAI === null) return false;
    return ctx.secondsSinceLastAI >= TRIGGER_CONFIG.TIME_INTERVAL_SECONDS;
  },
};
