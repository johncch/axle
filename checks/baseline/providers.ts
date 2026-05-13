import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "../../src/index.js";
import {
  AnthropicModels,
  ChatCompletionsModels,
  GeminiModels,
  OpenAIModels,
} from "../../src/providers/models.js";

export type BaselineProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export interface BaselineProviderTarget {
  id: BaselineProviderId;
  model: string;
  createProvider(): AIProvider;
}

export const baselineProviderTargets: BaselineProviderTarget[] = [
  {
    id: "openai",
    model: OpenAIModels.GPT_5_4_MINI,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    id: "anthropic",
    model: AnthropicModels.CLAUDE_HAIKU_4_5,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    id: "gemini",
    model: GeminiModels.GEMINI_3_FLASH,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    id: "openrouter",
    model: ChatCompletionsModels.QWEN_3_6_35B_A3B,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", getEnv("OPENROUTER_API_KEY")),
  },
];

export function resolveProviderTargets(options: {
  provider?: string;
  model?: string;
}): BaselineProviderTarget[] {
  const targets = options.provider
    ? baselineProviderTargets.filter((target) => target.id === options.provider)
    : baselineProviderTargets;

  if (targets.length === 0) {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  if (!options.model) return targets;
  if (!options.provider && targets.length > 1) {
    throw new Error("--model requires --provider so the override is unambiguous");
  }

  return targets.map((target) => ({
    ...target,
    model: options.model!,
  }));
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
