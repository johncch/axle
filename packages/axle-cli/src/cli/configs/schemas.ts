import {
  AnthropicProviderConfig as AnthropicConfig,
  ChatCompletionsProviderConfig as ChatCompletionsConfig,
  GeminiProviderConfig as GeminiConfig,
  OpenAIProviderConfig as OpenAIConfig,
} from "@fifthrevision/axle";
import { z } from "zod";
import type { BraveProviderConfig } from "../../tools/types.js";

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

// Exec Provider
export const ExecProviderConfigSchema = z.object({
  timeout: z.number().optional(),
  maxBuffer: z.number().optional(),
  cwd: z.string().optional(),
});

const ApiKeyFieldsSchema = {
  "api-key": z.string().optional(),
  apiKeyEnv: z.string().optional(),
  "api-key-env": z.string().optional(),
};

// AI Provider Use - Discriminated by 'type'
const ChatCompletionsProviderUseSchema = z.strictObject({
  type: z.literal("chatcompletions"),
  "base-url": z.string().optional(),
  model: z.string().optional(),
  ...ApiKeyFieldsSchema,
});

const AnthropicProviderUseSchema = z.strictObject({
  type: z.literal("anthropic"),
  model: z.string().optional(),
  ...ApiKeyFieldsSchema,
});

const OpenAIProviderUseSchema = z.strictObject({
  type: z.literal("openai"),
  model: z.string().optional(),
  ...ApiKeyFieldsSchema,
});

const GeminiProviderUseSchema = z.strictObject({
  type: z.literal("gemini"),
  model: z.string().optional(),
  ...ApiKeyFieldsSchema,
});

export const AIProviderUseSchema = z.discriminatedUnion("type", [
  ChatCompletionsProviderUseSchema,
  AnthropicProviderUseSchema,
  OpenAIProviderUseSchema,
  GeminiProviderUseSchema,
]);

export type AIProviderUse = z.infer<typeof AIProviderUseSchema>;

// Service Config
export interface ServiceConfig {
  chatcompletions?: ChatCompletionsConfig;
  anthropic?: AnthropicConfig;
  openai?: OpenAIConfig;
  gemini?: GeminiConfig;
  brave?: BraveProviderConfig;
}

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
  name: z.string().optional(),
  provider: AIProviderUseSchema,
  task: z.string(),
  tools: z.array(z.string()).optional(),
  provider_tools: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  mcps: z.array(MCPConfigSchema).optional(),
  batch: BatchConfigSchema.optional(),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
