export const Models = {
  CLAUDE_OPUS_4_7: "claude-opus-4-7",

  CLAUDE_SONNET_4_6: "claude-sonnet-4-6",
  CLAUDE_OPUS_4_6: "claude-opus-4-6",

  CLAUDE_OPUS_4_5_20251101: "claude-opus-4-5-20251101",
  CLAUDE_OPUS_4_5: "claude-opus-4-5-20251101",

  CLAUDE_SONNET_4_5_20250929: "claude-sonnet-4-5-20250929",
  CLAUDE_SONNET_4_5: "claude-sonnet-4-5-20250929",

  CLAUDE_HAIKU_4_5_20251001: "claude-haiku-4-5-20251001",
  CLAUDE_HAIKU_4_5: "claude-haiku-4-5-20251001",

  CLAUDE_OPUS_4_1_20250805: "claude-opus-4-1-20250805",
  CLAUDE_OPUS_4_1: "claude-opus-4-1-20250805",

  CLAUDE_OPUS_4_20250514: "claude-opus-4-20250514",
  CLAUDE_OPUS_4: "claude-opus-4-20250514",

  CLAUDE_SONNET_4_20250514: "claude-sonnet-4-20250514",
  CLAUDE_SONNET_4: "claude-sonnet-4-20250514",
} as const;

export const MULTIMODAL_MODELS = [
  Models.CLAUDE_OPUS_4_7,
  Models.CLAUDE_SONNET_4_6,
  Models.CLAUDE_OPUS_4_6,
  Models.CLAUDE_OPUS_4_5,
  Models.CLAUDE_SONNET_4_5,
  Models.CLAUDE_HAIKU_4_5,
  Models.CLAUDE_OPUS_4_1,
  Models.CLAUDE_OPUS_4,
  Models.CLAUDE_SONNET_4,
] as const;

export const MAX_OUTPUT_TOKENS: Record<string, number> = {
  [Models.CLAUDE_OPUS_4_7]: 128_000,
  [Models.CLAUDE_OPUS_4_6]: 128_000,
  [Models.CLAUDE_SONNET_4_6]: 64_000,
  [Models.CLAUDE_OPUS_4_5]: 64_000,
  [Models.CLAUDE_SONNET_4_5]: 64_000,
  [Models.CLAUDE_HAIKU_4_5]: 64_000,
  [Models.CLAUDE_SONNET_4]: 64_000,
  [Models.CLAUDE_OPUS_4_1]: 32_000,
  [Models.CLAUDE_OPUS_4]: 32_000,
};

export const DEFAULT_MODEL = Models.CLAUDE_HAIKU_4_5;
