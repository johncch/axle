export const Models = {
  GEMINI_3_1_PRO_PREVIEW: "gemini-3.1-pro-preview",
  GEMINI_3_1_PRO_PREVIEW_CUSTOMTOOLS: "gemini-3.1-pro-preview-customtools",
  GEMINI_3_1_FLASH_LITE_PREVIEW: "gemini-3.1-flash-lite-preview",

  GEMINI_3_PRO_PREVIEW: "gemini-3-pro-preview",
  GEMINI_3_FLASH_PREVIEW: "gemini-3-flash-preview",

  GEMINI_2_5_PRO: "gemini-2.5-pro",
  GEMINI_2_5_FLASH: "gemini-2.5-flash",
  GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite",

  GEMINI_2_0_FLASH: "gemini-2.0-flash",
  GEMINI_2_0_FLASH_001: "gemini-2.0-flash-001",
  GEMINI_2_0_FLASH_LITE: "gemini-2.0-flash-lite",
  GEMINI_2_0_FLASH_LITE_001: "gemini-2.0-flash-lite-001",

  GEMINI_FLASH_LATEST: "gemini-flash-latest",
  GEMINI_FLASH_LITE_LATEST: "gemini-flash-lite-latest",
  GEMINI_PRO_LATEST: "gemini-pro-latest",

  GEMMA_4_31B_IT: "gemma-4-31b-it",
  GEMMA_4_E4B_IT: "gemma-4-26b-a4b-it",

  GEMMA_3_27B_IT: "gemma-3-27b-it",
  GEMMA_3_12B_IT: "gemma-3-12b-it",
  GEMMA_3_4B_IT: "gemma-3-4b-it",
  GEMMA_3_1B_IT: "gemma-3-1b-it",
  GEMMA_3N_E4B_IT: "gemma-3n-e4b-it",
  GEMMA_3N_E2B_IT: "gemma-3n-e2b-it",
} as const;

export const MULTIMODAL_MODELS = [
  Models.GEMINI_3_1_PRO_PREVIEW,
  Models.GEMINI_3_1_PRO_PREVIEW_CUSTOMTOOLS,
  Models.GEMINI_3_1_FLASH_LITE_PREVIEW,
  Models.GEMINI_3_PRO_PREVIEW,
  Models.GEMINI_3_FLASH_PREVIEW,
  Models.GEMINI_2_5_PRO,
  Models.GEMINI_2_5_FLASH,
  Models.GEMINI_2_5_FLASH_LITE,
  Models.GEMINI_2_0_FLASH,
  Models.GEMINI_2_0_FLASH_001,
  Models.GEMINI_2_0_FLASH_LITE,
  Models.GEMINI_2_0_FLASH_LITE_001,
  Models.GEMINI_FLASH_LATEST,
  Models.GEMINI_FLASH_LITE_LATEST,
  Models.GEMINI_PRO_LATEST,
  Models.GEMMA_4_31B_IT,
  Models.GEMMA_4_E4B_IT,
  Models.GEMMA_3_27B_IT,
  Models.GEMMA_3_12B_IT,
  Models.GEMMA_3_4B_IT,
  Models.GEMMA_3_1B_IT,
  Models.GEMMA_3N_E4B_IT,
  Models.GEMMA_3N_E2B_IT,
] as const;

export const DEFAULT_MODEL = Models.GEMINI_3_1_FLASH_LITE_PREVIEW;
