import * as z from "zod";
import { DeclarativeSchema, OutputSchema } from "./types.js";

/**
 * This function converts a declarative schema to the schema that uses Zod internally.
 *
 * @param schema - the declarative schema to convert.
 * @param level - for nested objects, this is used to determine if the field is optional or required.
 * @returns
 */
export function declarativeToOutputSchema(
  schema: DeclarativeSchema,
  level = 0,
): OutputSchema {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === "string") {
      switch (value) {
        case "string":
          shape[key] = level === 0 ? z.string() : z.string().optional();
          break;
        case "number":
          shape[key] = level === 0 ? z.number() : z.number().optional();
          break;
        case "boolean":
          shape[key] = level === 0 ? z.boolean() : z.boolean().optional();
          break;
        case "string[]":
          shape[key] = z.array(z.string());
          break;
        default:
          throw new Error(`Unsupported declarative type: ${value}`);
      }
    } else if (Array.isArray(value)) {
      // Handle array of objects: [DeclarativeSchema]
      if (value.length === 1 && typeof value[0] === "object") {
        const arrayItemSchema = declarativeToOutputSchema(value[0], level + 1);
        shape[key] = z.array(z.object(arrayItemSchema));
      } else {
        throw new Error(
          `Unsupported array format for key ${key}. Expected [DeclarativeSchema].`,
        );
      }
    } else {
      shape[key] = z.object(declarativeToOutputSchema(value, level + 1));
    }
  }
  return shape;
}

/**
 * This function provides an example value for a given Zod schema.
 * @param schema
 * @returns
 */
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

/**
 * A utility function to check if a schema is an OutputSchema.
 * @param schema
 * @returns
 */
export function isOutputSchema(
  schema: OutputSchema | DeclarativeSchema,
): schema is OutputSchema {
  return (
    typeof schema === "object" &&
    Object.values(schema).every(
      (val) => val && typeof val === "object" && "_def" in val,
    )
  );
}

export function isJsonCompatible(schema: z.ZodTypeAny): boolean {
  if (schema instanceof z.ZodString) {
    return true;
  }
  if (schema instanceof z.ZodNumber) {
    return true;
  }
  if (schema instanceof z.ZodBoolean) {
    return true;
  }
  if (schema instanceof z.ZodNull) {
    return true;
  }
  if (schema instanceof z.ZodArray) {
    const elementSchema = schema.element;
    return isJsonCompatible(elementSchema as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const value of Object.values(shape)) {
      if (!isJsonCompatible(value)) {
        return false;
      }
    }
    return true;
  }
  if (schema instanceof z.ZodOptional) {
    const innerSchema = schema.unwrap();
    return isJsonCompatible(innerSchema as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodNullable) {
    const innerSchema = schema.unwrap();
    return isJsonCompatible(innerSchema as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options;
    return options.every((option: z.ZodTypeAny) => isJsonCompatible(option));
  }

  return false;
}
