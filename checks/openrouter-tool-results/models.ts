export interface OpenRouterToolResultModel {
  group: "most-capable" | "balanced" | "fast";
  label: string;
  id: string;
}

export const openRouterToolResultModels: OpenRouterToolResultModel[] = [
  {
    group: "most-capable",
    label: "Claude Opus 4.8",
    id: "anthropic/claude-opus-4.8",
  },
  {
    group: "most-capable",
    label: "GPT-5.5",
    id: "openai/gpt-5.5",
  },
  {
    group: "most-capable",
    label: "Qwen 3.7 Max",
    id: "qwen/qwen3.7-max",
  },
  {
    group: "most-capable",
    label: "MiniMax M3",
    id: "minimax/minimax-m3",
  },
  {
    group: "most-capable",
    label: "Kimi K2.6",
    id: "moonshotai/kimi-k2.6",
  },
  {
    group: "balanced",
    label: "Claude Sonnet 4.6",
    id: "anthropic/claude-sonnet-4.6",
  },
  {
    group: "balanced",
    label: "GPT-5.4",
    id: "openai/gpt-5.4",
  },
  {
    group: "balanced",
    label: "DeepSeek V4 Pro",
    id: "deepseek/deepseek-v4-pro",
  },
  {
    group: "balanced",
    label: "Qwen 3.7 Plus",
    id: "qwen/qwen3.7-plus",
  },
  {
    group: "balanced",
    label: "GLM-5.1",
    id: "z-ai/glm-5.1",
  },
  {
    group: "fast",
    label: "Claude Haiku 4.5",
    id: "anthropic/claude-haiku-4.5",
  },
  {
    group: "fast",
    label: "GPT-5.4 Mini",
    id: "openai/gpt-5.4-mini",
  },
  {
    group: "fast",
    label: "Qwen 3.6 Flash",
    id: "qwen/qwen3.6-flash",
  },
  {
    group: "fast",
    label: "DeepSeek V4 Flash",
    id: "deepseek/deepseek-v4-flash",
  },
  {
    group: "fast",
    label: "MiniMax M2.7",
    id: "minimax/minimax-m2.7",
  },
];
