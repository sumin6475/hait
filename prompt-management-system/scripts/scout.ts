// Phase 2 entry point. Runs Agent 0 (Scout) end-to-end.
// Per CLAUDE.md §10.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runScout } from "../src/agents/agent0_scout.js";
import { logger } from "../src/lib/logger.js";

// Minimal .env loader (avoids adding dotenv as a runtime dep).
function loadDotEnv(): void {
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

function preflight(): void {
  const ak = process.env.ANTHROPIC_API_KEY;
  if (!ak || ak.startsWith("sk-ant-api03-REPLACE")) {
    throw new Error("ANTHROPIC_API_KEY missing in .env. Replace the placeholder before running scout.");
  }
  const ok = process.env.OPENALEX_API_KEY;
  if (!ok || ok.startsWith("REPLACE")) {
    logger.warn(
      "OPENALEX_API_KEY missing or placeholder. Falling back to the polite pool via mailto; this may rate-limit.",
    );
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  preflight();
  await runScout();
}

main().catch((e) => {
  logger.error({ err: String(e), stack: e?.stack }, "scout.failed");
  process.exit(1);
});
