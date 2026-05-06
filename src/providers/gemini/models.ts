export const Models = {
  GEMINI_3_1_PRO_PREVIEW: "gemini-3.1-pro-preview",
  GEMINI_3_1_PRO: "gemini-3.1-pro-preview",
  GEMINI_3_1_PRO_PREVIEW_CUSTOMTOOLS: "gemini-3.1-pro-preview-customtools",
  GEMINI_3_1_FLASH_LITE_PREVIEW: "gemini-3.1-flash-lite-preview",
  GEMINI_3_1_FLASH_LITE: "gemini-3.1-flash-lite-preview",

  GEMINI_3_PRO_PREVIEW: "gemini-3-pro-preview",
  GEMINI_3_PRO: "gemini-3-pro-preview",
  GEMINI_3_FLASH_PREVIEW: "gemini-3-flash-preview",
  GEMINI_3_FLASH: "gemini-3-flash-preview",

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
} as const;

export const MULTIMODAL_MODELS = [
  Models.GEMINI_3_1_PRO,
  Models.GEMINI_3_1_PRO_PREVIEW_CUSTOMTOOLS,
  Models.GEMINI_3_1_FLASH_LITE,
  Models.GEMINI_3_PRO,
  Models.GEMINI_3_FLASH,
  Models.GEMINI_2_5_PRO,
  Models.GEMINI_2_5_FLASH,
  Models.GEMINI_2_5_FLASH_LITE,
  Models.GEMINI_2_0_FLASH,
  Models.GEMINI_2_0_FLASH_LITE,
  Models.GEMINI_FLASH_LATEST,
  Models.GEMINI_FLASH_LITE_LATEST,
  Models.GEMINI_PRO_LATEST,
] as const;

export const DEFAULT_MODEL = Models.GEMINI_3_1_FLASH_LITE;
