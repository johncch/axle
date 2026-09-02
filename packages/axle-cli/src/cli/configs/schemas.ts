import { z } from "zod";

/* ============================================================================
 * Provider Configuration Schemas
 * ========================================================================== */

const ApiKeyFieldsSchema = {
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
};

const ProviderClientFieldsSchema = {
  maxRetries: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
};

// AI Provider Use - Discriminated by 'type'
const ChatCompletionsProviderUseSchema = z.strictObject({
  type: z.literal("chatcompletions"),
  baseUrl: z.string().optional(),
  vendor: z.enum(["openrouter", "together"]).optional(),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const AnthropicProviderUseSchema = z.strictObject({
  type: z.literal("anthropic"),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const OpenAIProviderUseSchema = z.strictObject({
  type: z.literal("openai"),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const GeminiProviderUseSchema = z.strictObject({
  type: z.literal("gemini"),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

export const AIProviderUseSchema = z.discriminatedUnion("type", [
  ChatCompletionsProviderUseSchema,
  AnthropicProviderUseSchema,
  OpenAIProviderUseSchema,
  GeminiProviderUseSchema,
]);

export type AIProviderUse = z.infer<typeof AIProviderUseSchema>;

const ProviderTypeSchema = z.enum(["anthropic", "openai", "gemini", "chatcompletions"]);

export const ProviderUseSchema = z.union([
  ProviderTypeSchema.transform((type) => ({ type })),
  AIProviderUseSchema,
]);

// Service Config
export interface ProviderServiceConfig {
  apiKey?: string;
  apiKeyEnv?: string;
  model?: string;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface ChatCompletionsServiceConfig extends ProviderServiceConfig {
  baseUrl?: string;
  vendor?: "openrouter" | "together";
}

export interface ServiceConfig {
  chatcompletions?: ChatCompletionsServiceConfig;
  anthropic?: ProviderServiceConfig;
  openai?: ProviderServiceConfig;
  gemini?: ProviderServiceConfig;
}

/* ============================================================================
 * CLI Config Schema (cli.yaml)
 * ========================================================================== */

export const CliConfigSchema = z.object({
  providers: z.record(z.string(), AIProviderUseSchema).optional(),
  defaults: z
    .object({
      provider: z.string().optional(),
      models: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

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

export const RequestOptionsSchema = z.strictObject({
  reasoning: z.boolean().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  toolChoice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.strictObject({ type: z.literal("tool"), name: z.string() }),
    ])
    .optional(),
  parallelToolCalls: z.boolean().optional(),
  providerOptions: z.record(z.string(), z.any()).optional(),
});

export type RequestOptions = z.infer<typeof RequestOptionsSchema>;

export const JobConfigSchema = z.object({
  name: z.string().optional(),
  provider: ProviderUseSchema.optional(),
  model: z.string().optional(),
  system: z.string().optional(),
  request: RequestOptionsSchema.optional(),
  task: z.string(),
  tools: z.array(z.string()).optional(),
  providerTools: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  mcps: z.array(MCPConfigSchema).optional(),
  batch: BatchConfigSchema.optional(),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
