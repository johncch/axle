import z, { type ZodObject } from "zod";

/**
 * Convert a JSON Schema object (from an MCP tool's inputSchema) to a Zod schema.
 *
 * Uses Zod 4's built-in z.fromJSONSchema() for the conversion. Falls back to a
 * permissive passthrough schema if conversion fails. Tool call arguments are
 * parsed with the result before they reach the server, so unknown top-level
 * keys are stripped like a default z.object() rather than rejected.
 */
export function jsonSchemaToZod(jsonSchema: Record<string, unknown>): ZodObject<any> {
  try {
    const schema = z.fromJSONSchema(jsonSchema);
    // z.fromJSONSchema may return non-object schemas; wrap if needed
    if (schema instanceof z.ZodObject) {
      // z.fromJSONSchema() produces a permissive schema (additionalProperties: {})
      // but providers like OpenAI require additionalProperties: false. Using .strip()
      // ensures the round-trip through toJSONSchema() emits the correct form.
      return schema.strip() as ZodObject<any>;
    }
    // If it's not an object schema, fall back to passthrough
    return z.object({}).passthrough();
  } catch {
    return z.object({}).passthrough();
  }
}
