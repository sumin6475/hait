//OpenAI Responses API
import OpenAI from "openai";
import { config } from "../config.js";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

const client = new OpenAI({ apiKey: config.openaiApiKey });

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
  content: z.string().max(600),
});

export type AIResponseParsed = z.infer<typeof AIResponseSchema>;
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
    }
  | { ok: false; reason: "timeout" | "rate_limit" | "parsed_error" | "unknown"; error: string };

interface CallAIStructuredOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs?: number;
  previousResponseId?: string;
}

export async function callAIStructured({
  systemPrompt,
  userPrompt,
  model = "gpt-4o-mini",
  timeoutMs = 30_000,
  previousResponseId,
}: CallAIStructuredOptions): Promise<AIStructuredResult> {
  const start = Date.now();
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await client.responses.parse(
      {
        model,
        temperature: 0,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        previous_response_id: previousResponseId,
        text: {
          format: zodTextFormat(AIResponseSchema, "ai_response"),
        },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    //output_pared가 null 이면 schema 어김 또는 model refusal
    const pared = response.output_parsed;
    if (!pared) {
      return {
        ok: false,
        reason: "parsed_error",
        error: "output_parsed is null(schema mismatch or model refusal)",
      };
    }
    return {
      ok: true,
      parsed: pared,
      requestId: response.id,
      latencyMs,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      systemFingerprint: (response as any).system_fingerprint ?? null,
    };
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (
      error.name === "AbortError" ||
      error.code === "ETIMEDOUT" ||
      error.message?.includes("aborted")
    ) {
      return { ok: false, reason: "timeout", error: `Timeout after ${timeoutMs}ms` };
    }
    if (error.status === 429) {
      return { ok: false, reason: "rate_limit", error: error.message };
    }
    return { ok: false, reason: "unknown", error: error.message ?? String(error) };
  }
}
