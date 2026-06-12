import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "@fifthrevision/axle";
import {
  AnthropicModels,
  ChatCompletionsModels,
  GeminiModels,
  OpenAIModels,
} from "@fifthrevision/axle/models";

export type BaselineProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "together";

export interface BaselineProviderTarget {
  id: BaselineProviderId;
  model: string;
  default: boolean;
  createProvider(): AIProvider;
}

export const baselineProviderTargets: BaselineProviderTarget[] = [
  {
    id: "openai",
    model: OpenAIModels.GPT_5_4_MINI,
    default: true,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    id: "anthropic",
    model: AnthropicModels.CLAUDE_HAIKU_4_5,
    default: true,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    id: "gemini",
    model: GeminiModels.GEMINI_3_FLASH,
    default: true,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    id: "openrouter",
    model: ChatCompletionsModels.QWEN_3_6_PLUS,
    default: false,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", {
        apiKey: getEnv("OPENROUTER_API_KEY"),
        providerToolVendor: "openrouter",
      }),
  },
  {
    id: "together",
    model: process.env.TOGETHER_MODEL ?? "Qwen/Qwen3.5-9B",
    default: true,
    createProvider: () =>
      chatCompletions("https://api.together.ai/v1", {
        apiKey: getEnv("TOGETHER_API_KEY"),
        providerDialect: "together",
      }),
  },
];

export function resolveProviderTargets(options: {
  provider?: string;
  model?: string;
  all?: boolean;
}): BaselineProviderTarget[] {
  const targets = options.provider
    ? baselineProviderTargets.filter((target) => target.id === options.provider)
    : options.all
      ? baselineProviderTargets
      : baselineProviderTargets.filter((target) => target.default);

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
