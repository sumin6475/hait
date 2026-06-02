// Shared helpers for the Phase 3 scripts.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../src/lib/logger.js";
import type { ValidatedPaper } from "../src/schemas/paper.schema.js";

export function loadDotEnv(): void {
  const p = resolve(process.cwd(), ".env");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function preflight(): void {
  const ak = process.env.ANTHROPIC_API_KEY;
  if (!ak || ak.startsWith("sk-ant-api03-REPLACE")) {
    throw new Error(
      "ANTHROPIC_API_KEY missing in .env. Replace the placeholder before running Phase 3.",
    );
  }
}

export function loadKnowledgeBase(): ValidatedPaper[] {
  const path = resolve(process.cwd(), "knowledge_base/citation_index.json");
  if (!existsSync(path)) {
    throw new Error(
      `Knowledge base not found at ${path}. Run \`pnpm run scout\` first (Phase 2).`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, ValidatedPaper>;
  const entries = Object.values(raw);
  if (entries.length < 10) {
    logger.warn({ kb_size: entries.length }, "loadKnowledgeBase.thin_kb");
  }
  return entries;
}
