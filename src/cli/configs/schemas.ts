import z from "zod";

// AI Provider Schemas
export const ollamaProviderUseSchema = z.object({
  engine: z.literal("ollama"),
  url: z.string().optional(),
  model: z.string().optional(),
});

export const anthropicProviderUseSchema = z.object({
  engine: z.literal("anthropic"),
  "api-key": z.string().optional(),
  model: z.string().optional(),
});

export const openaiProviderUseSchema = z.object({
  engine: z.literal("openai"),
  "api-key": z.string().optional(),
  model: z.string().optional(),
});

export const googleaiProviderUseSchema = z.object({
  engine: z.literal("googleai"),
  "api-key": z.string().optional(),
  model: z.string().optional(),
});

export const aiProviderUseSchema = z.union([
  ollamaProviderUseSchema,
  anthropicProviderUseSchema,
  openaiProviderUseSchema,
  googleaiProviderUseSchema,
]);

// Reference Schemas
export const imageReferenceSchema = z.object({
  file: z.string(),
});

export const documentReferenceSchema = z.object({
  file: z.string(),
});

export const textFileReferenceSchema = z.object({
  file: z.string(),
});

// Replace Schema
export const replaceSchema = z.object({
  source: z.literal("file"),
  pattern: z.string(),
  files: z.union([z.string(), z.array(z.string())]),
});

// Result Type Schema
export const resTypeStringsSchema = z.enum([
  "string",
  "string[]",
  "number",
  "boolean",
]);

// Step Schemas
export const chatStepSchema = z.object({
  uses: z.literal("chat"),
  system: z.string().optional(),
  message: z.string(),
  output: z.record(z.string(), resTypeStringsSchema).optional(),
  replace: z.array(replaceSchema).optional(),
  tools: z.array(z.string()).optional(),
  images: z.array(imageReferenceSchema).optional(),
  documents: z.array(documentReferenceSchema).optional(),
  references: z.array(textFileReferenceSchema).optional(),
});

export const writeToDiskStepSchema = z.object({
  uses: z.literal("write-to-disk"),
  output: z.string(),
  keys: z.union([z.string(), z.array(z.string())]).optional(),
});

export const stepSchema = z.union([chatStepSchema, writeToDiskStepSchema]);

// Skip Options Schema
export const skipOptionsSchema = z.object({
  type: z.literal("file-exist"),
  pattern: z.string(),
});

// Batch Options Schema
export const batchOptionsSchema = z.object({
  type: z.literal("files"),
  source: z.string(),
  bind: z.string(),
  "skip-if": z.array(skipOptionsSchema).optional(),
});

// Job Schemas
export const serialJobSchema = z
  .object({
    tools: z.array(z.string()).optional(),
    steps: z.array(stepSchema),
  })
  .strict();

export const batchJobSchema = z
  .object({
    tools: z.array(z.string()).optional(),
    batch: z.array(batchOptionsSchema),
    steps: z.array(stepSchema),
  })
  .strict();

export const jobSchema = z.union([batchJobSchema, serialJobSchema]);

// DAG Job Schema
export const dagJobValueSchema = jobSchema.and(
  z.object({
    dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
  }),
);

export const dagJobSchema = z.record(z.string(), dagJobValueSchema);

// Job Config Schema
export const jobConfigSchema = z.object({
  using: aiProviderUseSchema,
  jobs: dagJobSchema,
});

// Service Config Schemas
export const braveProviderConfigSchema = z.object({
  "api-key": z.string(),
  rateLimit: z.number().optional(),
});

export const ollamaServiceConfigSchema = z.object({
  url: z.string().optional(),
  model: z.string().optional(),
});

export const anthropicServiceConfigSchema = z.object({
  "api-key": z.string(),
  model: z.string().optional(),
});

export const openaiServiceConfigSchema = z.object({
  "api-key": z.string(),
  model: z.string().optional(),
});

export const googleaiServiceConfigSchema = z.object({
  "api-key": z.string(),
  model: z.string().optional(),
});

export const serviceConfigSchema = z.object({
  openai: openaiServiceConfigSchema.optional(),
  anthropic: anthropicServiceConfigSchema.optional(),
  ollama: ollamaServiceConfigSchema.optional(),
  googleai: googleaiServiceConfigSchema.optional(),
  brave: braveProviderConfigSchema.optional(),
});
