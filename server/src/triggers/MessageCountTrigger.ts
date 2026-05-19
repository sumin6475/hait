import type { Trigger, SessionContext } from "./types.js";
import { TRIGGER_CONFIG } from "../config/triggers.js";

//매 N개 사람 메시지 후 평가
export const messageCountTrigger: Trigger = {
  name: "message-count",
  shouldFire: (ctx: SessionContext) => {
    return ctx.messagesSinceLastAI >= TRIGGER_CONFIG.MESSAGE_COUNT_THRESHOLD;
  },
};
