import {
  anthropic,
  braveWebSearch,
  chatCompletions,
  gemini,
  openai,
  typesafe,
  type AIProvider,
  type DecisionProvider,
} from "@fifthrevision/axle";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "togetherai"
  | "ollama"
  | "typesafe"
  | "typesafe-openrouter";

const PROVIDER_ALIASES: Record<string, ProviderId> = { gemini: "google" };

interface ProviderTargetBase {
  id: ProviderId;
  model: string;
  default: boolean;
}

export interface ChatProviderTarget extends ProviderTargetBase {
  kind: "chat";
  createProvider(): AIProvider;
}

export interface DecisionProviderTarget extends ProviderTargetBase {
  kind: "decision";
  createProvider(): DecisionProvider;
}

export type ProviderTarget = ChatProviderTarget | DecisionProviderTarget;

export const providerTargets: ProviderTarget[] = [
  {
    kind: "chat",
    id: "openai",
    model: "openai/gpt-6-luna",
    default: true,
    createProvider: () => openai(getEnv("OPENAI_API_KEY")),
  },
  {
    kind: "chat",
    id: "anthropic",
    model: "anthropic/claude-haiku-4-5",
    default: true,
    createProvider: () => anthropic(getEnv("ANTHROPIC_API_KEY")),
  },
  {
    kind: "chat",
    id: "google",
    model: "google/gemini-flash-lite-latest",
    default: true,
    createProvider: () => gemini(getEnv("GEMINI_API_KEY")),
  },
  {
    kind: "chat",
    id: "openrouter",
    model: "deepseek/deepseek-v4.1-flash",
    default: false,
    createProvider: () =>
      chatCompletions("https://openrouter.ai/api/v1", {
        apiKey: getEnv("OPENROUTER_API_KEY"),
      }),
  },
  {
    kind: "chat",
    id: "togetherai",
    model: process.env.TOGETHER_MODEL ?? "zai-org/GLM-5.3-Flash",
    default: true,
    createProvider: () =>
      chatCompletions("https://api.together.ai/v1", {
        apiKey: getEnv("TOGETHER_API_KEY"),
        webSearch: braveWebSearch({ apiKey: getEnv("BRAVE_API_KEY") }),
      }),
  },
  {
    kind: "chat",
    id: "ollama",
    model: process.env.OLLAMA_MODEL ?? "muse-glimmer:30b-mlx",
    default: false,
    createProvider: () =>
      chatCompletions("http://localhost:11434/v1", {
        webSearch: braveWebSearch({ apiKey: getEnv("BRAVE_API_KEY") }),
      }),
  },
  {
    kind: "decision",
    id: "typesafe",
    model: "jev-latest",
    default: true,
    createProvider: () => typesafe(getEnv("TYPESAFE_API_KEY")),
  },
  {
    kind: "decision",
    id: "typesafe-openrouter",
    model: "~typesafe/jev-latest",
    default: false,
    createProvider: () =>
      typesafe(getEnv("OPENROUTER_API_KEY"), { baseUrl: "https://openrouter.ai/api" }),
  },
];

export function resolveProviderTargets(options: {
  providers?: string[];
  model?: string;
  all?: boolean;
}): ProviderTarget[] {
  const providerIds = [
    ...new Set((options.providers ?? []).map((id) => PROVIDER_ALIASES[id] ?? id)),
  ];
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
