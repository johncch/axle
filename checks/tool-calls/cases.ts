import {
  generate,
  stream,
  type AIProvider,
  type AxleAssistantMessage,
  type AxleMessage,
  type AxleModelRequestOptions,
  type ExecutableTool,
} from "@fifthrevision/axle";
import * as z from "zod";
import type { ToolCallProviderId } from "./providers.js";

export interface ToolCallCaseContext {
  provider: AIProvider;
  model: string;
  providerId: ToolCallProviderId;
  requestOptions: AxleModelRequestOptions;
  surface: ToolCallSurface;
}

export interface ToolCallCaseResult {
  ok: boolean;
  failureReasons?: string[];
  details?: Record<string, unknown>;
}

export interface ToolCallCase {
  id: string;
  description: string;
  providers?: ToolCallProviderId[];
  run(context: ToolCallCaseContext): Promise<ToolCallCaseResult>;
}

export type ToolCallSurface = "generate" | "stream";

type AnyTool = ExecutableTool<z.ZodObject<any>>;

interface SchemaCase {
  id: string;
  description: string;
  schema: z.ZodObject<any>;
  prompt: string;
}

const schemaCases: SchemaCase[] = [
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
    prompt:
      "Call the nullable_required_probe tool exactly once with id='alpha' and note=null.",
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

export const toolCallCases: ToolCallCase[] = schemaCases.map((schemaCase) => ({
  id: schemaCase.id,
  description: schemaCase.description,
  run: (context) => runSchemaCase(schemaCase, context),
}));

async function runSchemaCase(
  schemaCase: SchemaCase,
  { provider, model, requestOptions, surface }: ToolCallCaseContext,
): Promise<ToolCallCaseResult> {
  const toolName = `${schemaCase.id.replaceAll("-", "_")}_probe`;
  const calls: Array<{ input: Record<string, unknown>; parse: ReturnType<typeof schemaCase.schema.safeParse> }> = [];
  const tool: AnyTool = {
    name: toolName,
    description: `Record one invocation for the ${schemaCase.id} tool-call schema check.`,
    schema: schemaCase.schema,
    async execute(input) {
      const parsed = schemaCase.schema.safeParse(input);
      calls.push({ input, parse: parsed });
      return parsed.success
        ? `TOOL_CALL_SCHEMA_OK ${schemaCase.id} ${JSON.stringify(parsed.data)}`
        : `TOOL_CALL_SCHEMA_INVALID ${schemaCase.id} ${parsed.error.message}`;
    },
  };

  const messages: AxleMessage[] = [
    {
      role: "user",
      content: `${schemaCase.prompt} After the tool returns, reply with exactly: done.`,
    },
  ];

  const result =
    surface === "stream"
      ? await stream({
          provider,
          model,
          ...requestOptions,
          messages,
          tools: [tool],
          maxIterations: 2,
          maxOutputTokens: 512,
        }).final
      : await generate({
          provider,
          model,
          ...requestOptions,
          messages,
          tools: [tool],
          maxIterations: 2,
          maxOutputTokens: 512,
        });

  if (!result.ok) return fail({ error: result.error, calls: calls.map(toCallDetail) });

  const failureReasons = [
    ...(calls.length === 0 ? [`Tool ${toolName} was not called.`] : []),
    ...calls.flatMap((call, index) =>
      call.parse.success ? [] : [`Tool call ${index + 1} did not satisfy the Zod schema.`],
    ),
  ];

  return {
    ok: failureReasons.length === 0,
    ...(failureReasons.length > 0 ? { failureReasons } : {}),
    details: {
      surface,
      text: getAssistantText(result.final),
      callCount: calls.length,
      calls: calls.map(toCallDetail),
      usage: result.usage,
    },
  };
}

function toCallDetail(call: {
  input: Record<string, unknown>;
  parse: ReturnType<z.ZodObject<any>["safeParse"]>;
}) {
  return {
    input: call.input,
    parseSuccess: call.parse.success,
    ...(!call.parse.success ? { parseError: call.parse.error.message } : {}),
  };
}

function fail(details: Record<string, unknown>): ToolCallCaseResult {
  return { ok: false, details };
}

function getAssistantText(message: AxleAssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
