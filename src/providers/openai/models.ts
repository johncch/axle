export const Models = {
  // GPT-5.2 family (December 2025 - newest)
  GPT_5_2: "gpt-5.2",
  GPT_5_2_2025_12_11: "gpt-5.2-2025-12-11",
  GPT_5_2_CHAT_LATEST: "gpt-5.2-chat-latest",
  GPT_5_2_PRO: "gpt-5.2-pro",
  GPT_5_2_PRO_2025_12_11: "gpt-5.2-pro-2025-12-11",
  GPT_5_2_CODEX: "gpt-5.2-codex",

  // GPT-5.1 family (November 2025)
  GPT_5_1: "gpt-5.1",
  GPT_5_1_2025_11_13: "gpt-5.1-2025-11-13",
  GPT_5_1_CHAT_LATEST: "gpt-5.1-chat-latest",
  GPT_5_1_CODEX: "gpt-5.1-codex",
  GPT_5_1_CODEX_MAX: "gpt-5.1-codex-max",
  GPT_5_1_CODEX_MINI: "gpt-5.1-codex-mini",

  // GPT-5 family (August 2025)
  GPT_5: "gpt-5",
  GPT_5_2025_08_07: "gpt-5-2025-08-07",
  GPT_5_CHAT_LATEST: "gpt-5-chat-latest",
  GPT_5_CODEX: "gpt-5-codex",
  GPT_5_MINI: "gpt-5-mini",
  GPT_5_MINI_2025_08_07: "gpt-5-mini-2025-08-07",
  GPT_5_NANO: "gpt-5-nano",
  GPT_5_NANO_2025_08_07: "gpt-5-nano-2025-08-07",
  GPT_5_PRO: "gpt-5-pro",
  GPT_5_PRO_2025_10_06: "gpt-5-pro-2025-10-06",
  GPT_5_SEARCH_API: "gpt-5-search-api",
  GPT_5_SEARCH_API_2025_10_14: "gpt-5-search-api-2025-10-14",

  // GPT-4.1 family (April 2025)
  GPT_4_1: "gpt-4.1",
  GPT_4_1_2025_04_14: "gpt-4.1-2025-04-14",
  GPT_4_1_MINI: "gpt-4.1-mini",
  GPT_4_1_MINI_2025_04_14: "gpt-4.1-mini-2025-04-14",
  GPT_4_1_NANO: "gpt-4.1-nano",
  GPT_4_1_NANO_2025_04_14: "gpt-4.1-nano-2025-04-14",

  // GPT-4o family (2024 - stable)
  GPT_4O: "gpt-4o",
  GPT_4O_2024_11_20: "gpt-4o-2024-11-20",
  GPT_4O_2024_08_06: "gpt-4o-2024-08-06",
  GPT_4O_2024_05_13: "gpt-4o-2024-05-13",
  GPT_4O_MINI: "gpt-4o-mini",
  GPT_4O_MINI_2024_07_18: "gpt-4o-mini-2024-07-18",
  GPT_4O_SEARCH_PREVIEW: "gpt-4o-search-preview",
  GPT_4O_SEARCH_PREVIEW_2025_03_11: "gpt-4o-search-preview-2025-03-11",
  GPT_4O_MINI_SEARCH_PREVIEW: "gpt-4o-mini-search-preview",
  GPT_4O_MINI_SEARCH_PREVIEW_2025_03_11: "gpt-4o-mini-search-preview-2025-03-11",

  // GPT-4 Turbo family (2024)
  GPT_4_TURBO: "gpt-4-turbo",
  GPT_4_TURBO_2024_04_09: "gpt-4-turbo-2024-04-09",
  GPT_4_TURBO_PREVIEW: "gpt-4-turbo-preview",
  GPT_4_0125_PREVIEW: "gpt-4-0125-preview",
  GPT_4_1106_PREVIEW: "gpt-4-1106-preview",
  GPT_4: "gpt-4",
  GPT_4_0613: "gpt-4-0613",

  // GPT-3.5 Turbo family (2024)
  GPT_3_5_TURBO: "gpt-3.5-turbo",
  GPT_3_5_TURBO_0125: "gpt-3.5-turbo-0125",
  GPT_3_5_TURBO_1106: "gpt-3.5-turbo-1106",
  GPT_3_5_TURBO_16K: "gpt-3.5-turbo-16k",
  GPT_3_5_TURBO_INSTRUCT: "gpt-3.5-turbo-instruct",
  GPT_3_5_TURBO_INSTRUCT_0914: "gpt-3.5-turbo-instruct-0914",

  // o-series reasoning models (o4 - April 2025)
  O4_MINI: "o4-mini",
  O4_MINI_2025_04_16: "o4-mini-2025-04-16",
  O4_MINI_DEEP_RESEARCH: "o4-mini-deep-research",
  O4_MINI_DEEP_RESEARCH_2025_06_26: "o4-mini-deep-research-2025-06-26",

  // o-series reasoning models (o3 - January-June 2025)
  O3: "o3",
  O3_2025_04_16: "o3-2025-04-16",
  O3_PRO: "o3-pro",
  O3_PRO_2025_06_10: "o3-pro-2025-06-10",
  O3_MINI: "o3-mini",
  O3_MINI_2025_01_31: "o3-mini-2025-01-31",
  O3_DEEP_RESEARCH: "o3-deep-research",
  O3_DEEP_RESEARCH_2025_06_26: "o3-deep-research-2025-06-26",

  // o-series reasoning models (o1 - December 2024)
  O1: "o1",
  O1_2024_12_17: "o1-2024-12-17",
  O1_PRO: "o1-pro",
  O1_PRO_2025_03_19: "o1-pro-2025-03-19",

  // Computer use models
  COMPUTER_USE_PREVIEW: "computer-use-preview",
  COMPUTER_USE_PREVIEW_2025_03_11: "computer-use-preview-2025-03-11",

  // ChatGPT vision
  CHATGPT_IMAGE_LATEST: "chatgpt-image-latest",
} as const;

// Default to the cheapest modern model (GPT-5 Mini)
export const DEFAULT_MODEL = Models.GPT_5_MINI;
