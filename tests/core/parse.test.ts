import { describe, expect, it } from "vitest";
import * as z from "zod";
import { parseResponse, parseTaggedSections } from "../../src/core/parse.js";

describe("parseResponse", () => {
  it("returns raw string when schema is undefined", () => {
    const result = parseResponse("hello world");
    expect(result).toBe("hello world");
  });

  it("parses a single string tag", () => {
    const result = parseResponse("<answer>Paris</answer>", {
      answer: z.string(),
    });
    expect(result).toEqual({ answer: "Paris" });
  });

  it("parses a number tag", () => {
    const result = parseResponse("<count>42</count>", {
      count: z.number(),
    });
    expect(result).toEqual({ count: 42 });
  });

  it("parses a boolean tag", () => {
    const result = parseResponse("<isTrue>true</isTrue>", {
      isTrue: z.boolean(),
    });
    expect(result).toEqual({ isTrue: true });
  });

  it("parses multiple tags", () => {
    const raw = "<name>Alice</name><age>30</age><active>true</active>";
    const result = parseResponse(raw, {
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });
    expect(result).toEqual({ name: "Alice", age: 30, active: true });
  });

  it("parses an array tag", () => {
    const result = parseResponse('<items>["a","b","c"]</items>', {
      items: z.array(z.string()),
    });
    expect(result).toEqual({ items: ["a", "b", "c"] });
  });

  it("parses comma-separated array fallback", () => {
    const result = parseResponse("<items>apple, banana, cherry</items>", {
      items: z.array(z.string()),
    });
    expect(result).toEqual({ items: ["apple", "banana", "cherry"] });
  });

  it("parses an object tag", () => {
    const result = parseResponse('<data>{"x":1,"y":2}</data>', {
      data: z.object({ x: z.number(), y: z.number() }),
    });
    expect(result).toEqual({ data: { x: 1, y: 2 } });
  });

  it("handles optional fields that are missing", () => {
    const result = parseResponse("<name>Bob</name>", {
      name: z.string(),
      nickname: z.string().optional(),
    });
    expect(result).toEqual({ name: "Bob" });
  });

  it("throws when required tag is missing", () => {
    expect(() =>
      parseResponse("<name>Bob</name>", {
        name: z.string(),
        age: z.number(),
      }),
    ).toThrow("Expected results with tag age but it does not exist");
  });

  it("handles empty schema with empty input", () => {
    const result = parseResponse("{}", {});
    expect(result).toEqual({});
  });

  it("throws on empty schema with non-empty input", () => {
    expect(() => parseResponse("some content", {})).toThrow("Schema is empty");
  });

  it("handles multiline tag content", () => {
    const raw = "<response>Line 1\nLine 2\nLine 3</response>";
    const result = parseResponse(raw, { response: z.string() });
    expect(result).toEqual({ response: "Line 1\nLine 2\nLine 3" });
  });

  it("unwraps json code block wrapper", () => {
    const raw = "```json\n<answer>hello</answer>\n```";
    const result = parseResponse(raw, { answer: z.string() });
    expect(result).toEqual({ answer: "hello" });
  });

  describe("schema shape coverage", () => {
    it("parses flat primitives", () => {
      const result = parseResponse(
        "<answer>Use TypeScript</answer><confidence>0.82</confidence><accepted>true</accepted>",
        {
          answer: z.string(),
          confidence: z.number(),
          accepted: z.boolean(),
        },
      );

      expect(result).toEqual({
        answer: "Use TypeScript",
        confidence: 0.82,
        accepted: true,
      });
    });

    it("parses arrays of primitives", () => {
      const result = parseResponse(
        '<bullets>["fast iteration","broad ecosystem"]</bullets><scores>[0.8,0.9]</scores>',
        {
          bullets: z.array(z.string()),
          scores: z.array(z.number()),
        },
      );

      expect(result).toEqual({
        bullets: ["fast iteration", "broad ecosystem"],
        scores: [0.8, 0.9],
      });
    });

    it("parses nested objects when the top-level tag contains JSON", () => {
      const result = parseResponse(
        '<person>{"name":"Ada","age":37,"skills":["math","programming"]}</person>',
        {
          person: z.object({
            name: z.string(),
            age: z.number(),
            skills: z.array(z.string()),
          }),
        },
      );

      expect(result).toEqual({
        person: { name: "Ada", age: 37, skills: ["math", "programming"] },
      });
    });

    it("parses arrays of objects when the top-level tag contains JSON", () => {
      const result = parseResponse(
        '<tasks>[{"title":"Ship JSON output","priority":"high","done":false},{"title":"Benchmark models","priority":"medium","done":false}]</tasks>',
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

    it("parses optional fields when present and omits them when missing", () => {
      const withOptional = parseResponse("<title>Plan</title><notes>Keep it small</notes>", {
        title: z.string(),
        notes: z.string().optional(),
      });
      const withoutOptional = parseResponse("<title>Plan</title>", {
        title: z.string(),
        notes: z.string().optional(),
      });

      expect(withOptional).toEqual({ title: "Plan", notes: "Keep it small" });
      expect(withoutOptional).toEqual({ title: "Plan" });
    });

    it("parses JSON-hostile string content as plain tag text", () => {
      const raw =
        '<content>Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.</content>';
      const result = parseResponse(raw, {
        content: z.string(),
      });

      expect(result).toEqual({
        content: 'Line one with "quotes"\n```ts\nconst value = "<tag>";\n```\nUse { braces } literally.',
      });
    });

    it("does not parse nested XML tags as object JSON", () => {
      expect(() =>
        parseResponse("<person><name>Ada</name><age>37</age></person>", {
          person: z.object({
            name: z.string(),
            age: z.number(),
          }),
        }),
      ).toThrow("Cannot parse object as JSON");
    });
  });
});

describe("parseTaggedSections", () => {
  it("extracts tags from input", () => {
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
