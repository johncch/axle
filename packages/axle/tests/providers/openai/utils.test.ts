import { describe, expect, test } from "vitest";
import z from "zod";
import { prepareTools } from "../../../src/providers/openai/utils.js";

describe("OpenAI tool preparation", () => {
  test("uses strict mode when every object property is required", () => {
    const [tool] = prepareTools([
      {
        name: "lookup",
        description: "Look up an item",
        schema: z.object({ id: z.string(), options: z.object({ limit: z.number() }) }),
      },
    ])!;

    expect(tool.strict).toBe(true);
  });

  test("disables strict mode for optional properties", () => {
    const [tool] = prepareTools([
      {
        name: "lookup",
        description: "Look up an item",
        schema: z.object({ id: z.string(), note: z.string().optional() }),
      },
    ])!;

    expect(tool.strict).toBe(false);
    expect(tool.parameters).toMatchObject({
      properties: { id: { type: "string" }, note: { type: "string" } },
      required: ["id"],
    });
  });

  test("disables strict mode for optional properties in nested objects", () => {
    const [tool] = prepareTools([
      {
        name: "lookup",
        description: "Look up an item",
        schema: z.object({ options: z.object({ limit: z.number().optional() }) }),
      },
    ])!;

    expect(tool.strict).toBe(false);
  });

  test("disables strict mode when object schemas allow additional properties", () => {
    const [tool] = prepareTools([
      {
        name: "lookup",
        description: "Look up an item",
        schema: z.looseObject({ id: z.string() }),
      },
    ])!;

    expect(tool.strict).toBe(false);
  });
});
