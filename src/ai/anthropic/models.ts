export const Models = {
  // Claude 4.5 family (newest)
  CLAUDE_SONNET_4_5_20250929: "claude-sonnet-4-5-20250929",
  CLAUDE_SONNET_4_5_LATEST: "claude-sonnet-4-5",
  CLAUDE_HAIKU_4_5: "claude-haiku-4-5",

  // Claude 4.1 family
  CLAUDE_OPUS_4_1_20250805: "claude-opus-4-1-20250805",
  CLAUDE_OPUS_4_1_LATEST: "claude-opus-4-1",

  // Claude 4 family
  CLAUDE_OPUS_4_20250514: "claude-opus-4-20250514",
  CLAUDE_OPUS_4_LATEST: "claude-opus-4-0",
  CLAUDE_SONNET_4_20250514: "claude-sonnet-4-20250514",
  CLAUDE_SONNET_4_LATEST: "claude-sonnet-4-0",

  // Claude 3.7 family
  CLAUDE_3_7_SONNET_20250219: "claude-3-7-sonnet-20250219",
  CLAUDE_3_7_SONNET_LATEST: "claude-3-7-sonnet-latest",

  // Claude 3.5 family
  CLAUDE_3_5_SONNET_20241022: "claude-3-5-sonnet-20241022",
  CLAUDE_3_5_HAIKU_20241022: "claude-3-5-haiku-20241022",
  CLAUDE_3_5_HAIKU_LATEST: "claude-3-5-haiku-latest",
  CLAUDE_3_5_SONNET_20240620: "claude-3-5-sonnet-20240620",
} as const;

export const MULTIMODAL_MODELS = [
  Models.CLAUDE_SONNET_4_5_20250929,
  Models.CLAUDE_SONNET_4_5_LATEST,
  Models.CLAUDE_HAIKU_4_5,
  Models.CLAUDE_OPUS_4_1_20250805,
  Models.CLAUDE_OPUS_4_1_LATEST,
  Models.CLAUDE_OPUS_4_20250514,
  Models.CLAUDE_OPUS_4_LATEST,
  Models.CLAUDE_SONNET_4_20250514,
  Models.CLAUDE_SONNET_4_LATEST,
  Models.CLAUDE_3_7_SONNET_20250219,
  Models.CLAUDE_3_7_SONNET_LATEST,
  Models.CLAUDE_3_5_SONNET_20241022,
  Models.CLAUDE_3_5_HAIKU_20241022,
  Models.CLAUDE_3_5_HAIKU_LATEST,
  Models.CLAUDE_3_5_SONNET_20240620,
];

export const DEFAULT_MODEL = Models.CLAUDE_HAIKU_4_5;
