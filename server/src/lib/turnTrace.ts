import { log } from "./log.js";

type TurnTrace = {
  sessionId: string;
  sessionCode: string;
  seq: number;
  role: string;
  content: string;
  startedAt: number;
  events: string[];
  timer: NodeJS.Timeout;
};

const traces = new Map<string, TurnTrace>();
const TRACE_TTL_MS = 45_000;
const MESSAGE_LIMIT = 220;

function key(sessionId: string, seq: number) {
  return `${sessionId}:${seq}`;
}

function compact(value: string, limit = MESSAGE_LIMIT) {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > limit ? `${singleLine.slice(0, limit - 1)}…` : singleLine;
}

function emit(trace: TurnTrace, outcome: string) {
  const elapsedMs = Date.now() - trace.startedAt;
  const details = trace.events.length ? trace.events.map((event) => `  ${event}`).join("\n") : "  no routing detail recorded";
  log.info(
    `[turn] ${trace.sessionCode} #${trace.seq} ${trace.role} — ${outcome}\n` +
      `  message: “${compact(trace.content)}”\n` +
      `${details}\n` +
      `  elapsed: ${(elapsedMs / 1_000).toFixed(1)}s`,
  );
}

function clear(trace: TurnTrace) {
  clearTimeout(trace.timer);
  traces.delete(key(trace.sessionId, trace.seq));
}

/**
 * Accumulates routine routing diagnostics for one persisted human message.
 * Warnings and errors remain immediate; only normal-path information is
 * delayed so a live terminal is readable message-by-message.
 */
export function startTurnTrace(input: {
  sessionId: string;
  sessionCode: string;
  seq: number;
  role: string;
  content: string;
}) {
  const traceKey = key(input.sessionId, input.seq);
  const existing = traces.get(traceKey);
  if (existing) clear(existing);
  const trace = {
    ...input,
    startedAt: Date.now(),
    events: [],
    timer: undefined as unknown as NodeJS.Timeout,
  };
  trace.timer = setTimeout(() => {
    const pending = traces.get(traceKey);
    if (!pending) return;
    emit(pending, "pending (no terminal routing outcome within 45s)");
    clear(pending);
  }, TRACE_TTL_MS);
  traces.set(traceKey, trace);
}

export function traceTurnEvent(input: { sessionId: string; seq: number; detail: string }) {
  const trace = traces.get(key(input.sessionId, input.seq));
  if (trace) trace.events.push(compact(input.detail, 300));
}

export function finishTurnTrace(input: { sessionId: string; seq: number; outcome: string }) {
  const trace = traces.get(key(input.sessionId, input.seq));
  if (!trace) return;
  emit(trace, input.outcome);
  clear(trace);
}
