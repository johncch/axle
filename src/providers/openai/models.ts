export const Models = {
  GPT_5_4_2026_03_05: "gpt-5.4-2026-03-05",
  GPT_5_4: "gpt-5.4",

  GPT_5_4_PRO_2026_03_05: "gpt-5.4-pro-2026-03-05",
  GPT_5_4_PRO: "gpt-5.4-pro",

  GPT_5_4_MINI_2026_03_17: "gpt-5.4-mini-2026-03-17",
  GPT_5_4_MINI: "gpt-5.4-mini",

  GPT_5_4_NANO_2026_03_17: "gpt-5.4-nano-2026-03-17",
  GPT_5_4_NANO: "gpt-5.4-nano",

  GPT_5_3_CHAT_LATEST: "gpt-5.3-chat-latest",

  GPT_5_2_2025_12_11: "gpt-5.2-2025-12-11",
  GPT_5_2: "gpt-5.2",
  GPT_5_2_CHAT_LATEST: "gpt-5.2-chat-latest",

  GPT_5_2_PRO_2025_12_11: "gpt-5.2-pro-2025-12-11",
  GPT_5_2_PRO: "gpt-5.2-pro",

  GPT_5_1_2025_11_13: "gpt-5.1-2025-11-13",
  GPT_5_1: "gpt-5.1",
  GPT_5_1_CHAT_LATEST: "gpt-5.1-chat-latest",

  GPT_5_2025_08_07: "gpt-5-2025-08-07",
  GPT_5: "gpt-5",
  GPT_5_CHAT_LATEST: "gpt-5-chat-latest",

  GPT_5_PRO_2025_10_06: "gpt-5-pro-2025-10-06",
  GPT_5_PRO: "gpt-5-pro",

  GPT_5_MINI_2025_08_07: "gpt-5-mini-2025-08-07",
  GPT_5_MINI: "gpt-5-mini",

  GPT_5_NANO_2025_08_07: "gpt-5-nano-2025-08-07",
  GPT_5_NANO: "gpt-5-nano",

  GPT_4_1_2025_04_14: "gpt-4.1-2025-04-14",
  GPT_4_1: "gpt-4.1",

  GPT_4_1_MINI_2025_04_14: "gpt-4.1-mini-2025-04-14",
  GPT_4_1_MINI: "gpt-4.1-mini",

  GPT_4_1_NANO_2025_04_14: "gpt-4.1-nano-2025-04-14",
  GPT_4_1_NANO: "gpt-4.1-nano",

  GPT_4O_2024_11_20: "gpt-4o-2024-11-20",
  GPT_4O_2024_08_06: "gpt-4o-2024-08-06",
  GPT_4O_2024_05_13: "gpt-4o-2024-05-13",
  GPT_4O: "gpt-4o",

  GPT_4O_MINI_2024_07_18: "gpt-4o-mini-2024-07-18",
  GPT_4O_MINI: "gpt-4o-mini",

  GPT_4_TURBO_2024_04_09: "gpt-4-turbo-2024-04-09",
  GPT_4_TURBO: "gpt-4-turbo",

  O4_MINI_2025_04_16: "o4-mini-2025-04-16",
  O4_MINI: "o4-mini",

  O3_2025_04_16: "o3-2025-04-16",
  O3: "o3",

  O3_PRO_2025_06_10: "o3-pro-2025-06-10",
  O3_PRO: "o3-pro",

  O3_MINI_2025_01_31: "o3-mini-2025-01-31",
  O3_MINI: "o3-mini",

  O1_2024_12_17: "o1-2024-12-17",
  O1: "o1",

  O1_PRO_2025_03_19: "o1-pro-2025-03-19",
  O1_PRO: "o1-pro",
} as const;

export const MULTIMODAL_MODELS = [
  Models.GPT_5_4,
  Models.GPT_5_4_PRO,
  Models.GPT_5_4_MINI,
  Models.GPT_5_4_NANO,
  Models.GPT_5_3_CHAT_LATEST,
  Models.GPT_5_2,
  Models.GPT_5_2_PRO,
  Models.GPT_5_1,
  Models.GPT_5,
  Models.GPT_5_PRO,
  Models.GPT_5_MINI,
  Models.GPT_5_NANO,
  Models.GPT_4_1,
  Models.GPT_4_1_MINI,
  Models.GPT_4_1_NANO,
  Models.GPT_4O,
  Models.GPT_4O_MINI,
  Models.GPT_4_TURBO,
  Models.O4_MINI,
  Models.O3,
  Models.O3_PRO,
  Models.O3_MINI,
  Models.O1,
  Models.O1_PRO,
] as const;

export const DEFAULT_MODEL = Models.GPT_5_4_MINI;
