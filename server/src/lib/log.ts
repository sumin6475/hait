// 경량 레벨 로거 — LOG_LEVEL env (debug<info<warn<error), 기본 info.
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;
const LEVEL: Level =
  (process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : "info";
const on = (l: Level) => ORDER[l] >= ORDER[LEVEL];
export const log = {
  debug: (...a: unknown[]) => on("debug") && console.log(...a),
  info: (...a: unknown[]) => on("info") && console.log(...a),
  warn: (...a: unknown[]) => on("warn") && console.warn(...a),
  error: (...a: unknown[]) => on("error") && console.error(...a),
};
