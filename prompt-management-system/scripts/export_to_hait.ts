// scripts/export_to_hait.ts
// LEGACY ONLY: live intervention V2 reads route-prompts.snapshot.v1.json instead.
// Use `pnpm run export:hait`; this file remains for reproducing earlier pilot artifacts.
// ─────────────────────────────────────────────────────────────────
// FREEZE + EXPORT — PMS 산출물(core_prompts/*.yaml 4개)을 컴파일해서
// HAIT 런타임이 읽을 동결 프롬프트 JSON 1개로 내보낸다.
//
// 사용법 (PMS 폴더 안에서):
//   pnpm run export:hait
//
// 동작:
//   1. core_prompts/*.yaml 4개를 ConditionSpecSchema(Zod)로 읽음 → 깨진 YAML 차단
//   2. 각각 compileSystemPrompt(spec)로 완성된 시스템 프롬프트 문자열 생성
//   3. HAIT 키(C1~C4)로 매핑 + version 메타 수집
//   4. server/src/lib/compiled-prompts.json 으로 출력 (덮어쓰기)
//
// ⚠️ 이 스크립트만이 server의 동결 JSON을 갱신한다.
//    실행하지 않으면 server는 이전 프롬프트를 그대로 유지 (실험 중 우발 변경 방지).
// ─────────────────────────────────────────────────────────────────
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { compileSystemPrompt } from "../src/lib/compile_prompt.js";
import { ConditionSpecSchema, type Condition } from "../src/schemas/prompt.schema.js";
import { logger } from "../src/lib/logger.js";
import yaml from "js-yaml";

// HAIT ConditionCode ↔ PMS YAML condition 매핑 (IRB 확정)
//   C1 = Peer × XAI    C2 = Leader × XAI
//   C3 = Peer × ACI    C4 = Leader × ACI
//   CTRL = AI 없음 → export 대상 아님
const CODE_TO_CONDITION: Record<string, Condition> = {
  C1: "peer_xai",
  C2: "leader_xai",
  C3: "peer_aci",
  C4: "leader_aci",
};

// 동결 JSON이 나갈 곳 — 모노레포 형제 폴더 HAIT/server 안.
// PMS(process.cwd()) 기준 상위로 나가 server/src/lib 로 진입.
const OUTPUT_PATH = resolve(process.cwd(), "../server/src/lib/compiled-prompts.json");

interface CompiledEntry {
  prompt: string; //compileSystemPrompt 결과 (완성된 프롬프트 전체)
  version: string; //PMS YAML version
  sourceCondition: Condition; // 추적용
  audit: unknown; //PMS _audit 블록 (critic 점수 등)
}

function main(): void {
  const conditions: Record<string, CompiledEntry> = {};

  for (const [code, cond] of Object.entries(CODE_TO_CONDITION)) {
    const yamlPath = `core_prompts/${cond}_specification.yaml`;
    //Zod 검증 실패 시 throw -> 깨진 YAML가 server로 전달되지 않음
    const raw = yaml.load(readFileSync(resolve(process.cwd(), yamlPath), "utf8")) as Record<
      string,
      unknown
    >;
    const { _audit, ...specCore } = raw;
    const spec = ConditionSpecSchema.parse(specCore);

    const prompt = compileSystemPrompt(spec);

    conditions[code] = {
      prompt,
      version: spec.version,
      sourceCondition: cond,
      audit: _audit ?? null,
    };

    logger.info(
      {
        code,
        cond,
        version: spec.version,
        chars: prompt.length,
      },
      "export.compiled",
    );
  }
  const output = {
    generatedAt: new Date().toISOString(),
    conditions,
  };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  logger.info(
    {
      path: OUTPUT_PATH,
      count: Object.keys(conditions).length,
    },
    "export.complete",
  );
}

main();
