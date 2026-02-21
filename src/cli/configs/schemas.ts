import { z } from "zod";
import {
  AnthropicProviderConfig as AnthropicConfig,
  ChatCompletionsProviderConfig as ChatCompletionsConfig,
  GeminiProviderConfig as GeminiConfig,
  OpenAIProviderConfig as OpenAIConfig,
} from "../../providers/types.js";

/* ============================================================================
 * Validation Error Type
 * ========================================================================== */

export const ValidationErrorSchema = z.object({
  value: z.string(),
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

/* ============================================================================
 * Provider Configuration Schemas
 * ========================================================================== */

// Brave Provider
export const BraveProviderConfigSchema = z.object({
  "api-key": z.string(),
  rateLimit: z.number().optional(),
});

export type BraveProviderConfig = z.infer<typeof BraveProviderConfigSchema>;

// Exec Provider
export const ExecProviderConfigSchema = z.object({
  timeout: z.number().optional(),
  maxBuffer: z.number().optional(),
  cwd: z.string().optional(),
});

export type ExecProviderConfig = z.infer<typeof ExecProviderConfigSchema>;

// AI Provider Use - Discriminated by 'type'
const ChatCompletionsProviderUseSchema = z
  .object({
    type: z.literal("chatcompletions"),
  })
  .loose();

const AnthropicProviderUseSchema = z
  .object({
    type: z.literal("anthropic"),
  })
  .loose();

const OpenAIProviderUseSchema = z
  .object({
    type: z.literal("openai"),
  })
  .loose();

const GeminiProviderUseSchema = z
  .object({
    type: z.literal("gemini"),
  })
  .loose();

export const AIProviderUseSchema = z.discriminatedUnion("type", [
  ChatCompletionsProviderUseSchema,
  AnthropicProviderUseSchema,
  OpenAIProviderUseSchema,
  GeminiProviderUseSchema,
]);

export type AIProviderUse = z.infer<typeof AIProviderUseSchema>;

// Service Config
export const ServiceConfigSchema = z
  .object({
    chatcompletions: z.custom<ChatCompletionsConfig>().optional(),
    anthropic: z.custom<AnthropicConfig>().optional(),
    openai: z.custom<OpenAIConfig>().optional(),
    gemini: z.custom<GeminiConfig>().optional(),
    brave: BraveProviderConfigSchema.optional(),
  })
  .loose();

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export type ToolProviderConfig = {
  brave?: BraveProviderConfig;
  exec?: ExecProviderConfig;
};

/* ============================================================================
 * MCP Config Schemas
 * ========================================================================== */

const MCPStdioConfigSchema = z.object({
  transport: z.literal("stdio"),
  name: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const MCPHttpConfigSchema = z.object({
  transport: z.literal("http"),
  name: z.string().optional(),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const MCPConfigSchema = z.discriminatedUnion("transport", [
  MCPStdioConfigSchema,
  MCPHttpConfigSchema,
]);

export type MCPConfigUse = z.infer<typeof MCPConfigSchema>;

/* ============================================================================
 * Batch Config Schema
 * ========================================================================== */

export const BatchConfigSchema = z.object({
  files: z.string(),
  resume: z.boolean().default(false),
  concurrency: z.number().int().positive().default(3),
});

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

/* ============================================================================
 * Job Config Schema
 * ========================================================================== */

export const JobConfigSchema = z.object({
  provider: AIProviderUseSchema,
  task: z.string(),
  tools: z.array(z.string()).optional(),
  server_tools: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  mcps: z.array(MCPConfigSchema).optional(),
  batch: BatchConfigSchema.optional(),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
