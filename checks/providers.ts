import { anthropic, chatCompletions, gemini, openai, type AIProvider } from "@fifthrevision/axle";

export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "together" | "ollama";

export interface ProviderTarget {
  id: ProviderId;
  model: string;
  default: boolean;
  createProvider(): AIProvider;
}

export const providerTargets: ProviderTarget[] = [
  {
    id: "openai",
    model: "openai/gpt-5.6-luna",
    default: true,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    id: "anthropic",
    model: "anthropic/claude-haiku-4-5",
    default: true,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    id: "gemini",
    model: "google/gemini-flash-lite-latest",
    default: true,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    id: "openrouter",
    model: "qwen/qwen3.6-plus",
    default: false,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", {
        apiKey: getEnv("OPENROUTER_API_KEY"),
      }),
  },
  {
    id: "together",
    model: process.env.TOGETHER_MODEL ?? "zai-org/GLM-5.3-Flash",
    default: true,
    createProvider: () =>
      chatCompletions("https://api.together.ai/v1", {
        apiKey: getEnv("TOGETHER_API_KEY"),
      }),
  },
  {
    id: "ollama",
    model: process.env.OLLAMA_MODEL ?? "muse-glimmer:30b-mlx",
    default: false,
    createProvider: () => chatCompletions("http://localhost:11434/v1"),
  },
];

export function resolveProviderTargets(options: {
  providers?: string[];
  model?: string;
  all?: boolean;
}): ProviderTarget[] {
  const providerIds = [...new Set(options.providers ?? [])];
  const targets =
    providerIds.length > 0
      ? providerIds.map((providerId) => {
          const target = providerTargets.find((candidate) => candidate.id === providerId);
          if (!target) throw new Error(`Unknown provider: ${providerId}`);
          return target;
        })
      : options.all
        ? providerTargets
        : providerTargets.filter((target) => target.default);

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
