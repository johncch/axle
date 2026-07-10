import type { AIProvider } from "@fifthrevision/axle";
import { anthropic, chatCompletions, gemini, openai } from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";

export type StructuredOutputProviderKind = "openai" | "anthropic" | "gemini" | "chatcompletions";

export interface StructuredOutputTarget {
  id: string;
  provider: StructuredOutputProviderKind;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

const openRouterBaseUrl = "https://openrouter.ai/api/v1";

export const structuredOutputTargets: StructuredOutputTarget[] = [
  {
    id: "gpt-5-4-mini",
    provider: "openai",
    model: Models.OpenAI.GPT_5_4_MINI,
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "haiku-4-5",
    provider: "anthropic",
    model: Models.Anthropic.CLAUDE_HAIKU_4_5,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "gemini-3-flash",
    provider: "gemini",
    model: Models.Google.GEMINI_3_FLASH_PREVIEW,
    apiKeyEnv: "GEMINI_API_KEY",
  },
  openRouterTarget("qwen-3-6-35b-a3b", Models.Qwen.QWEN3_6_35B_A3B),
  openRouterTarget("gemma-4-26b-a4b-it", Models.Google.GEMMA_4_26B_A4B_IT),
  openRouterTarget("ministral-8b", Models.Mistral.MINISTRAL_8B_LATEST),
  openRouterTarget("mistral-small-latest", Models.Mistral.MISTRAL_SMALL_LATEST),
  openRouterTarget("deepseek-v4-flash", Models.DeepSeek.DEEPSEEK_V4_FLASH),
  openRouterTarget("minimax-m2-7", Models.MiniMax.MINIMAX_M2_7),
];

export function createStructuredOutputProvider(target: StructuredOutputTarget): AIProvider {
  switch (target.provider) {
    case "openai":
      return openai(getEnv(target.apiKeyEnv));
    case "anthropic":
      return anthropic(getEnv(target.apiKeyEnv));
    case "gemini":
      return gemini(getEnv(target.apiKeyEnv));
    case "chatcompletions":
      if (!target.baseUrl) throw new Error(`Target ${target.id} is missing baseUrl`);
      return chatCompletions(target.baseUrl, getEnv(target.apiKeyEnv));
  }
}

export function resolveStructuredOutputTargets(selectors: string[]): StructuredOutputTarget[] {
  if (selectors.length === 0 || selectors.includes("all")) return structuredOutputTargets;

  const selected = new Map<string, StructuredOutputTarget>();
  for (const selector of selectors) {
    const match = structuredOutputTargets.find(
      (target) => target.id === selector || target.model === selector,
    );
    if (!match) throw new Error(`Unknown structured-output target: ${selector}`);
    selected.set(match.id, match);
  }

  return [...selected.values()];
}

function openRouterTarget(id: string, model: string): StructuredOutputTarget {
  return {
    id,
    provider: "chatcompletions",
    model,
    baseUrl: openRouterBaseUrl,
    apiKeyEnv: "OPENROUTER_API_KEY",
  };
}

function getEnv(name: string | undefined): string {
  if (!name) throw new Error("Missing API key environment variable name");
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
