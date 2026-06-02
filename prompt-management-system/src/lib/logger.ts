import pino, { type LoggerOptions } from "pino";

// Per CLAUDE.md §19 — use pino, never console.log in production paths.
// Honor LOG_LEVEL env var; default "info" for normal runs, "debug" for
// interactive development.
const opts: LoggerOptions = { level: process.env.LOG_LEVEL ?? "info" };
if (process.env.NODE_ENV !== "production") {
  opts.transport = {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "HH:MM:ss.l" },
  };
}
export const logger = pino(opts);
