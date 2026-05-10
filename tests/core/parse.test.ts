import { describe, expect, it } from "vitest";
import * as z from "zod";
import { parseJsonObject, parseResponse, parseTaggedSections } from "../../src/core/parse.js";

describe("parseResponse", () => {
  it("returns raw string when schema is undefined", () => {
    const result = parseResponse("hello world");
    expect(result).toBe("hello world");
  });

  it("parses flat primitives from JSON", () => {
    const result = parseResponse('{"answer":"Paris","count":42,"accepted":true}', {
      answer: z.string(),
      count: z.number(),
      accepted: z.boolean(),
    });

    expect(result).toEqual({ answer: "Paris", count: 42, accepted: true });
  });

  it("parses arrays of primitives from JSON", () => {
    const result = parseResponse('{"items":["a","b","c"],"scores":[0.4,0.9]}', {
      items: z.array(z.string()),
      scores: z.array(z.number()),
    });

    expect(result).toEqual({ items: ["a", "b", "c"], scores: [0.4, 0.9] });
  });

  it("parses nested objects from JSON", () => {
    const result = parseResponse('{"person":{"name":"Ada","age":37,"skills":["math","code"]}}', {
      person: z.object({
        name: z.string(),
        age: z.number(),
        skills: z.array(z.string()),
      }),
    });

    expect(result).toEqual({
      person: { name: "Ada", age: 37, skills: ["math", "code"] },
    });
  });

  it("parses arrays of objects from JSON", () => {
    const result = parseResponse(
      '{"tasks":[{"title":"Ship JSON output","priority":"high","done":false},{"title":"Benchmark models","priority":"medium","done":false}]}',
      {
        tasks: z.array(
          z.object({
            title: z.string(),
            priority: z.string(),
            done: z.boolean(),
          }),
        ),
      },
    );

    expect(result).toEqual({
      tasks: [
        { title: "Ship JSON output", priority: "high", done: false },
        { title: "Benchmark models", priority: "medium", done: false },
      ],
    });
  });

  it("handles optional fields that are missing", () => {
    const result = parseResponse('{"name":"Bob"}', {
      name: z.string(),
      nickname: z.string().optional(),
    });

    expect(result).toEqual({ name: "Bob" });
  });

  it("throws when a required field is missing", () => {
    expect(() =>
      parseResponse('{"name":"Bob"}', {
        name: z.string(),
        age: z.number(),
      }),
    ).toThrow("Validation failed");
  });

  it("handles empty schema with empty input", () => {
    const result = parseResponse("{}", {});
    expect(result).toEqual({});
  });

  it("throws on empty schema with non-empty input", () => {
    expect(() => parseResponse("some content", {})).toThrow("Schema is empty");
  });

  it("unwraps a json code block wrapper", () => {
    const raw = '```json\n{"answer":"hello"}\n```';
    const result = parseResponse(raw, { answer: z.string() });
    expect(result).toEqual({ answer: "hello" });
  });

  it("throws when the model adds prose around JSON", () => {
    const raw = 'Here is the answer:\n{"answer":"yes","confidence":0.8}\nThanks.';
    expect(() =>
      parseResponse(raw, {
        answer: z.string(),
        confidence: z.number(),
      }),
    ).toThrow("Cannot parse response as JSON");
  });

  it("parses JSON-hostile string content when JSON escaping is valid", () => {
    const raw = JSON.stringify({
      content:
        'Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.',
    });
    const result = parseResponse(raw, {
      content: z.string(),
    });

    expect(result).toEqual({
      content:
        'Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.',
    });
  });

  it("parses nested object content that XML tags could not represent", () => {
    const result = parseResponse('{"person":{"name":"Ada","age":37}}', {
      person: z.object({
        name: z.string(),
        age: z.number(),
      }),
    });

    expect(result).toEqual({ person: { name: "Ada", age: 37 } });
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
