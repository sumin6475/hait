import { createHash } from "node:crypto";
import snapshot from "../prompts/route-prompts.snapshot.v1.json" with { type: "json" };
import legacyConditionMetadata from "./compiled-prompts.json" with { type: "json" };
import type { ConditionCode, RouteKind } from "../types.js";

interface PromptSnapshotEntry {
  condition: string;
  routeKind: string;
  version: string;
  hash: string;
  prompt: string;
}

const entries = snapshot.prompts as Record<string, PromptSnapshotEntry>;

// Fail at process start rather than silently serving a partially edited prompt registry.
for (const [key, entry] of Object.entries(entries)) {
  const actual = createHash("sha256").update(entry.prompt).digest("hex");
  if (entry.hash !== actual) throw new Error(`Prompt hash mismatch for ${key}`);
}
if (Object.keys(entries).length !== 30) {
  throw new Error(`Expected 30 static route prompts, received ${Object.keys(entries).length}`);
}

export interface ResolvedPrompt {
  promptKey: string;
  promptVersion: string;
  promptHash: string;
  systemPrompt: string;
}

export function getRoutePrompt(conditionCode: ConditionCode, routeKind: RouteKind): ResolvedPrompt {
  if (conditionCode === "CTRL") throw new Error("CTRL must never resolve an AI prompt");
  const promptKey = `${conditionCode}.${routeKind}.v1`;
  const entry = entries[promptKey];
  if (!entry) throw new Error(`Missing static route prompt: ${promptKey}`);
  return {
    promptKey,
    promptVersion: entry.version,
    promptHash: entry.hash,
    systemPrompt: entry.prompt,
  };
}

export function listRoutePromptKeys(): string[] {
  return Object.keys(entries).sort();
}

export function getRoutePromptRegistryView() {
  const conditionNames: Record<string, string> = {
    C1: "peer_xai",
    C2: "leader_xai",
    C3: "peer_aci",
    C4: "leader_aci",
  };
  const conditions: Record<string, any> = {};
  for (const [key, entry] of Object.entries(entries)) {
    const condition = entry.condition;
    conditions[condition] ??= {
      version: entry.version,
      sourceCondition: conditionNames[condition],
      // The old condition prompt is not executed; its critic audit remains useful in admin UI.
      audit: (legacyConditionMetadata as any).conditions?.[condition]?.audit ?? null,
      routes: {},
    };
    conditions[condition].routes[entry.routeKind] = {
      promptKey: key,
      version: entry.version,
      hash: entry.hash,
      prompt: entry.prompt,
    };
  }
  return {
    schemaVersion: snapshot.schemaVersion,
    sourceVersion: snapshot.sourceVersion,
    conditions,
  };
}
