import { z } from "zod";
import {
  AnthropicProviderConfig as AnthropicConfig,
  GeminiProviderConfig as GeminiConfig,
  OllamaProviderConfig as OllamaConfig,
  OpenAIProviderConfig as OpenAIConfig,
} from "../../ai/types.js";
import { ResultTypeUnion } from "../../core/types.js";

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

// AI Provider Use - Discriminated by 'engine'
const OllamaProviderUseSchema = z
  .object({
    engine: z.literal("ollama"),
  })
  .passthrough();

const AnthropicProviderUseSchema = z
  .object({
    engine: z.literal("anthropic"),
  })
  .passthrough();

const OpenAIProviderUseSchema = z
  .object({
    engine: z.literal("openai"),
  })
  .passthrough();

const GeminiProviderUseSchema = z
  .object({
    engine: z.literal("gemini"),
  })
  .passthrough();

export const AIProviderUseSchema = z.discriminatedUnion("engine", [
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
  .passthrough();

export type ServiceConfig = z.infer<typeof ServiceConfigSchema>;

export type ToolProviderConfig = {
  brave?: BraveProviderConfig;
};

/* ============================================================================
 * Reference Schemas
 * ========================================================================== */

export const ImageReferenceSchema = z.object({
  file: z.string(),
});

export const DocumentReferenceSchema = z.object({
  file: z.string(),
});

export const TextFileReferenceSchema = z.object({
  file: z.string(),
});

export type ImageReference = z.infer<typeof ImageReferenceSchema>;
export type DocumentReference = z.infer<typeof DocumentReferenceSchema>;
export type TextFileReference = z.infer<typeof TextFileReferenceSchema>;

/* ============================================================================
 * Replace Schema
 * ========================================================================== */

export const ReplaceSchema = z.object({
  source: z.literal("file"),
  pattern: z.string(),
  files: z.union([z.string(), z.array(z.string())]),
});

export type Replace = z.infer<typeof ReplaceSchema>;

/* ============================================================================
 * Skip Options Schema
 * ========================================================================== */

export const SkipOptionsSchema = z.object({
  type: z.literal("file-exist"),
  pattern: z.string(),
});

export type SkipOptions = z.infer<typeof SkipOptionsSchema>;

/* ============================================================================
 * Batch Options Schema
 * ========================================================================== */

export const BatchOptionsSchema = z.object({
  type: z.literal("files"),
  source: z.string(),
  bind: z.string(),
  "skip-if": z.array(SkipOptionsSchema).optional(),
});

export type BatchOptions = z.infer<typeof BatchOptionsSchema>;

/* ============================================================================
 * Step Schemas - Discriminated by 'uses'
 * ========================================================================== */

export const ChatStepSchema = z.object({
  uses: z.literal("chat"),
  system: z.string().optional(),
  message: z.string(),
  output: z.record(z.string(), z.any()).optional(),
  replace: z.array(ReplaceSchema).optional(),
  tools: z.array(z.string()).optional(),
  images: z.array(ImageReferenceSchema).optional(),
  documents: z.array(DocumentReferenceSchema).optional(),
  references: z.array(TextFileReferenceSchema).optional(),
});

export const WriteToDiskStepSchema = z.object({
  uses: z.literal("write-to-disk"),
  output: z.string(),
  keys: z.union([z.string(), z.array(z.string())]).optional(),
});

export const StepSchema = z.discriminatedUnion("uses", [
  ChatStepSchema,
  WriteToDiskStepSchema,
]);

export type ChatStep = z.infer<typeof ChatStepSchema>;
export type WriteToDiskStep = z.infer<typeof WriteToDiskStepSchema>;
export type Step = z.infer<typeof StepSchema>;

/* ============================================================================
 * Job Schemas - Discriminator added via transform
 * ========================================================================== */

// Input schema (what users write)
const JobInputSchema = z.object({
  tools: z.array(z.string()).optional(),
  batch: z.array(BatchOptionsSchema).optional(),
  steps: z.array(StepSchema),
});

// Output schemas (with discriminator)
const SerialJobSchema = z.object({
  type: z.literal("serial"),
  tools: z.array(z.string()).optional(),
  steps: z.array(StepSchema),
});

const BatchJobSchema = z.object({
  type: z.literal("batch"),
  tools: z.array(z.string()).optional(),
  batch: z.array(BatchOptionsSchema),
  steps: z.array(StepSchema),
});

// Transform to add discriminator based on presence of 'batch' property
export const JobSchema = JobInputSchema.transform((data) => {
  if (data.batch && data.batch.length > 0) {
    return {
      type: "batch" as const,
      tools: data.tools,
      batch: data.batch,
      steps: data.steps,
    };
  } else {
    return {
      type: "serial" as const,
      tools: data.tools,
      steps: data.steps,
    };
  }
});

export type Job = z.infer<typeof JobSchema>;
export type SerialJob = Extract<Job, { type: "serial" }>;
export type BatchJob = Extract<Job, { type: "batch" }>;

/* ============================================================================
 * DAG Job Schema
 * ========================================================================== */

// Input schema for DAG job value (what users write)
const DAGJobValueInputSchema = z.object({
  tools: z.array(z.string()).optional(),
  batch: z.array(BatchOptionsSchema).optional(),
  steps: z.array(StepSchema),
  dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
});

// Transform to add discriminator to the job part
const DAGJobValueSchema = DAGJobValueInputSchema.transform((data) => {
  const { dependsOn, ...jobData } = data;

  // Parse the job part to add discriminator
  const job = JobInputSchema.parse(jobData);
  const transformedJob = JobSchema.parse(job);

  return {
    ...transformedJob,
    ...(dependsOn ? { dependsOn } : {}),
  };
});

export const DAGJobSchema = z.record(z.string(), DAGJobValueSchema);

export type DAGJob = z.infer<typeof DAGJobSchema>;

/* ============================================================================
 * Job Config Schema
 * ========================================================================== */

export const JobConfigSchema = z.object({
  using: AIProviderUseSchema,
  jobs: DAGJobSchema,
});

export type JobConfig = z.infer<typeof JobConfigSchema>;
