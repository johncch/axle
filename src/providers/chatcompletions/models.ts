export const Models = {
  QWEN_3_6_35B_A3B: "qwen/qwen3.6-35b-a3b", // open weight, 35B total / 3B active
  GEMMA_4_26B_A4B_IT: "google/gemma-4-26b-a4b-it", // open weight, 25.2B total / 3.8B active
  MINISTRAL_3_8B: "mistralai/ministral-8b-2512", // open weight, 8B
  MISTRAL_SMALL_4: "mistralai/mistral-small-2603", // open weight, 119B total / 6.5B active
  DEEPSEEK_V4_FLASH: "deepseek/deepseek-v4-flash", // open weight, smallest DeepSeek V4 target
  MINIMAX_M2: "minimax/minimax-m2", // open weight, 230B total / 10B active
} as const;

export const SMALL_OPEN_WEIGHT_MODELS = [
  Models.QWEN_3_6_35B_A3B,
  Models.GEMMA_4_26B_A4B_IT,
  Models.MINISTRAL_3_8B,
  Models.MISTRAL_SMALL_4,
  Models.DEEPSEEK_V4_FLASH,
  Models.MINIMAX_M2,
] as const;

export const DEFAULT_MODEL = Models.QWEN_3_6_35B_A3B;
