export const Models = {
  // Claude 4.6 family (February 2025 - newest)
  CLAUDE_SONNET_4_6: "claude-sonnet-4-6",
  CLAUDE_OPUS_4_6: "claude-opus-4-6",

  // Claude 4.5 family (September-November 2024)
  CLAUDE_OPUS_4_5_20251101: "claude-opus-4-5-20251101",
  CLAUDE_OPUS_4_5: "claude-opus-4-5-20251101", // Alias for latest 4.5 Opus
  CLAUDE_HAIKU_4_5_20251001: "claude-haiku-4-5-20251001",
  CLAUDE_HAIKU_4_5: "claude-haiku-4-5-20251001", // Alias for latest 4.5 Haiku
  CLAUDE_SONNET_4_5_20250929: "claude-sonnet-4-5-20250929",
  CLAUDE_SONNET_4_5: "claude-sonnet-4-5-20250929", // Alias for latest 4.5 Sonnet

  // Claude 4.1 family (August 2024)
  CLAUDE_OPUS_4_1_20250805: "claude-opus-4-1-20250805",
  CLAUDE_OPUS_4_1: "claude-opus-4-1-20250805", // Alias for latest 4.1

  // Claude 4 family (May 2024)
  CLAUDE_OPUS_4_20250514: "claude-opus-4-20250514",
  CLAUDE_OPUS_4: "claude-opus-4-20250514", // Alias for latest 4.0 Opus
  CLAUDE_SONNET_4_20250514: "claude-sonnet-4-20250514",
  CLAUDE_SONNET_4: "claude-sonnet-4-20250514", // Alias for latest 4.0 Sonnet

  // Claude 3.7 family (February 2025)
  CLAUDE_3_7_SONNET_20250219: "claude-3-7-sonnet-20250219",
  CLAUDE_3_7_SONNET: "claude-3-7-sonnet-20250219", // Alias for latest 3.7

  // Claude 3.5 family (October 2024)
  CLAUDE_3_5_HAIKU_20241022: "claude-3-5-haiku-20241022",
  CLAUDE_3_5_HAIKU: "claude-3-5-haiku-20241022", // Alias for latest 3.5 Haiku

  // Claude 3 family (March 2024)
  CLAUDE_3_HAIKU_20240307: "claude-3-haiku-20240307",
  CLAUDE_3_HAIKU: "claude-3-haiku-20240307", // Alias for latest 3 Haiku
} as const;

export const MULTIMODAL_MODELS = [
  Models.CLAUDE_SONNET_4_6,
  Models.CLAUDE_OPUS_4_6,
  Models.CLAUDE_OPUS_4_5_20251101,
  Models.CLAUDE_OPUS_4_5,
  Models.CLAUDE_HAIKU_4_5_20251001,
  Models.CLAUDE_HAIKU_4_5,
  Models.CLAUDE_SONNET_4_5_20250929,
  Models.CLAUDE_SONNET_4_5,
  Models.CLAUDE_OPUS_4_1_20250805,
  Models.CLAUDE_OPUS_4_1,
  Models.CLAUDE_OPUS_4_20250514,
  Models.CLAUDE_OPUS_4,
  Models.CLAUDE_SONNET_4_20250514,
  Models.CLAUDE_SONNET_4,
  Models.CLAUDE_3_7_SONNET_20250219,
  Models.CLAUDE_3_7_SONNET,
  Models.CLAUDE_3_5_HAIKU_20241022,
  Models.CLAUDE_3_5_HAIKU,
  Models.CLAUDE_3_HAIKU_20240307,
  Models.CLAUDE_3_HAIKU,
] as const;

// Default to the cheapest modern model (Haiku 4.5)
export const DEFAULT_MODEL = Models.CLAUDE_HAIKU_4_5;
