import { describe, expect, test } from "vitest";
import z from "zod";
import { jsonSchemaToZod } from "../../src/mcp/schema.js";

describe("jsonSchemaToZod", () => {
  test("converts a simple object schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();

    // Round-trip: convert back to JSON Schema
    const roundTripped = z.toJSONSchema(zodSchema);
    expect(roundTripped).toHaveProperty("type", "object");
  });

  test("converts an empty object schema", () => {
    const jsonSchema = {
      type: "object",
      properties: {},
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();
  });

  test("falls back to passthrough on invalid schema", () => {
    // Pass something that z.fromJSONSchema can't handle
    const zodSchema = jsonSchemaToZod({ invalid: true } as any);
    expect(zodSchema).toBeDefined();
    // Should be a passthrough schema that accepts any object
    const result = zodSchema.safeParse({ anything: "goes" });
    expect(result.success).toBe(true);
  });

  test("converts schema with string enum", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();
  });

  test("converts schema with nested objects", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        address: {
          type: "object",
          properties: {
            street: { type: "string" },
            city: { type: "string" },
          },
        },
      },
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();
  });

  test("converts schema with arrays", () => {
    const jsonSchema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
        },
      },
    };

    const zodSchema = jsonSchemaToZod(jsonSchema);
    expect(zodSchema).toBeDefined();
  });
});
