import { z } from "zod";
import {
  AnthropicProviderConfig as AnthropicConfig,
  GeminiProviderConfig as GeminiConfig,
  OllamaProviderConfig as OllamaConfig,
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
const OllamaProviderUseSchema = z
  .object({
    type: z.literal("ollama"),
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
  OllamaProviderUseSchema,
  AnthropicProviderUseSchema,
  OpenAIProviderUseSchema,
  GeminiProviderUseSchema,
]);

export type AIProviderUse = z.infer<typeof AIProviderUseSchema>;

// Service Config
export const ServiceConfigSchema = z
  .object({
    ollama: z.custom<OllamaConfig>().optional(),
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
  files: z.array(z.string()).optional(),
  batch: BatchConfigSchema.optional(),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
