import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";

export type ToolCallProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "together";

export interface ToolCallProviderTarget {
  id: ToolCallProviderId;
  model: string;
  createProvider(): AIProvider;
}

export const toolCallProviderTargets: ToolCallProviderTarget[] = [
  {
    id: "openai",
    model: Models.OpenAI.GPT_5_4_MINI,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    id: "anthropic",
    model: Models.Anthropic.CLAUDE_HAIKU_4_5,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    id: "gemini",
    model: Models.Google.GEMINI_3_FLASH_PREVIEW,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    id: "openrouter",
    model: Models.Qwen.QWEN3_6_PLUS,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", {
        apiKey: getEnv("OPENROUTER_API_KEY"),
      }),
  },
  {
    id: "together",
    model: process.env.TOGETHER_MODEL ?? "Qwen/Qwen3.5-9B",
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
}): ToolCallProviderTarget[] {
  const providerIds = [...new Set(options.providers ?? [])];
  const targets =
    providerIds.length > 0
      ? providerIds.map((providerId) => {
          const target = toolCallProviderTargets.find((candidate) => candidate.id === providerId);
          if (!target) throw new Error(`Unknown provider: ${providerId}`);
          return target;
        })
      : toolCallProviderTargets;

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
