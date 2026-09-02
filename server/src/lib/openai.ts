//OpenAI Responses API
import OpenAI from "openai";
import { config } from "../config.js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const client = new OpenAI({ apiKey: config.openaiApiKey, baseURL: config.openaiApiBase });

// 추론(reasoning)계열 모델(gpt-5-mini 등)은 (1) temperature/top_p 를 받지 않고
// (2) 숨은 추론 토큰이 max_output_tokens 를 잡아먹어 발화가 truncate 된다.
// → temperature 생략 + reasoning_effort:"minimal"(가볍게) + 토큰 여유 확보로 대응.
const REASONING_MODEL = /^(o1|o3|o4|gpt-5)/i;
// 발화 텍스트 자체는 스키마가 800자로 제한 → 여유분은 순전히 추론 토큰용 헤드룸.
const REASONING_TOKEN_HEADROOM = 1024;

//AI 호출결과 타입
export type AICallResult =
  | {
      ok: true;
      content: string;
      requestId: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
    }
  | { ok: false; reason: "timeout" | "rate_limit" | "parse_error" | "unknown"; error: string };

interface CallAIOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
}

//non-streaming
//결과를 객체로 반환 - throw 안하는 대신
export async function callAI({
  systemPrompt,
  userPrompt,
  model = "gpt-4o-mini",
  timeoutMs = 15_000,
}: CallAIOptions): Promise<AICallResult> {
  const start = Date.now();

  //AbortController로 timeout 처리
  //Timeout 으로 단순화 가능
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await client.responses.create(
      {
        model,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
      { signal: ctrl.signal },
    );

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    //응답 텍스트 추출
    const content = response.output_text?.trim() ?? "";
    if (!content) {
      return {
        ok: false,
        reason: "parse_error",
        error: "Empty response from model",
      };
    }
    return {
      ok: true,
      content,
      requestId: response.id,
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (
      error.name === "AbortError" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("aborted")
    ) {
      return {
        ok: false,
        reason: "timeout",
        error: `Timeout after ${timeoutMs}ms`,
      };
    }
    if (error.status === 429) {
      return {
        ok: false,
        reason: "rate_limit",
        error: error.message,
      };
    }
    return {
      ok: false,
      reason: "unknown",
      error: error.message ?? String(error),
    };
  }
}

export const AIResponseSchema = z.object({
  content: z.string().max(800),
});

export type AIResponseParsed = { content: string };
//structured output 버전결과타입
export type AIStructuredResult =
  | {
      ok: true;
      parsed: AIResponseParsed;
      requestId: string;
      latencyMs: number;
      inputTokens: number;
      outputTokens: number;
      systemFingerprint: string | null;
      model: string;
    }
  | {
      ok: false;
      reason: "timeout" | "rate_limit" | "parsed_error" | "unknown";
      error: string;
      model: string;
    };

interface CallAIStructuredOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
  // null deliberately removes the API/schema cap for long readable recap routes.
  maxOutputTokens?: number | null; // default 140
  maxContentChars?: number | null;
}

export async function callAIStructured({
  systemPrompt,
  userPrompt,
  model = "gpt-5-mini", // U-M GPT Toolkit 카탈로그명 (파일럿의 gpt-5.4-mini에서 교체 — golden 재실행 필요)
  timeoutMs = 30_000,
  maxOutputTokens = 140,
  maxContentChars = 800,
}: CallAIStructuredOptions): Promise<AIStructuredResult> {
  const start = Date.now();
  const isReasoning = REASONING_MODEL.test(model);
  // reasoning 모델은 추론 토큰 헤드룸을 더해 시작 (안 그러면 첫 시도부터 truncate)
  let cap =
    maxOutputTokens === null
      ? null
      : isReasoning
        ? maxOutputTokens + REASONING_TOKEN_HEADROOM
        : maxOutputTokens;

  // 2 attempts
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const responseSchema = z.object({
        content: maxContentChars === null ? z.string() : z.string().max(maxContentChars),
      });
      const response = await client.responses.parse(
        {
          model,
          // reasoning 모델: temperature 불가 → 생략, 대신 추론을 최소로(가볍게+빠르게)
          ...(isReasoning ? { reasoning: { effort: "minimal" } } : { temperature: 0 }),
          ...(cap === null ? {} : { max_output_tokens: cap }),
          input: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          text: {
            format: zodTextFormat(responseSchema, "ai_response"),
          },
        },
        { signal: ctrl.signal },
      );
      clearTimeout(timeoutId);

      //output_pared가 null 이면 schema 어김 또는 model refusal
      const parsed = response.output_parsed;
      if (parsed) {
        return {
          ok: true,
          parsed,
          requestId: response.id,
          latencyMs: Date.now() - start,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          systemFingerprint: (response as any).system_fingerprint ?? null,
          model,
        };
      }

      //null parse -> truncation by the cap, or a genuine schema/refusal?
      const truncated =
        response.status === "incomplete" &&
        response.incomplete_details?.reason === "max_output_tokens";

      if (attempt === 0) {
        // truncate면 캡을 크게 — [T-CAP-001] 비추론 모델은 256으로 고정하던 것을 2배로:
        // 폴백 캡(600)이 커진 뒤 256으로 되줄이면 재시도가 무의미해진다.
        if (truncated && cap !== null) {
          cap = isReasoning ? cap + REASONING_TOKEN_HEADROOM * 2 : cap * 2;
        }
        continue;
      }
      return {
        ok: false,
        reason: "parsed_error",
        error: truncated
          ? "truncated at max_output_tokens(after retry)"
          : "output_parsed is null - schema/refusal (after retry)",
        model,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (
        error.name === "AbortError" ||
        error.code === "ETIMEDOUT" ||
        error.message?.includes("aborted")
      ) {
        return { ok: false, reason: "timeout", error: `Timeout after ${timeoutMs}ms`, model };
      }
      if (error.status === 429) {
        return { ok: false, reason: "rate_limit", error: error.message, model };
      }
      return { ok: false, reason: "unknown", error: error.message ?? String(error), model };
    }
  }
  return { ok: false, reason: "parsed_error", error: "exhausted retries", model };
}
