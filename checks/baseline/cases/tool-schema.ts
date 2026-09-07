import { generate, type ExecutableTool } from "@fifthrevision/axle";
import * as z from "zod";
import { fail, getAssistantText } from "./helpers.js";
import type { BaselineCase, BaselineCaseContext, BaselineCaseResult } from "./types.js";

// Providers reject or silently mangle function-tool definitions whose JSON
// Schema shape they dislike (optional booleans, nullables, defaults, loose
// objects). Each case sends one probe tool with a different shape and checks
// that the model both calls it and passes input that satisfies the Zod schema.
// generate() and stream() share tool conversion, so generate() alone covers it.

interface SchemaProbe {
  id: string;
  description: string;
  schema: z.ZodObject<any>;
  prompt: string;
}

const schemaProbes: SchemaProbe[] = [
  {
    id: "required-only",
    description: "Tool schema with only required scalar parameters.",
    schema: z.object({
      id: z.string(),
      count: z.number(),
      enabled: z.boolean(),
    }),
    prompt:
      "Call the required_only_probe tool exactly once with id='alpha', count=3, and enabled=true.",
  },
  {
    id: "optional-string",
    description: "Tool schema with an optional string parameter.",
    schema: z.object({
      id: z.string(),
      note: z.string().optional(),
    }),
    prompt:
      "Call the optional_string_probe tool exactly once with id='alpha'. The note field is optional.",
  },
  {
    id: "optional-boolean",
    description: "Tool schema with an optional boolean parameter like edit_file.replace_all.",
    schema: z.object({
      path: z.string(),
      replace_all: z.boolean().optional(),
    }),
    prompt:
      "Call the optional_boolean_probe tool exactly once with path='src/example.ts' and replace_all=true.",
  },
  {
    id: "optional-number",
    description: "Tool schema with an optional number parameter like bash.timeout_ms.",
    schema: z.object({
      command: z.string(),
      timeout_ms: z.number().optional(),
    }),
    prompt:
      "Call the optional_number_probe tool exactly once with command='echo orchid'. The timeout_ms field is optional.",
  },
  {
    id: "nested-optional",
    description: "Tool schema with an optional property inside a nested object.",
    schema: z.object({
      query: z.string(),
      options: z.object({
        glob: z.string().optional(),
        ignore_case: z.boolean().optional(),
      }),
    }),
    prompt:
      "Call the nested_optional_probe tool exactly once with query='orchid' and options.ignore_case=true.",
  },
  {
    id: "array-object-optional",
    description: "Tool schema with optional properties inside objects nested in an array.",
    schema: z.object({
      edits: z.array(
        z.object({
          path: z.string(),
          replacement: z.string(),
          replace_all: z.boolean().optional(),
        }),
      ),
    }),
    prompt:
      "Call the array_object_optional_probe tool exactly once with one edit: path='src/example.ts', replacement='orchid', replace_all=true.",
  },
  {
    id: "nullable-required",
    description: "Tool schema with a required nullable parameter.",
    schema: z.object({
      id: z.string(),
      note: z.string().nullable(),
    }),
    prompt: "Call the nullable_required_probe tool exactly once with id='alpha' and note=null.",
  },
  {
    id: "nullish-optional",
    description: "Tool schema with a nullish parameter that accepts undefined or null.",
    schema: z.object({
      id: z.string(),
      note: z.string().nullish(),
    }),
    prompt:
      "Call the nullish_optional_probe tool exactly once with id='alpha'. The note field may be omitted or null.",
  },
  {
    id: "defaulted-optional",
    description: "Tool schema with a defaulted parameter.",
    schema: z.object({
      id: z.string(),
      mode: z.enum(["fast", "safe"]).default("safe"),
    }),
    prompt:
      "Call the defaulted_optional_probe tool exactly once with id='alpha'. The mode field has a default.",
  },
  {
    id: "loose-object",
    description: "Tool schema that permits arbitrary additional object keys.",
    schema: z.looseObject({
      id: z.string(),
    }),
    prompt:
      "Call the loose_object_probe tool exactly once with id='alpha' and any extra key named tag with value 'orchid'.",
  },
];

export const toolSchemaCases: BaselineCase[] = schemaProbes.map((probe) => ({
  id: `tool-schema-${probe.id}`,
  description: probe.description,
  group: "extended",
  run: (context) => runSchemaProbe(probe, context),
}));

interface ProbeCall {
  input: Record<string, unknown>;
  parseSuccess: boolean;
  parseError?: string;
}

async function runSchemaProbe(
  probe: SchemaProbe,
  { provider, model, requestOptions }: BaselineCaseContext,
): Promise<BaselineCaseResult> {
  const toolName = `${probe.id.replaceAll("-", "_")}_probe`;
  const calls: ProbeCall[] = [];
  const tool: ExecutableTool<z.ZodObject<any>> = {
    name: toolName,
    description: `Record one invocation for the ${probe.id} tool-call schema check.`,
    schema: probe.schema,
    async execute(input) {
      const parsed = probe.schema.safeParse(input);
      calls.push({
        input,
        parseSuccess: parsed.success,
        ...(parsed.success ? {} : { parseError: parsed.error.message }),
      });
      return parsed.success
        ? `TOOL_CALL_SCHEMA_OK ${probe.id} ${JSON.stringify(parsed.data)}`
        : `TOOL_CALL_SCHEMA_INVALID ${probe.id} ${parsed.error.message}`;
    },
  };

  const result = await generate({
    provider,
    model,
    ...requestOptions,
    messages: [
      {
        role: "user",
        content: `${probe.prompt} After the tool returns, reply with exactly: done.`,
      },
    ],
    tools: [tool],
    maxSteps: 2,
    maxOutputTokens: 512,
  });

  if (!result.ok) return fail({ error: result.error, calls });

  const failureReasons = [
    ...(calls.length === 0 ? [`Tool ${toolName} was not called.`] : []),
    ...calls.flatMap((call, index) =>
      call.parseSuccess ? [] : [`Tool call ${index + 1} did not satisfy the Zod schema.`],
    ),
  ];

  return {
    ok: failureReasons.length === 0,
    ...(failureReasons.length > 0 ? { failureReasons } : {}),
    details: {
      text: getAssistantText(result.final),
      callCount: calls.length,
      calls,
      usage: result.usage,
    },
  };
}
