import * as z from "zod";
import type { TracingContext } from "../tracer/types.js";

export type OutputSchema = Record<string, z.ZodTypeAny>;

export type InferedOutputSchema<T extends OutputSchema | undefined> = T extends OutputSchema
  ? { [K in keyof T]: z.output<T[K]> }
  : string;

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
  if (schema instanceof z.ZodArray) {
    const elementSchema = schema.element;
    if (elementSchema instanceof z.ZodString) {
      return ["string array", ["answer 1", "answer 2", "third answer"]];
    } else if (elementSchema instanceof z.ZodNumber) {
      return ["number array", [42, 59, 3.14]];
    } else if (elementSchema instanceof z.ZodBoolean) {
      return ["boolean array", [true, false, false]];
    } else if (elementSchema instanceof z.ZodObject) {
      const [_, objectExample] = zodToExample(elementSchema);
      return ["object array", [objectExample, objectExample]];
    }
    return ["array", []];
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const example: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shape)) {
      const [_, exampleValue] = zodToExample(value);
      example[key] = exampleValue;
    }
    return ["JSON object", example];
  }
  if (schema instanceof z.ZodOptional) {
    const innerSchema = schema.unwrap();
    const [innerType, exampleValue] = zodToExample(innerSchema as z.ZodTypeAny);
    return [`${innerType} | undefined`, exampleValue];
  }
}

export function parseResponse<T extends OutputSchema>(
  rawValue: string,
  schema: T,
  runtime?: { tracer?: TracingContext },
): InferedOutputSchema<T>;
export function parseResponse(
  rawValue: string,
  schema?: undefined,
  runtime?: { tracer?: TracingContext },
): string;
export function parseResponse<T extends OutputSchema | undefined>(
  rawValue: string,
  schema?: T,
  runtime?: { tracer?: TracingContext },
): any {
  if (!schema) {
    return rawValue;
  }

  const schemaKeys = Object.keys(schema);
  if (schemaKeys.length === 0) {
    if (rawValue.trim() === "{}" || rawValue.trim() === "") {
      return {} as InferedOutputSchema<OutputSchema>;
    }
    throw new Error(
      "Schema is empty, but rawValue is not an empty object representation or empty string.",
    );
  }

  const taggedSections = parseTaggedSections(rawValue);

  const parseInput: any = {};
  for (const [key, fieldSchema] of Object.entries(schema)) {
    const tagContent = taggedSections.tags[key];
    if (tagContent !== undefined) {
      parseInput[key] = preprocessValue(fieldSchema, tagContent);
    } else if (fieldSchema.def.type !== "optional") {
      throw new Error(`Expected results with tag ${key} but it does not exist`);
    }
  }

  try {
    const validatedResult: any = {};
    for (const [key, fieldSchema] of Object.entries(schema)) {
      if (key in parseInput) {
        validatedResult[key] = fieldSchema.parse(parseInput[key]);
      }
    }

    return validatedResult;
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

function preprocessValue(schema: z.ZodTypeAny, rawValue: string): any {
  rawValue = rawValue.trim();
  switch (schema.def.type) {
    case "string":
      try {
        const parsed = JSON.parse(rawValue);
        return parsed;
      } catch (e) {
        if (typeof rawValue === "string") {
          return rawValue;
        }
        throw new Error(
          `Cannot parse '${rawValue}' as string. Ensure it is a valid JSON string or a plain string.`,
        );
      }
    case "number": {
      const parsed = parseFloat(rawValue);
      if (isNaN(parsed)) {
        throw new Error(`Cannot parse '${rawValue}' as number`);
      }
      return parsed;
    }
    case "boolean": {
      const lowerValue = rawValue.toLowerCase();
      if (lowerValue === "true") return true;
      if (lowerValue === "false") return false;
      throw new Error(`Cannot parse '${rawValue}' as boolean. Expected 'true' or 'false'`);
    }
    case "array": {
      if (rawValue === "") return [];
      try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      } catch (e) {
        // If JSON parsing fails, fall back to line-by-line parsing
      }

      if (rawValue.includes(",")) {
        return rawValue
          .split(",")
          .map((s) => {
            const trimmed = s.trim();
            try {
              return JSON.parse(trimmed);
            } catch (e) {
              return trimmed;
            }
          })
          .filter((item) => item !== "");
      }
    }
    case "object": {
      if (rawValue.includes("```json")) {
        rawValue = rawValue.replace(/```json/g, "").replace(/```/g, "");
      }
      try {
        const parsed = JSON.parse(rawValue);
        return parsed;
      } catch (error) {
        throw new Error(`Cannot parse object as JSON: ${(error as Error).message}`);
      }
    }
    case "optional": {
      const innerSchema = (schema as any).def.innerType as z.ZodTypeAny;
      return preprocessValue(innerSchema, rawValue);
    }
    default:
      return rawValue;
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
