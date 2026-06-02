//Admin API - Condition 읽기 전용
//
//Endpoints:
// GET /api/conditions: 모든 조건 목록 + version + audit 반환
// POST /api/conditions/test-chat : Test Chat 전용 AI 호출
//인증: x-admin-token 헤더 필수 (참가자 노출 금지)
//
//데이터 출처: lib/compiled-prompts.json

import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth.js";
import compiledPrompts from "../lib/compiled-prompts.json" with { type: "json" };
import { buildSystemPromptWithDiscipline, buildUserPromptFromMessages } from "../lib/prompts.js";
import { callAIStructured } from "../lib/openai.js";
import type { ConditionCode } from "../types.js";

export const conditionsRouter = Router();

conditionsRouter.get("/", requireAdmin, async (_req, res) => {
  res.json(compiledPrompts);
});

//POST /api/conditions/test-chat : Test Chat 전용 AI 호출
//실험경로와 분리
conditionsRouter.post("/test-chat", requireAdmin, async (req, res) => {
  const { conditionCode, transcript } = req.body as {
    conditionCode?: ConditionCode;
    transcript?: { sender: string; content: string }[];
  };

  //CTRL은 AI 없음
  if (!conditionCode || conditionCode === "CTRL") {
    return res.status(400).json({ error: "Valid AI conditionCode (C1-C4) required" });
  }
  if (!Array.isArray(transcript)) {
    return res.status(400).json({ error: "transcript array required" });
  }

  try {
    //실험 경로와 동일한 조합 (DB / Socket 없음)
    const systemPrompt = buildSystemPromptWithDiscipline(conditionCode);
    const userPrompt = await buildUserPromptFromMessages(transcript);
    const result = await callAIStructured({ systemPrompt, userPrompt, timeoutMs: 30_000 });

    if (!result.ok) {
      return res.status(502).json({ error: `AI call failed: ${result.reason}` });
    }

    return res.json({
      content: result.parsed.content,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  } catch (error) {
    return res.status(500).json({ error: String(error) });
  }
});
