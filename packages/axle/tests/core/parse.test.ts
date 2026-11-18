import { describe, expect, expectTypeOf, it } from "vitest";
import * as z from "zod";
import {
  parseJsonObject,
  parseResponse,
  parseTaggedSections,
  toJsonSchema,
} from "../../src/core/parse.js";

describe("parseResponse", () => {
  it("returns raw string when schema is undefined", async () => {
    const result = await parseResponse("hello world");
    expect(result).toBe("hello world");
  });

  it("parses flat primitives from JSON", async () => {
    const result = await parseResponse(
      '{"answer":"Paris","count":42,"accepted":true}',
      z.object({
        answer: z.string(),
        count: z.number(),
        accepted: z.boolean(),
      }),
    );

    expect(result).toEqual({ answer: "Paris", count: 42, accepted: true });
  });

  it("parses a root primitive schema from JSON", async () => {
    const result = await parseResponse('"approved"', z.literal("approved"));
    expect(result).toBe("approved");
  });

  it("parses arrays of primitives from JSON", async () => {
    const result = await parseResponse(
      '{"items":["a","b","c"],"scores":[0.4,0.9]}',
      z.object({
        items: z.array(z.string()),
        scores: z.array(z.number()),
      }),
    );

    expect(result).toEqual({ items: ["a", "b", "c"], scores: [0.4, 0.9] });
  });

  it("parses nested objects from JSON", async () => {
    const result = await parseResponse(
      '{"person":{"name":"Ada","age":37,"skills":["math","code"]}}',
      z.object({
        person: z.object({
          name: z.string(),
          age: z.number(),
          skills: z.array(z.string()),
        }),
      }),
    );

    expect(result).toEqual({
      person: { name: "Ada", age: 37, skills: ["math", "code"] },
    });
  });

  it("parses arrays of objects from JSON", async () => {
    const result = await parseResponse(
      '{"tasks":[{"title":"Ship JSON output","priority":"high","done":false},{"title":"Benchmark models","priority":"medium","done":false}]}',
      z.object({
        tasks: z.array(
          z.object({
            title: z.string(),
            priority: z.string(),
            done: z.boolean(),
          }),
        ),
      }),
    );

    expect(result).toEqual({
      tasks: [
        { title: "Ship JSON output", priority: "high", done: false },
        { title: "Benchmark models", priority: "medium", done: false },
      ],
    });
  });

  it("handles optional fields that are missing", async () => {
    const result = await parseResponse(
      '{"name":"Bob"}',
      z.object({
        name: z.string(),
        nickname: z.string().optional(),
      }),
    );

    expect(result).toEqual({ name: "Bob" });
  });

  it("throws when a required field is missing", async () => {
    await expect(
      parseResponse(
        '{"name":"Bob"}',
        z.object({
          name: z.string(),
          age: z.number(),
        }),
      ),
    ).rejects.toThrow("Validation failed");
  });

  it("handles empty schema with empty input", async () => {
    const result = await parseResponse("{}", z.object({}));
    expect(result).toEqual({});
  });

  it("throws on non-JSON input before validating schema", async () => {
    await expect(parseResponse("some content", z.object({}))).rejects.toThrow(
      "Cannot parse response as JSON",
    );
  });

  it("unwraps a json code block wrapper", async () => {
    const raw = '```json\n{"answer":"hello"}\n```';
    const result = await parseResponse(raw, z.object({ answer: z.string() }));
    expect(result).toEqual({ answer: "hello" });
  });

  it("throws when the model adds prose around JSON", async () => {
    const raw = 'Here is the answer:\n{"answer":"yes","confidence":0.8}\nThanks.';
    await expect(
      parseResponse(
        raw,
        z.object({
          answer: z.string(),
          confidence: z.number(),
        }),
      ),
    ).rejects.toThrow("Cannot parse response as JSON");
  });

  it("parses JSON-hostile string content when JSON escaping is valid", async () => {
    const raw = JSON.stringify({
      content:
        'Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.',
    });
    const result = await parseResponse(
      raw,
      z.object({
        content: z.string(),
      }),
    );

    expect(result).toEqual({
      content:
        'Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.',
    });
  });

  it("parses nested object content that XML tags could not represent", async () => {
    const result = await parseResponse(
      '{"person":{"name":"Ada","age":37}}',
      z.object({
        person: z.object({
          name: z.string(),
          age: z.number(),
        }),
      }),
    );

    expect(result).toEqual({ person: { name: "Ada", age: 37 } });
  });
});

describe("parseResponse with a JSON Schema", () => {
  it("returns the parsed JSON without validating it", async () => {
    const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };

    expect(await parseResponse('{"n":"not a number"}', schema)).toEqual({ n: "not a number" });
  });

  it("throws on non-JSON input", async () => {
    await expect(parseResponse("nope", { type: "object" })).rejects.toThrow(
      "Cannot parse response as JSON",
    );
  });
});

describe("parseResponse with a Standard Schema", () => {
  it("applies the schema's transforms and defaults", async () => {
    const schema = z.object({
      size: z.string().transform((value) => value.length),
      role: z.string().default("user"),
    });

    expect(await parseResponse('{"size":"abc"}', schema)).toEqual({ size: 3, role: "user" });
  });

  it("names the path of each failed field", async () => {
    const schema = z.object({ user: z.object({ tags: z.array(z.string()) }) });

    await expect(parseResponse('{"user":{"tags":["a",2]}}', schema)).rejects.toThrow(
      "Validation failed: user.tags.1:",
    );
  });

  it("waits for a validator that answers asynchronously", async () => {
    const schema = z.object({ name: z.string().refine(async (value) => value !== "taken") });

    expect(await parseResponse('{"name":"free"}', schema)).toEqual({ name: "free" });
    await expect(parseResponse('{"name":"taken"}', schema)).rejects.toThrow("Validation failed");
  });
});

describe("ParsedSchema", () => {
  it("is the schema's output type for a Standard Schema and unknown for a JSON Schema", async () => {
    const typed = await parseResponse(
      '{"size":"abc"}',
      z.object({ size: z.string().transform((value) => value.length) }),
    );
    const untyped = await parseResponse("{}", { type: "object" });

    expectTypeOf(typed).toEqualTypeOf<{ size: number } | string>();
    expectTypeOf(untyped).toEqualTypeOf<unknown>();
  });
});

describe("toJsonSchema", () => {
  it("returns a JSON Schema object as it is", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };

    expect(toJsonSchema(schema)).toBe(schema);
  });

  it("converts a Standard Schema as the input the model writes", () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
      size: z.string().transform((value) => value.length),
    });

    expect(toJsonSchema(schema)).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
        size: { type: "string" },
      },
      required: ["name", "size"],
    });
  });

  it("returns plain data that carries no validator", () => {
    const converted = toJsonSchema(z.object({ name: z.string() }));

    expect("~standard" in converted).toBe(false);
  });

  it("lets the library's own conversion error through", () => {
    expect(() => toJsonSchema(z.object({ at: z.date() }))).toThrow(
      "Date cannot be represented in JSON Schema",
    );
  });

  it("rejects a Standard Schema without a JSON Schema converter", () => {
    const schema = {
      "~standard": { version: 1, vendor: "acme", validate: (value: unknown) => ({ value }) },
    };

    expect(() => toJsonSchema(schema as never)).toThrow(
      "The schema's library (acme) does not implement Standard JSON Schema",
    );
  });
});

describe("parseJsonObject", () => {
  it("parses strict JSON", () => {
    const result = parseJsonObject('{"a":"{literal}","b":[1,2]}');
    expect(result).toEqual({ a: "{literal}", b: [1, 2] });
  });

  it("throws when no JSON value exists", () => {
    expect(() => parseJsonObject("no object here")).toThrow("Cannot parse response as JSON");
  });
});

describe("parseTaggedSections", () => {
  it("extracts legacy tags from input", () => {
    const result = parseTaggedSections("<foo>bar</foo> extra text");
    expect(result.tags).toEqual({ foo: "bar" });
    expect(result.remaining).toBe("extra text");
  });

  it("handles multiple tags", () => {
    const result = parseTaggedSections("<a>1</a><b>2</b>");
    expect(result.tags).toEqual({ a: "1", b: "2" });
  });

  it("handles empty input", () => {
    const result = parseTaggedSections("");
    expect(result.tags).toEqual({});
    expect(result.remaining).toBe("");
  });

  it("handles partial/unclosed tags", () => {
    const result = parseTaggedSections("<foo>content");
    expect(result.tags.foo).toBe("content");
  });
});
