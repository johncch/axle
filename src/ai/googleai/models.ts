export const Models = {
  // Gemini 2.5 family (newest and most capable)
  GEMINI_2_5_PRO: "gemini-2.5-pro",
  GEMINI_2_5_FLASH: "gemini-2.5-flash",
  GEMINI_2_5_FLASH_PREVIEW_05_20: "gemini-2.5-flash-preview-05-20",
  GEMINI_2_5_FLASH_LITE: "gemini-2.5-flash-lite",
  GEMINI_2_5_FLASH_LITE_PREVIEW_06_17: "gemini-2.5-flash-lite-preview-06-17",
  GEMINI_2_5_FLASH_LIVE_PREVIEW: "gemini-live-2.5-flash-preview",
  GEMINI_2_5_FLASH_PREVIEW_NATIVE_AUDIO_DIALOG: "gemini-2.5-flash-preview-native-audio-dialog",
  GEMINI_2_5_FLASH_EXP_NATIVE_AUDIO_THINKING_DIALOG:
    "gemini-2.5-flash-exp-native-audio-thinking-dialog",
  GEMINI_2_5_FLASH_IMAGE_PREVIEW: "gemini-2.5-flash-image-preview",
  GEMINI_2_5_FLASH_PREVIEW_TTS: "gemini-2.5-flash-preview-tts",
  GEMINI_2_5_PRO_PREVIEW_TTS: "gemini-2.5-pro-preview-tts",

  // Gemini 2.0 family
  GEMINI_2_0_FLASH: "gemini-2.0-flash",
  GEMINI_2_0_FLASH_001: "gemini-2.0-flash-001",
  GEMINI_2_0_FLASH_EXP: "gemini-2.0-flash-exp",
  GEMINI_2_0_FLASH_PREVIEW_IMAGE_GENERATION: "gemini-2.0-flash-preview-image-generation",
  GEMINI_2_0_FLASH_LITE: "gemini-2.0-flash-lite",
  GEMINI_2_0_FLASH_LITE_001: "gemini-2.0-flash-lite-001",
  GEMINI_2_0_FLASH_LIVE_001: "gemini-2.0-flash-live-001",

  // Gemini 1.5 family (deprecated but still available)
  GEMINI_1_5_PRO: "gemini-1.5-pro",
  GEMINI_1_5_PRO_LATEST: "gemini-1.5-pro-latest",
  GEMINI_1_5_PRO_001: "gemini-1.5-pro-001",
  GEMINI_1_5_PRO_002: "gemini-1.5-pro-002",
  GEMINI_1_5_FLASH: "gemini-1.5-flash",
  GEMINI_1_5_FLASH_LATEST: "gemini-1.5-flash-latest",
  GEMINI_1_5_FLASH_001: "gemini-1.5-flash-001",
  GEMINI_1_5_FLASH_002: "gemini-1.5-flash-002",
  GEMINI_1_5_FLASH_8B: "gemini-1.5-flash-8b",
  GEMINI_1_5_FLASH_8B_LATEST: "gemini-1.5-flash-8b-latest",
  GEMINI_1_5_FLASH_8B_001: "gemini-1.5-flash-8b-001",

  // Gemma family (open models)
  GEMMA_3N_E4B_IT: "gemma-3n-e4b-it",
  GEMMA_3_1B_IT: "gemma-3-1b-it",
  GEMMA_3_4B_IT: "gemma-3-4b-it",
  GEMMA_3_12B_IT: "gemma-3-12b-it",
  GEMMA_3_27B_IT: "gemma-3-27b-it",

  // Specialized models
  LEARNLM_2_0_FLASH_EXPERIMENTAL: "learnlm-2.0-flash-experimental",

  // Embedding models
  EMBEDDING_001: "embedding-001",
  TEXT_EMBEDDING_004: "text-embedding-004",
} as const;

export const MULTIMODAL_MODELS = [
  // Gemini 2.5 family
  Models.GEMINI_2_5_PRO,
  Models.GEMINI_2_5_FLASH,
  Models.GEMINI_2_5_FLASH_PREVIEW_05_20,
  Models.GEMINI_2_5_FLASH_LITE,
  Models.GEMINI_2_5_FLASH_LITE_PREVIEW_06_17,
  Models.GEMINI_2_5_FLASH_LIVE_PREVIEW,
  Models.GEMINI_2_5_FLASH_PREVIEW_NATIVE_AUDIO_DIALOG,
  Models.GEMINI_2_5_FLASH_EXP_NATIVE_AUDIO_THINKING_DIALOG,
  Models.GEMINI_2_5_FLASH_IMAGE_PREVIEW,

  // Gemini 2.0 family
  Models.GEMINI_2_0_FLASH,
  Models.GEMINI_2_0_FLASH_001,
  Models.GEMINI_2_0_FLASH_EXP,
  Models.GEMINI_2_0_FLASH_PREVIEW_IMAGE_GENERATION,
  Models.GEMINI_2_0_FLASH_LITE,
  Models.GEMINI_2_0_FLASH_LITE_001,
  Models.GEMINI_2_0_FLASH_LIVE_001,

  // Gemini 1.5 family
  Models.GEMINI_1_5_PRO,
  Models.GEMINI_1_5_PRO_LATEST,
  Models.GEMINI_1_5_PRO_001,
  Models.GEMINI_1_5_PRO_002,
  Models.GEMINI_1_5_FLASH,
  Models.GEMINI_1_5_FLASH_LATEST,
  Models.GEMINI_1_5_FLASH_001,
  Models.GEMINI_1_5_FLASH_002,
  Models.GEMINI_1_5_FLASH_8B,
  Models.GEMINI_1_5_FLASH_8B_LATEST,
  Models.GEMINI_1_5_FLASH_8B_001,

  // Gemma family (multimodal capable)
  Models.GEMMA_3N_E4B_IT,
  Models.GEMMA_3_1B_IT,
  Models.GEMMA_3_4B_IT,
  Models.GEMMA_3_12B_IT,
  Models.GEMMA_3_27B_IT,

  // Specialized
  Models.LEARNLM_2_0_FLASH_EXPERIMENTAL,
] as const;

export const DEFAULT_MODEL = Models.GEMINI_2_5_FLASH;
