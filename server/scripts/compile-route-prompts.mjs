import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const sourcePath = resolve(serverDir, "src/prompts/route-prompts.source.json");
const snapshotPath = resolve(serverDir, "src/prompts/route-prompts.snapshot.v1.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));

const requiredCommon = [
  "taskEnvironment",
  "instructionPriority",
  "internalControlDiscipline",
  "outputDiscipline",
  "unifiedInteractionPolicy",
  "buildOnConversationPolicy",
];
for (const key of requiredCommon) {
  if (typeof source.common?.[key] !== "string" || !source.common[key].trim()) {
    throw new Error(`Missing source.common.${key}`);
  }
}

const prompts = {};
for (const [condition, conditionSource] of Object.entries(source.conditions ?? {})) {
  if (!["C1", "C2", "C3", "C4"].includes(condition)) {
    throw new Error(`Unknown condition in route source: ${condition}`);
  }
  if (!conditionSource.behavioral?.trim()) {
    throw new Error(`Missing behavioral block for ${condition}`);
  }
  const refinement = source.conditionRefinements?.[condition];
  if (typeof refinement !== "string" || !refinement.trim()) {
    throw new Error(`Missing behavioral refinement for ${condition}`);
  }
  for (const [routeKind, routeContract] of Object.entries(conditionSource.routes ?? {})) {
    if (typeof routeContract !== "string" || !routeContract.trim()) {
      throw new Error(`Empty route contract: ${condition}.${routeKind}`);
    }
    const promptKey = `${condition}.${routeKind}.v1`;
    const prompt = [
      source.common.taskEnvironment,
      source.common.instructionPriority,
      conditionSource.behavioral,
      refinement,
      source.common.buildOnConversationPolicy,
      source.common.internalControlDiscipline,
      source.common.outputDiscipline,
      source.common.unifiedInteractionPolicy,
    ]
      .map((block) =>
        block
          .replaceAll("Route Contract", "Turn Metadata")
          .replaceAll("route contract", "turn metadata"),
      )
      .join("\n\n");
    prompts[promptKey] = {
      condition,
      routeKind,
      version: source.version,
      hash: createHash("sha256").update(prompt).digest("hex"),
      prompt,
    };
  }
}

if (Object.keys(prompts).length !== 30) {
  throw new Error(`Expected 30 prompt snapshots, received ${Object.keys(prompts).length}.`);
}

writeFileSync(
  snapshotPath,
  `${JSON.stringify(
    { schemaVersion: source.schemaVersion, sourceVersion: source.version, prompts },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(
  `Compiled ${Object.keys(prompts).length} route keys from four unified condition prompts into the runtime snapshot.`,
);
