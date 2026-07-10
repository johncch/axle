import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";

export type MessageFormatProviderId = "openai" | "anthropic" | "gemini" | "openrouter";

export interface MessageFormatProviderTarget {
  id: MessageFormatProviderId;
  model: string;
  createProvider(): AIProvider;
}

export const messageFormatProviderTargets: MessageFormatProviderTarget[] = [
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
      chatCompletions("https://openrouter.ai/api/v1", getEnv("OPENROUTER_API_KEY")),
  },
];

export function resolveProviderTargets(options: {
  provider?: string;
  model?: string;
}): MessageFormatProviderTarget[] {
  const targets = options.provider
    ? messageFormatProviderTargets.filter((target) => target.id === options.provider)
    : messageFormatProviderTargets;

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
