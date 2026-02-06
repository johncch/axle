export const Models = {
  // Gemini 3 family (newest - preview models)
  GEMINI_3_PRO_PREVIEW: "gemini-3-pro-preview",
  GEMINI_3_FLASH_PREVIEW: "gemini-3-flash-preview",
  GEMINI_3_PRO_IMAGE_PREVIEW: "gemini-3-pro-image-preview",

  // Gemini 2.5 family (latest stable - 2025)
  GEMINI_2_5_PRO: "gemini-2.5-pro",
  GEMINI_2_5_PRO_PREVIEW_TTS: "gemini-2.5-pro-preview-tts",
  GEMINI_2_5_FLASH: "gemini-2.5-flash",
  GEMINI_2_5_FLASH_LATEST: "gemini-2.5-flash", // Alias for latest 2.5 Flash
  GEMINI_2_5_FLASH_PREVIEW_09_2025: "gemini-2.5-flash-preview-09-2025",
  GEMINI_2_5_FLASH_PREVIEW_TTS: "gemini-2.5-flash-preview-tts",
  GEMINI_2_5_FLASH_NATIVE_AUDIO_LATEST: "gemini-2.5-flash-native-audio-latest",
  GEMINI_2_5_FLASH_NATIVE_AUDIO_PREVIEW_09_2025: "gemini-2.5-flash-native-audio-preview-09-2025",
  GEMINI_2_5_FLASH_NATIVE_AUDIO_PREVIEW_12_2025: "gemini-2.5-flash-native-audio-preview-12-2025",
  GEMINI_2_5_FLASH_IMAGE: "gemini-2.5-flash-image",
  GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite",
  GEMINI_2_5_FLASH_LITE_LATEST: "gemini-2.5-flash-lite", // Alias for latest 2.5 Flash Lite
  GEMINI_2_5_FLASH_LITE_PREVIEW_09_2025: "gemini-2.5-flash-lite-preview-09-2025",
  GEMINI_2_5_COMPUTER_USE_PREVIEW_10_2025: "gemini-2.5-computer-use-preview-10-2025",

  // Gemini 2.0 family (December 2024)
  GEMINI_2_0_FLASH: "gemini-2.0-flash",
  GEMINI_2_0_FLASH_001: "gemini-2.0-flash-001",
  GEMINI_2_0_FLASH_LATEST: "gemini-2.0-flash", // Alias for latest 2.0 Flash
  GEMINI_2_0_FLASH_EXP_IMAGE_GENERATION: "gemini-2.0-flash-exp-image-generation",
  GEMINI_2_0_FLASH_LITE: "gemini-2.0-flash-lite",
  GEMINI_2_0_FLASH_LITE_001: "gemini-2.0-flash-lite-001",
  GEMINI_2_0_FLASH_LITE_LATEST: "gemini-2.0-flash-lite", // Alias for latest 2.0 Flash Lite
  GEMINI_EXP_1206: "gemini-exp-1206",

  // Gemini latest aliases (automatically updated)
  GEMINI_FLASH_LATEST: "gemini-flash-latest",
  GEMINI_FLASH_LITE_LATEST: "gemini-flash-lite-latest",
  GEMINI_PRO_LATEST: "gemini-pro-latest",

  // Gemma family (open models - 2025)
  GEMMA_3_27B_IT: "gemma-3-27b-it",
  GEMMA_3_12B_IT: "gemma-3-12b-it",
  GEMMA_3_4B_IT: "gemma-3-4b-it",
  GEMMA_3_1B_IT: "gemma-3-1b-it",
  GEMMA_3N_E4B_IT: "gemma-3n-e4b-it",
  GEMMA_3N_E2B_IT: "gemma-3n-e2b-it",

  // Specialized models
  DEEP_RESEARCH_PRO_PREVIEW_12_2025: "deep-research-pro-preview-12-2025",
  GEMINI_ROBOTICS_ER_1_5_PREVIEW: "gemini-robotics-er-1.5-preview",
  NANO_BANANA_PRO_PREVIEW: "nano-banana-pro-preview",

  // Other
  AQA: "aqa",
} as const;

export const MULTIMODAL_MODELS = [
  // Gemini 3 family
  Models.GEMINI_3_PRO_PREVIEW,
  Models.GEMINI_3_FLASH_PREVIEW,
  Models.GEMINI_3_PRO_IMAGE_PREVIEW,

  // Gemini 2.5 family
  Models.GEMINI_2_5_PRO,
  Models.GEMINI_2_5_PRO_PREVIEW_TTS,
  Models.GEMINI_2_5_FLASH,
  Models.GEMINI_2_5_FLASH_LATEST,
  Models.GEMINI_2_5_FLASH_PREVIEW_09_2025,
  Models.GEMINI_2_5_FLASH_PREVIEW_TTS,
  Models.GEMINI_2_5_FLASH_NATIVE_AUDIO_LATEST,
  Models.GEMINI_2_5_FLASH_NATIVE_AUDIO_PREVIEW_09_2025,
  Models.GEMINI_2_5_FLASH_NATIVE_AUDIO_PREVIEW_12_2025,
  Models.GEMINI_2_5_FLASH_IMAGE,
  Models.GEMINI_2_5_FLASH_LITE,
  Models.GEMINI_2_5_FLASH_LITE_LATEST,
  Models.GEMINI_2_5_FLASH_LITE_PREVIEW_09_2025,
  Models.GEMINI_2_5_COMPUTER_USE_PREVIEW_10_2025,

  // Gemini 2.0 family
  Models.GEMINI_2_0_FLASH,
  Models.GEMINI_2_0_FLASH_001,
  Models.GEMINI_2_0_FLASH_LATEST,
  Models.GEMINI_2_0_FLASH_EXP_IMAGE_GENERATION,
  Models.GEMINI_2_0_FLASH_LITE,
  Models.GEMINI_2_0_FLASH_LITE_001,
  Models.GEMINI_2_0_FLASH_LITE_LATEST,
  Models.GEMINI_EXP_1206,

  // Latest aliases
  Models.GEMINI_FLASH_LATEST,
  Models.GEMINI_FLASH_LITE_LATEST,
  Models.GEMINI_PRO_LATEST,

  // Gemma family
  Models.GEMMA_3_27B_IT,
  Models.GEMMA_3_12B_IT,
  Models.GEMMA_3_4B_IT,
  Models.GEMMA_3_1B_IT,
  Models.GEMMA_3N_E4B_IT,
  Models.GEMMA_3N_E2B_IT,

  // Specialized
  Models.DEEP_RESEARCH_PRO_PREVIEW_12_2025,
  Models.GEMINI_ROBOTICS_ER_1_5_PREVIEW,
  Models.NANO_BANANA_PRO_PREVIEW,
] as const;

export const DEFAULT_MODEL = Models.GEMINI_2_5_FLASH;
