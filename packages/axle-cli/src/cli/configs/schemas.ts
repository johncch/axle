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
      "Timeout for one request attempt, in milliseconds. Defaults to the provider SDK's own; 10 minutes for chatCompletions.",
    ),
  contextWindow: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Context window in tokens for every model on this endpoint; overrides the models.dev lookup. Set it for a local server that loads models below their maximum.",
    ),
};

export const PRESET_NAMES = [
  "anthropic",
  "openai",
  "gemini",
  "openrouter",
  "together",
  "bedrock",
] as const;

export type PresetName = (typeof PRESET_NAMES)[number];

function requiredKey(message: string) {
  return {
    error: (issue: z.core.$ZodRawIssue) => (issue.input === undefined ? message : undefined),
  };
}

function presetKeyError(name: PresetName, keys: string[]): string {
  if (keys.includes("baseUrl")) {
    return `"${name}" is a preset and takes no baseUrl. Remove it, or rename this profile to use your own URL.`;
  }
  return `"${name}" is a preset and takes no ${keys.join(" or ")}. Remove ${keys.length > 1 ? "them" : "it"}.`;
}

function presetProfile<TShape extends z.ZodRawShape>(name: PresetName, shape: TShape) {
  return z.strictObject(
    { ...ApiKeyFieldsSchema, ...ProviderClientFieldsSchema, ...shape },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys" ? presetKeyError(name, issue.keys) : undefined,
    },
  );
}

const OpenRouterProfileSchema = presetProfile("openrouter", {
  baseUrl: z
    .string()
    .min(1)
    .optional()
    .describe("OpenRouter host, e.g. https://eu.openrouter.ai/api/v1. Defaults to openrouter.ai."),
});

const BedrockProfileSchema = presetProfile("bedrock", {
  protocol: z
    .enum(
      ["messages", "responses", "chatCompletions"],
      requiredKey("protocol is required: messages, responses or chatCompletions."),
    )
    .describe("Protocol to speak, which follows the model: messages for Claude."),
  region: z
    .string(requiredKey("region is required, e.g. us-east-1."))
    .min(1)
    .describe("AWS region of the Bedrock endpoint, e.g. us-east-1."),
});

function genericKeyError(keys: string[]): string | undefined {
  const replaced = [
    ...(keys.includes("type") ? ["type is now protocol"] : []),
    ...(keys.includes("vendor") ? ["vendor is now id and dialect"] : []),
  ];
  return replaced.length > 0 ? `${replaced.join("; ")}.` : undefined;
}

const GenericProfileFields = {
  protocol: z
    .enum(
      ["messages", "responses", "generateContent", "chatCompletions"],
      requiredKey("protocol is required: messages, responses, generateContent or chatCompletions."),
    )
    .describe("Protocol the endpoint speaks."),
  baseUrl: z
    .string(requiredKey("baseUrl is required."))
    .min(1)
    .describe(
      "Base URL of the endpoint, in the protocol's convention, e.g. http://localhost:11434/v1.",
    ),
  id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "models.dev provider id of the service behind the endpoint; inferred from a known hostname.",
    ),
  dialect: z
    .enum(["openrouter", "together"])
    .optional()
    .describe(
      "Chat Completions dialect of the service behind the endpoint; inferred from a known hostname.",
    ),
  ...ApiKeyFieldsSchema,
  ...ProviderClientFieldsSchema,
};

const genericProfileError = {
  error: (issue: z.core.$ZodRawIssue) =>
    issue.code === "unrecognized_keys" ? genericKeyError(issue.keys) : undefined,
};

function dialectNeedsChatCompletions(profile: { protocol: string; dialect?: string }): boolean {
  return profile.dialect === undefined || profile.protocol === "chatCompletions";
}

const DIALECT_PROTOCOL_ERROR = "dialect applies only to the chatCompletions protocol.";

const GenericProfileObject = z.strictObject(GenericProfileFields, genericProfileError);

const GenericProfileSchema = GenericProfileObject.refine(dialectNeedsChatCompletions, {
  error: DIALECT_PROTOCOL_ERROR,
  path: ["dialect"],
});

export type GenericProfile = z.infer<typeof GenericProfileSchema>;
export type PresetProfile = z.infer<ReturnType<typeof presetProfile<Record<never, never>>>>;
export type OpenRouterProfile = z.infer<typeof OpenRouterProfileSchema>;
export type BedrockProfile = z.infer<typeof BedrockProfileSchema>;

// A key that names a preset extends that preset; any other key is a generic
// profile, spelled out in full.
export const ProviderProfilesSchema = z
  .strictObject({
    anthropic: presetProfile("anthropic", {}).optional().describe("The anthropic preset."),
    openai: presetProfile("openai", {}).optional().describe("The openai preset."),
    gemini: presetProfile("gemini", {}).optional().describe("The gemini preset."),
    openrouter: OpenRouterProfileSchema.optional().describe("The openrouter preset."),
    together: presetProfile("together", {}).optional().describe("The together preset."),
    bedrock: BedrockProfileSchema.optional().describe(
      "The bedrock preset; needs protocol and region.",
    ),
  })
  .catchall(GenericProfileSchema.describe("A generic profile, under any name but a preset's."));

// A recipe is check-in-able, so its inline provider never holds a key —
// only apiKeyEnv, a reference to one.
const RecipeProviderSchema = GenericProfileObject.omit({ apiKey: true }).refine(
  dialectNeedsChatCompletions,
  { error: DIALECT_PROTOCOL_ERROR, path: ["dialect"] },
);

// A string names a provider: a preset or a cli.yaml profile (one namespace;
// validated at resolution, not here). An object is a generic profile inline.
export const ProviderUseSchema = z.union([
  z
    .string()
    .min(1)
    .describe(`A preset (${PRESET_NAMES.join(", ")}) or a cli.yaml provider profile.`)
    .transform((name) => ({ name })),
  RecipeProviderSchema,
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

export type ServiceConfig = Partial<Record<PresetName, ProviderServiceConfig>>;

/* ============================================================================
 * CLI Config Schema (cli.yaml)
 * ========================================================================== */

export const CliConfigSchema = z.strictObject({
  providers: ProviderProfilesSchema.optional().describe(
    "Provider profiles a recipe refers to by name. A key naming a preset extends that preset; any other key is a generic profile.",
  ),
  defaults: z
    .strictObject({
      provider: z
        .string()
        .optional()
        .describe("Provider used when a recipe or chat names none: a preset or a profile name."),
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

// Zod types a catchall as an index signature every key must satisfy, which a
// preset's profile does not, so this type states the name-decides rule itself.
export interface ProviderProfiles {
  [name: string]: GenericProfile | PresetProfile | OpenRouterProfile | BedrockProfile | undefined;
  anthropic?: PresetProfile;
  openai?: PresetProfile;
  gemini?: PresetProfile;
  openrouter?: OpenRouterProfile;
  together?: PresetProfile;
  bedrock?: BedrockProfile;
}

export type CliConfig = Omit<z.infer<typeof CliConfigSchema>, "providers"> & {
  providers?: ProviderProfiles;
};

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
  cache: z
    .boolean()
    .optional()
    .describe(
      "Whether to ask the provider to cache the prompt prefix where asking is required (Anthropic, OpenRouter). Default true.",
    ),
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

/**
 * The recipe keys that configure the agent, as the recipe wrote them. A
 * session freezes these; what they name or leave out resolves on every run
 * (see docs/architecture/cli.md).
 */
export const AgentRecipeSchema = JobConfigSchema.pick({
  name: true,
  provider: true,
  model: true,
  system: true,
  request: true,
  tools: true,
  providerTools: true,
  mcps: true,
  compaction: true,
});

export type AgentRecipe = z.infer<typeof AgentRecipeSchema>;

export function agentRecipeOf(job: JobConfig): AgentRecipe {
  const { name, provider, model, system, request, tools, providerTools, mcps, compaction } = job;
  return { name, provider, model, system, request, tools, providerTools, mcps, compaction };
}
