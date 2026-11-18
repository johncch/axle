import { AxleError, AxleErrorCode } from "../errors/AxleError.js";

/** A JSON Schema document, passed to the model as written. */
export type JsonSchema = Record<string, unknown>;

interface StandardIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardIssue> };

/**
 * A schema object from a library that implements Standard Schema and
 * Standard JSON Schema (https://standardschema.dev): Zod 4.2 and later,
 * ArkType, and others. Axle reads its JSON Schema and validates the answer
 * through the `~standard` property and imports no schema library to do so.
 */
export interface StandardOutputSchema<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly jsonSchema: {
      readonly input: (options: { target: "draft-2020-12" }) => Record<string, unknown>;
    };
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/**
 * What an `Instruct` takes as its schema: a JSON Schema, or a Standard
 * Schema object that converts to one. See docs/architecture/structured-output.md.
 */
export type OutputSchema = StandardOutputSchema<any, any> | JsonSchema;

export type ParsedSchema<T extends OutputSchema> =
  T extends StandardOutputSchema<any, any>
    ? NonNullable<T["~standard"]["types"]>["output"]
    : unknown;

function isStandardSchema(schema: OutputSchema): schema is StandardOutputSchema<any, any> {
  return "~standard" in schema;
}

/** The JSON Schema an output schema sends to the model. */
export function toJsonSchema(schema: OutputSchema): JsonSchema {
  if (!isStandardSchema(schema)) return schema;

  const standard = schema["~standard"];
  if (typeof standard?.jsonSchema?.input !== "function") {
    throw new AxleError(
      `The schema's library (${standard?.vendor ?? "unknown"}) does not implement Standard JSON Schema. Pass a JSON Schema object, or a schema from a library that does (Zod 4.2 or later).`,
      { code: AxleErrorCode.INVALID_OPTIONS },
    );
  }
  return standard.jsonSchema.input({ target: "draft-2020-12" });
}

export async function parseResponse<T extends OutputSchema>(
  rawValue: string,
  schema?: T,
): Promise<ParsedSchema<T> | string> {
  if (!schema) return rawValue;

  const parsed = parseJsonObject(rawValue);
  if (!isStandardSchema(schema)) return parsed as ParsedSchema<T>;

  const result = await schema["~standard"].validate(parsed);
  if (result.issues) {
    const formatted = result.issues
      .map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
      .join(", ");
    throw new Error(`Validation failed: ${formatted}`);
  }
  return result.value as ParsedSchema<T>;
}

function formatPath(path: StandardIssue["path"]): string {
  return (path ?? [])
    .map((segment) => String(typeof segment === "object" ? segment.key : segment))
    .join(".");
}

export function parseJsonObject(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (directError) {
    throw new Error(`Cannot parse response as JSON: ${(directError as Error).message}`);
  }
}

export function parseTaggedSections(input: string): {
  tags: Record<string, string>;
  remaining: string;
} {
  if (input.trim().startsWith("```json") && input.trim().endsWith("```")) {
    input = input.trim().slice(7, -3).trim();
  }
  const tagRegex = /<(\w+)>(.*?)<\/\1>/gs;
  const tags: Record<string, string> = {};
  let remaining = input;

  remaining = remaining.replace(tagRegex, (_match, tag, content) => {
    tags[tag] = content;
    return "";
  });

  const tagRegexPartial = /<(\w+)>(.*?)(?:<\/?\w+>|$)/gs;
  remaining = remaining.replace(tagRegexPartial, (_match, tag, content) => {
    tags[tag] = content;
    return "";
  });

  return {
    tags,
    remaining: remaining.trim(),
  };
}
