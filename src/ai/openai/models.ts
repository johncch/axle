export const Models = {
  // GPT-5 family (newest - released August 2025)
  GPT_5: "gpt-5",
  GPT_5_MINI: "gpt-5-mini",
  GPT_5_NANO: "gpt-5-nano",
  GPT_5_CHAT_LATEST: "gpt-5-chat-latest",
  GPT_5_PRO: "gpt-5-pro",
  GPT_5_CODEX: "gpt-5-codex",

  // GPT-4.5 family (research preview - February 2025, being deprecated)
  GPT_4_5_PREVIEW: "gpt-4.5-preview",
  GPT_4_5_PREVIEW_2025_02_27: "gpt-4.5-preview-2025-02-27",

  // GPT-4.1 family (April 2025)
  GPT_4_1: "gpt-4.1",
  GPT_4_1_2025_04_14: "gpt-4.1-2025-04-14",
  GPT_4_1_MINI: "gpt-4.1-mini",
  GPT_4_1_MINI_2025_04_14: "gpt-4.1-mini-2025-04-14",
  GPT_4_1_NANO: "gpt-4.1-nano",
  GPT_4_1_NANO_2025_04_14: "gpt-4.1-nano-2025-04-14",

  // GPT-4o family (still current)
  GPT_4O: "gpt-4o",
  GPT_4O_2024_05_13: "gpt-4o-2024-05-13",
  GPT_4O_2024_08_06: "gpt-4o-2024-08-06",
  GPT_4O_2024_11_20: "gpt-4o-2024-11-20",
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4O_MINI_2024_07_18: "gpt-4o-mini-2024-07-18",

  // Audio models
  GPT_4O_AUDIO_PREVIEW: "gpt-4o-audio-preview",
  GPT_4O_AUDIO_PREVIEW_2024_10_01: "gpt-4o-audio-preview-2024-10-01",
  GPT_4O_AUDIO_PREVIEW_2024_12_17: "gpt-4o-audio-preview-2024-12-17",
  GPT_4O_AUDIO_PREVIEW_2025_06_03: "gpt-4o-audio-preview-2025-06-03",
  GPT_4O_MINI_AUDIO_PREVIEW: "gpt-4o-mini-audio-preview",
  GPT_4O_MINI_AUDIO_PREVIEW_2024_12_17: "gpt-4o-mini-audio-preview-2024-12-17",

  // Realtime API models (August 2025 - GA)
  GPT_REALTIME: "gpt-realtime",
  GPT_REALTIME_MINI: "gpt-realtime-mini",
  GPT_4O_REALTIME_PREVIEW: "gpt-4o-realtime-preview",
  GPT_4O_REALTIME_PREVIEW_2024_10_01: "gpt-4o-realtime-preview-2024-10-01",
  GPT_4O_REALTIME_PREVIEW_2024_12_17: "gpt-4o-realtime-preview-2024-12-17",
  GPT_4O_REALTIME_PREVIEW_2025_06_03: "gpt-4o-realtime-preview-2025-06-03",
  GPT_4O_MINI_REALTIME_PREVIEW: "gpt-4o-mini-realtime-preview",
  GPT_4O_MINI_REALTIME_PREVIEW_2024_12_17: "gpt-4o-mini-realtime-preview-2024-12-17",

  // Search models
  GPT_4O_SEARCH_PREVIEW: "gpt-4o-search-preview",
  GPT_4O_SEARCH_PREVIEW_2025_03_11: "gpt-4o-search-preview-2025-03-11",
  GPT_4O_MINI_SEARCH_PREVIEW: "gpt-4o-mini-search-preview",
  GPT_4O_MINI_SEARCH_PREVIEW_2025_03_11: "gpt-4o-mini-search-preview-2025-03-11",

  // Transcription/TTS
  GPT_4O_TRANSCRIBE: "gpt-4o-transcribe",
  GPT_4O_MINI_TRANSCRIBE: "gpt-4o-mini-transcribe",
  GPT_4O_MINI_TTS: "gpt-4o-mini-tts",

  // Image models
  GPT_IMAGE_1: "gpt-image-1",
  GPT_IMAGE_1_MINI: "gpt-image-1-mini",

  // o-series reasoning models (latest)
  O4_MINI: "o4-mini",
  O4_MINI_2025_04_16: "o4-mini-2025-04-16",
  O3: "o3",
  O3_PRO: "o3-pro",
  O3_MINI: "o3-mini",
  O3_MINI_2025_01_31: "o3-mini-2025-01-31",
  O1_PRO: "o1-pro",
  O1_PRO_2025_03_19: "o1-pro-2025-03-19",
  O1: "o1",
  O1_2024_12_17: "o1-2024-12-17",
  O1_MINI: "o1-mini",
  O1_MINI_2024_09_12: "o1-mini-2024-09-12",
  O1_PREVIEW: "o1-preview",
  O1_PREVIEW_2024_09_12: "o1-preview-2024-09-12",

  // Open-weight models (August 2025)
  GPT_OSS_120B: "gpt-oss-120b",
  GPT_OSS_7B: "gpt-oss-7b",

  // Video generation
  SORA_2: "sora-2",
  SORA_2025_05_02: "sora-2025-05-02",

  // Specialized models
  CODEX_MINI: "codex-mini",
  COMPUTER_USE_PREVIEW: "computer-use-preview",
} as const;

export const RESPONSES_API_MODELS = [
  // GPT-5 family
  Models.GPT_5,
  Models.GPT_5_MINI,
  Models.GPT_5_NANO,
  Models.GPT_5_CHAT_LATEST,
  Models.GPT_5_PRO,
  Models.GPT_5_CODEX,

  // GPT-4.1 family
  Models.GPT_4_1,
  Models.GPT_4_1_2025_04_14,
  Models.GPT_4_1_MINI,
  Models.GPT_4_1_MINI_2025_04_14,
  Models.GPT_4_1_NANO,
  Models.GPT_4_1_NANO_2025_04_14,

  // GPT-4o family
  Models.GPT_4O,
  Models.GPT_4O_2024_05_13,
  Models.GPT_4O_2024_08_06,
  Models.GPT_4O_2024_11_20,
  Models.GPT_4O_MINI,
  Models.GPT_4O_MINI_2024_07_18,

  // Audio models
  Models.GPT_4O_AUDIO_PREVIEW,
  Models.GPT_4O_AUDIO_PREVIEW_2024_10_01,
  Models.GPT_4O_AUDIO_PREVIEW_2024_12_17,
  Models.GPT_4O_AUDIO_PREVIEW_2025_06_03,
  Models.GPT_4O_MINI_AUDIO_PREVIEW,
  Models.GPT_4O_MINI_AUDIO_PREVIEW_2024_12_17,

  // Realtime models
  Models.GPT_REALTIME,
  Models.GPT_REALTIME_MINI,
  Models.GPT_4O_REALTIME_PREVIEW,
  Models.GPT_4O_REALTIME_PREVIEW_2024_10_01,
  Models.GPT_4O_REALTIME_PREVIEW_2024_12_17,
  Models.GPT_4O_REALTIME_PREVIEW_2025_06_03,
  Models.GPT_4O_MINI_REALTIME_PREVIEW,
  Models.GPT_4O_MINI_REALTIME_PREVIEW_2024_12_17,

  // Search models
  Models.GPT_4O_SEARCH_PREVIEW,
  Models.GPT_4O_SEARCH_PREVIEW_2025_03_11,
  Models.GPT_4O_MINI_SEARCH_PREVIEW,
  Models.GPT_4O_MINI_SEARCH_PREVIEW_2025_03_11,

  // Transcription
  Models.GPT_4O_TRANSCRIBE,
  Models.GPT_4O_MINI_TRANSCRIBE,

  // o-series reasoning
  Models.O4_MINI,
  Models.O4_MINI_2025_04_16,
  Models.O3,
  Models.O3_PRO,
  Models.O3_MINI,
  Models.O3_MINI_2025_01_31,
] as const;

export const DEFAULT_MODEL = Models.GPT_5;
