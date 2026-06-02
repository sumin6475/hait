import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { logger } from "../lib/logger.js";

// Per CLAUDE.md §11, §12, §15.15.
// Wrapper around the Anthropic SDK that:
//   1. Reads model strings exclusively from config/llm_models.yaml.
//      Never hard-code model names in agent files.
//   2. Splits the system prompt into a cacheable prefix and an
//      agent-specific suffix, applying `cache_control: {"type": "ephemeral"}`
//      to the last block of the prefix so the API caches it for 5 minutes.
//   3. Honors extended_thinking when configured (Critic Evaluator only).

// ─────────────────────────────────────────────────────────────────
// Config loading.
// ─────────────────────────────────────────────────────────────────

const AgentConfigSchema = z
  .object({
    model: z.string(),
    temperature: z.number().min(0).max(1),
    max_tokens: z.number().int().positive(),
    extended_thinking: z.boolean(),
  })
  .strict();

const LlmModelsConfigSchema = z
  .object({
    agents: z.record(z.string(), AgentConfigSchema),
  })
  .strict();

export type AgentRole =
  | "scout"
  | "grounder"
  | "architect"
  | "critic_simulator"
  | "critic_evaluator"
  | "supervisor";

let cachedConfig: z.infer<typeof LlmModelsConfigSchema> | null = null;

function loadModelConfig(): z.infer<typeof LlmModelsConfigSchema> {
  if (cachedConfig) return cachedConfig;
  const path = resolve(process.cwd(), "config/llm_models.yaml");
  const raw = readFileSync(path, "utf8");
  cachedConfig = LlmModelsConfigSchema.parse(yaml.load(raw));
  return cachedConfig;
}

export function getAgentConfig(role: AgentRole): z.infer<typeof AgentConfigSchema> {
  const cfg = loadModelConfig().agents[role];
  if (!cfg) {
    throw new Error(`No model config for agent role "${role}" in config/llm_models.yaml`);
  }
  return cfg;
}

function modelDeprecatesTemperature(modelId: string): boolean {
  // Anthropic deprecated temperature on Opus 4.7. Sonnet 4.6 and Haiku 4.5
  // still accept it. This predicate centralizes the gate so the rest of the
  // codebase can keep declaring intent in config/llm_models.yaml.
  return modelId.startsWith("claude-opus-4-7");
}

// ─────────────────────────────────────────────────────────────────
// Anthropic client.
// ─────────────────────────────────────────────────────────────────

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.startsWith("sk-ant-api03-REPLACE")) {
    throw new Error(
      "ANTHROPIC_API_KEY missing or unset. Copy env.example to .env and fill it in.",
    );
  }
  cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

// ─────────────────────────────────────────────────────────────────
// callAgent: the only entry point agents should use.
// ─────────────────────────────────────────────────────────────────

export interface CallAgentOptions {
  role: AgentRole;
  /** Cacheable prefix — large, stable across iterations (common_framework + validated_kb). */
  cacheablePrefix: string;
  /** Agent-specific instructions that change per agent / per iteration. */
  agentInstructions: string;
  /** User-turn messages. Schema-bound tool outputs may also live here. */
  messages: Anthropic.MessageParam[];
  /** Optional tool definitions for structured output (CLAUDE.md §14.4). */
  tools?: Anthropic.Tool[];
  /** Optional override of max_tokens. Defaults to config value. */
  maxTokens?: number;
}

export async function callAgent(
  opts: CallAgentOptions,
): Promise<Anthropic.Message> {
  const cfg = getAgentConfig(opts.role);

  // System prompt as an array of content blocks so we can attach cache_control.
  // Per CLAUDE.md §12: the last block before the "breakpoint" carries the
  // ephemeral cache marker. Everything before it (= the prefix) is cached.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: opts.cacheablePrefix,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: opts.agentInstructions,
    },
  ];

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: cfg.model,
    max_tokens: opts.maxTokens ?? cfg.max_tokens,
    system,
    messages: opts.messages,
  };
  // Models that still accept temperature get it. Opus 4.7 has deprecated
  // temperature ("`temperature` is deprecated for this model"); we omit it
  // so the API stops returning 400s. Sonnet 4.6 and Haiku 4.5 still accept
  // it, and we use it (CLAUDE.md §4.4) to keep variance under control.
  // Note: we also no longer send top_p — current models reject sending
  // both top_p and temperature together. Default top_p ≡ 1, preserving the
  // original spec intent.
  if (!modelDeprecatesTemperature(cfg.model)) {
    params.temperature = cfg.temperature;
  }

  if (opts.tools && opts.tools.length > 0) {
    params.tools = opts.tools;
  }

  if (cfg.extended_thinking) {
    // Anthropic moved extended thinking on Opus 4.7 from a fixed
    // budget_tokens model ("thinking.type.enabled") to an adaptive model
    // ("thinking.type.adaptive" + "output_config.effort"). SDK 0.65.0
    // doesn't expose those fields in its TS types yet, so we set them via
    // an escape hatch and add them post-construction.
    const ext = params as unknown as Record<string, unknown>;
    ext.thinking = { type: "adaptive" };
    ext.output_config = { effort: "medium" };
  }

  logger.debug(
    {
      role: opts.role,
      model: cfg.model,
      extended_thinking: cfg.extended_thinking,
      prefix_chars: opts.cacheablePrefix.length,
      instructions_chars: opts.agentInstructions.length,
    },
    "anthropic.callAgent",
  );

  const response = await client().messages.create(params);

  logger.debug(
    {
      role: opts.role,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: response.usage.cache_creation_input_tokens ?? 0,
      stop_reason: response.stop_reason,
    },
    "anthropic.callAgent.response",
  );

  return response;
}
