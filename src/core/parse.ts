import * as z from "zod";

export type OutputSchema = Record<string, z.ZodTypeAny>;

export type ParsedSchema<T extends OutputSchema> = { [K in keyof T]: z.output<T[K]> };

export function zodToExample(schema: z.ZodTypeAny): [string, unknown] {
  if (schema instanceof z.ZodString) {
    return ["string", "Your answer"];
  }
  if (schema instanceof z.ZodNumber) {
    return ["number", 42];
  }
  if (schema instanceof z.ZodBoolean) {
    return ["boolean", true];
  }
  if (schema instanceof z.ZodEnum) {
    const values = schema.options;
    return [values.map(formatLiteralLabel).join(" | "), values[0]];
  }
  if (schema instanceof z.ZodLiteral) {
    const value = schema.value;
    return [formatLiteralLabel(value), value];
  }
  if (schema instanceof z.ZodArray) {
    const elementSchema = schema.element;
    if (elementSchema instanceof z.ZodString) {
      return ["string array", ["answer 1", "answer 2", "third answer"]];
    } else if (elementSchema instanceof z.ZodNumber) {
      return ["number array", [42, 59, 3.14]];
    } else if (elementSchema instanceof z.ZodBoolean) {
      return ["boolean array", [true, false, false]];
    } else if (elementSchema instanceof z.ZodObject) {
      const [, objectExample] = zodToExample(elementSchema);
      return ["object array", [objectExample, objectExample]];
    } else if (elementSchema instanceof z.ZodEnum || elementSchema instanceof z.ZodLiteral) {
      const [elementLabel, elementExample] = zodToExample(elementSchema);
      return [`${elementLabel} array`, [elementExample]];
    }
    return ["array", []];
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const example: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shape)) {
      const [, exampleValue] = zodToExample(value);
      example[key] = exampleValue;
    }
    return ["JSON object", example];
  }
  if (schema instanceof z.ZodOptional) {
    const innerSchema = schema.unwrap();
    const [innerType, exampleValue] = zodToExample(innerSchema as z.ZodTypeAny);
    return [`${innerType} | undefined`, exampleValue];
  }

  throw new Error(`Unsupported Zod schema: ${schema.constructor.name}`);
}

function formatLiteralLabel(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function parseResponse<T extends OutputSchema>(
  rawValue: string,
  schema?: T,
): ParsedSchema<T> | string {
  if (!schema) {
    return rawValue;
  }

  const schemaKeys = Object.keys(schema);
  if (schemaKeys.length === 0) {
    if (rawValue.trim() === "{}" || rawValue.trim() === "") {
      return {} as ParsedSchema<T>;
    }
    throw new Error(
      "Schema is empty, but rawValue is not an empty object representation or empty string.",
    );
  }

  const parsed = parseJsonObject(rawValue);

  try {
    return z.object(schema).parse(parsed) as ParsedSchema<T>;
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      const formattedErrors = (error as any).issues
        .map((err: any) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      throw new Error(`Validation failed: ${formattedErrors}`);
    }
    throw error;
  }
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
