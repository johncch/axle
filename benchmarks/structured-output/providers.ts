import { anthropic, chatCompletions, gemini, openai } from "../../src/index.js";
import {
  AnthropicModels,
  ChatCompletionsModels,
  GeminiModels,
  OpenAIModels,
} from "../../src/providers/models.js";
import type { AIProvider } from "../../src/providers/types.js";

export type BenchmarkProviderKind = "openai" | "anthropic" | "gemini" | "chatcompletions";

export interface BenchmarkTarget {
  id: string;
  provider: BenchmarkProviderKind;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
}

const openRouterBaseUrl = "https://openrouter.ai/api/v1";

export const benchmarkTargets: BenchmarkTarget[] = [
  {
    id: "gpt-5-4-mini",
    provider: "openai",
    model: OpenAIModels.GPT_5_4_MINI,
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "haiku-4-5",
    provider: "anthropic",
    model: AnthropicModels.CLAUDE_HAIKU_4_5,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "gemini-3-flash",
    provider: "gemini",
    model: GeminiModels.GEMINI_3_FLASH,
    apiKeyEnv: "GEMINI_API_KEY",
  },
  openRouterTarget("qwen-3-6-35b-a3b", ChatCompletionsModels.QWEN_3_6_35B_A3B),
  openRouterTarget("gemma-4-26b-a4b-it", ChatCompletionsModels.GEMMA_4_26B_A4B_IT),
  openRouterTarget("ministral-3-8b", ChatCompletionsModels.MINISTRAL_3_8B),
  openRouterTarget("mistral-small-4", ChatCompletionsModels.MISTRAL_SMALL_4),
  openRouterTarget("deepseek-v4-flash", ChatCompletionsModels.DEEPSEEK_V4_FLASH),
  openRouterTarget("minimax-m2", ChatCompletionsModels.MINIMAX_M2),
];

export function createBenchmarkProvider(target: BenchmarkTarget): AIProvider {
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

export function resolveBenchmarkTargets(selectors: string[]): BenchmarkTarget[] {
  if (selectors.length === 0 || selectors.includes("all")) return benchmarkTargets;

  const selected = new Map<string, BenchmarkTarget>();
  for (const selector of selectors) {
    const match = benchmarkTargets.find(
      (target) => target.id === selector || target.model === selector,
    );
    if (!match) throw new Error(`Unknown benchmark target: ${selector}`);
    selected.set(match.id, match);
  }

  return [...selected.values()];
}

function openRouterTarget(id: string, model: string): BenchmarkTarget {
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
