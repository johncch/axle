import z, { type ZodObject } from "zod";

/**
 * Convert a JSON Schema object (from an MCP tool's inputSchema) to a Zod schema.
 *
 * Uses Zod 4's built-in z.fromJSONSchema() for the conversion. Falls back to a
 * permissive passthrough schema if conversion fails — the MCP server performs its
 * own validation, so the schema mainly exists to inform the LLM.
 */
export function jsonSchemaToZod(jsonSchema: Record<string, unknown>): ZodObject<any> {
  try {
    const schema = z.fromJSONSchema(jsonSchema);
    // z.fromJSONSchema may return non-object schemas; wrap if needed
    if (schema instanceof z.ZodObject) {
      return schema as ZodObject<any>;
    }
    // If it's not an object schema, fall back to passthrough
    return z.object({}).passthrough();
  } catch {
    return z.object({}).passthrough();
  }
}
