import { z } from "zod";
import {
  CLOCK_TIME_PATTERN,
  INTERVAL_PATTERN,
  parseInterval,
  WEEKDAY_NAMES,
} from "../schedule/trigger.js";

/* ============================================================================
 * Provider Configuration Schemas
 * ========================================================================== */

const ApiKeyFieldsSchema = {
  apiKey: z
    .string()
    .optional()
    .describe("API key, inline. Prefer apiKeyEnv or a credentials file."),
  apiKeyEnv: z
    .string()
    .optional()
    .describe("Name of the environment variable or credentials entry that holds the API key."),
};

const ProviderClientFieldsSchema = {
  maxRetries: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Retries after a failed request. Defaults to 2."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Timeout for one request attempt, in milliseconds. Defaults to the provider SDK's own; 10 minutes for chatcompletions.",
    ),
};

// AI Provider Use - Discriminated by 'type'
const ChatCompletionsProviderUseSchema = z.strictObject({
  type: z.literal("chatcompletions").describe("Provider API the endpoint speaks."),
  baseUrl: z
    .string()
    .optional()
    .describe("Base URL of the OpenAI-compatible endpoint, e.g. http://localhost:11434/v1."),
  vendor: z
    .enum(["openrouter", "together"])
    .optional()
    .describe("Vendor behind the endpoint; turns on that vendor's own request fields."),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const AnthropicProviderUseSchema = z.strictObject({
  type: z.literal("anthropic").describe("Provider API the endpoint speaks."),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const OpenAIProviderUseSchema = z.strictObject({
  type: z.literal("openai").describe("Provider API the endpoint speaks."),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
});

const GeminiProviderUseSchema = z.strictObject({
  type: z.literal("gemini").describe("Provider API the endpoint speaks."),
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

// A string names a provider: a cli.yaml profile or a built-in type (one
// namespace; validated at resolution, not here). An object is inline
// endpoint configuration.
export const ProviderUseSchema = z.union([
  z
    .string()
    .min(1)
    .describe(
      "A cli.yaml provider profile or a built-in type: anthropic, openai, gemini, chatcompletions.",
    )
    .transform((name) => ({ name })),
  AIProviderUseSchema,
]);

export type ProviderUse = z.infer<typeof ProviderUseSchema>;

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

export const CliConfigSchema = z.strictObject({
  providers: z
    .record(z.string(), AIProviderUseSchema)
    .optional()
    .describe("Named provider profiles: endpoint configuration a recipe refers to by name."),
  defaults: z
    .strictObject({
      provider: z
        .string()
        .optional()
        .describe(
          "Provider used when a recipe or chat names none: a profile name or built-in type.",
        ),
      models: z
        .record(z.string(), z.string())
        .optional()
        .describe("Default model per provider name, used when a recipe names no model."),
      tools: z
        .array(z.string())
        .optional()
        .describe(
          "Local tools for chat and for recipes without a tools key; replaces the built-in set.",
        ),
    })
    .optional()
    .describe("Values used when a recipe or the command line leaves them out."),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

/* ============================================================================
 * MCP Config Schemas
 * ========================================================================== */

const MCPStdioConfigSchema = z.strictObject({
  transport: z.literal("stdio").describe("Run the server as a child process."),
  name: z.string().optional().describe("Prefix for the names of this server's tools."),
  command: z.string().describe("Executable that starts the server."),
  args: z.array(z.string()).optional().describe("Arguments passed to command."),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables set for the server process."),
});

const MCPHttpConfigSchema = z.strictObject({
  transport: z.literal("http").describe("Connect to a running server over HTTP."),
  name: z.string().optional().describe("Prefix for the names of this server's tools."),
  url: z.string().describe("URL of the server's MCP endpoint."),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("HTTP headers sent with every request."),
});

export const MCPConfigSchema = z.discriminatedUnion("transport", [
  MCPStdioConfigSchema,
  MCPHttpConfigSchema,
]);

export type MCPConfigUse = z.infer<typeof MCPConfigSchema>;

/* ============================================================================
 * Batch Config Schema
 * ========================================================================== */

export const BatchConfigSchema = z.strictObject({
  files: z
    .string()
    .describe("Glob of input files. Each match runs as its own session, available as {{file}}."),
  concurrency: z.number().int().positive().default(3).describe("Inputs processed in parallel."),
  incremental: z
    .boolean()
    .default(false)
    .describe("Skip inputs that already completed and whose content is unchanged."),
});

export type BatchConfig = z.infer<typeof BatchConfigSchema>;

/* ============================================================================
 * Schedule Config Schema
 * ========================================================================== */

const ClockTimeSchema = z
  .string()
  .regex(new RegExp(CLOCK_TIME_PATTERN), "expected HH:MM in 24-hour form");

// `every` (elapsed interval) and `at` (machine-local clock time, optionally
// restricted to weekdays with `on`) are distinct shapes, never merged.
export const ScheduleConfigSchema = z.union([
  z.strictObject({
    every: z
      .string()
      .regex(
        new RegExp(INTERVAL_PATTERN),
        "expected <positive integer><unit> with unit s, m, h, or d",
      )
      .refine(
        (every) => {
          try {
            parseInterval(every);
            return true;
          } catch {
            return false;
          }
        },
        { message: "interval is below 60s or too large for a backend" },
      )
      .describe("Fixed interval between runs: <integer><unit>, unit s, m, h or d. Minimum 60s."),
  }),
  z.strictObject({
    at: z
      .union([ClockTimeSchema, z.array(ClockTimeSchema).min(1)])
      .describe("Time of day to run, HH:MM in 24-hour machine-local time; a list for several."),
    on: z
      .array(z.enum(WEEKDAY_NAMES))
      .min(1)
      .optional()
      .describe("Weekdays the at times apply to. Every day when omitted."),
  }),
]);

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/* ============================================================================
 * Job Config Schema
 * ========================================================================== */

export const RequestOptionsSchema = z.strictObject({
  reasoning: z
    .union([
      z.enum(["default", "off", "on"]),
      z.strictObject({
        effort: z.enum(["low", "medium", "high"]).describe("How much the model thinks."),
        display: z
          .enum(["visible", "hidden"])
          .optional()
          .describe("hidden asks the provider not to return its thinking. Defaults to visible."),
      }),
    ])
    .optional()
    .describe(
      "Model thinking. default leaves the provider's own default, on is medium effort, off sends the provider's explicit disable.",
    ),
  maxOutputTokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Upper limit on tokens the model generates per response."),
  toolChoice: z
    .union([
      z.enum(["auto", "none", "required"]),
      z.strictObject({
        type: z.literal("tool").describe("Force one specific tool."),
        name: z.string().describe("Name of the tool the model must call."),
      }),
    ])
    .optional()
    .describe(
      "Whether the model may, must not, or must call a tool, or the one tool it must call.",
    ),
  parallelToolCalls: z
    .boolean()
    .optional()
    .describe("Whether the model may request several tool calls in one response."),
  providerOptions: z
    .record(z.string(), z.any())
    .optional()
    .describe("Sent to the provider as-is under its own field names, e.g. temperature."),
});

export type RequestOptions = z.infer<typeof RequestOptionsSchema>;

export const JobConfigSchema = z.strictObject({
  name: z
    .string()
    .optional()
    .describe(
      "Name of the recipe. Scopes its batch ledger entries; the recipe's path when omitted.",
    ),
  provider: ProviderUseSchema.optional().describe(
    "Where requests go: a provider name, or inline endpoint configuration. Falls back to defaults.provider in cli.yaml.",
  ),
  model: z
    .string()
    .optional()
    .describe(
      "Model id, publisher-qualified (anthropic/claude-sonnet-5) or provider-native. Falls back to defaults.models in cli.yaml.",
    ),
  system: z.string().optional().describe("System prompt."),
  request: RequestOptionsSchema.optional().describe("Request options that work across providers."),
  task: z.string().describe("The prompt to run. {{name}} placeholders are filled from --args."),
  tools: z
    .array(z.string())
    .optional()
    .describe(
      "Local tools the model may call: axle-help, exec, patch-file, read-file, write-file. Replaces the defaults; [] means none.",
    ),
  providerTools: z
    .array(z.string())
    .optional()
    .describe("Tools the provider runs on its side, e.g. web_search, code_execution."),
  files: z.array(z.string()).optional().describe("Paths of files attached to the task."),
  mcps: z.array(MCPConfigSchema).optional().describe("MCP servers whose tools the model may call."),
  batch: BatchConfigSchema.optional().describe(
    "Run the recipe once per input file, each in its own session.",
  ),
  schedule: ScheduleConfigSchema.optional().describe(
    "Recurrence, registered with axle schedule: either every or at.",
  ),
  compaction: z
    .boolean()
    .optional()
    .describe("Summarize the conversation when it nears the context window. Defaults to true."),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
