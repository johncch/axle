import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";

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
    model: Models.OpenAI.GPT_5_4_MINI,
    default: true,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    id: "anthropic",
    model: Models.Anthropic.CLAUDE_HAIKU_4_5,
    default: true,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    id: "gemini",
    model: Models.Google.GEMINI_3_FLASH_PREVIEW,
    default: true,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    id: "openrouter",
    model: Models.Qwen.QWEN3_6_PLUS,
    default: false,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", {
        apiKey: getEnv("OPENROUTER_API_KEY"),
      }),
  },
  {
    id: "together",
    model: process.env.TOGETHER_MODEL ?? "deepseek-ai/DeepSeek-V4-Pro",
    default: true,
    createProvider: () =>
      chatCompletions("https://api.together.ai/v1", {
        apiKey: getEnv("TOGETHER_API_KEY"),
      }),
  },
];

export function resolveProviderTargets(options: {
  providers?: string[];
  model?: string;
  all?: boolean;
}): BaselineProviderTarget[] {
  const providerIds = [...new Set(options.providers ?? [])];
  const targets =
    providerIds.length > 0
      ? providerIds.map((providerId) => {
          const target = baselineProviderTargets.find((candidate) => candidate.id === providerId);
          if (!target) throw new Error(`Unknown provider: ${providerId}`);
          return target;
        })
      : options.all
        ? baselineProviderTargets
        : baselineProviderTargets.filter((target) => target.default);

  if (!options.model) return targets;
  if (targets.length !== 1) {
    throw new Error("--model requires exactly one --provider so the override is unambiguous");
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
