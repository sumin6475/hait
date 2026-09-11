// 프롬프트 컴파일러. `src/prompts/blocks/` 의 TS 블록을 읽어 런타임 스냅샷을 만든다.
//
// 조립 순서와 문자열 치환은 이전 .mjs 컴파일러와 동일하다. 소스를 JSON 하나에서
// 블록별 TS 파일로 옮기면서 산출물이 바뀌지 않았다는 것이, 이 파일이 지켜야 할 유일한
// 사후 조건이다 — 스냅샷은 바이트 단위로 같아야 한다.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCHEMA_VERSION,
  VERSION,
  common,
  conditionBehavioral,
  conditionRefinements,
  routeContracts,
} from "../src/prompts/blocks/index.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(scriptDir, "..");
const snapshotPath = resolve(serverDir, "src/prompts/route-prompts.snapshot.v1.json");

const requiredCommon = [
  "taskEnvironment",
  "instructionPriority",
  "internalControlDiscipline",
  "outputDiscipline",
  "unifiedInteractionPolicy",
  "buildOnConversationPolicy",
] as const;
for (const key of requiredCommon) {
  if (typeof common[key] !== "string" || !common[key].trim()) {
    throw new Error(`Missing common.${key}`);
  }
}

const prompts: Record<string, unknown> = {};
for (const [condition, routes] of Object.entries(routeContracts)) {
  if (!["C1", "C2", "C3", "C4"].includes(condition)) {
    throw new Error(`Unknown condition in route source: ${condition}`);
  }
  const behavioral = conditionBehavioral[condition];
  if (!behavioral?.trim()) throw new Error(`Missing behavioral block for ${condition}`);
  const refinement = conditionRefinements[condition];
  if (typeof refinement !== "string" || !refinement.trim()) {
    throw new Error(`Missing behavioral refinement for ${condition}`);
  }
  for (const [routeKind, routeContract] of Object.entries(routes)) {
    // 라우트 조각은 본문에 붙지 않는다. 30개 키를 열거하는 데만 쓰이고, 비어 있으면
    // 그 자체가 소스 결함이므로 여기서 막는다.
    if (typeof routeContract !== "string" || !routeContract.trim()) {
      throw new Error(`Empty route contract: ${condition}.${routeKind}`);
    }
    const promptKey = `${condition}.${routeKind}.v1`;
    const prompt = [
      common.taskEnvironment,
      common.instructionPriority,
      behavioral,
      refinement,
      common.buildOnConversationPolicy,
      common.internalControlDiscipline,
      common.outputDiscipline,
      common.unifiedInteractionPolicy,
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
      version: VERSION,
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
  `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, sourceVersion: VERSION, prompts }, null, 2)}\n`,
  "utf8",
);
console.log(
  `Compiled ${Object.keys(prompts).length} route keys from four unified condition prompts into the runtime snapshot.`,
);
