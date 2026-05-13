import { describe, expect, test } from "vitest";
import { replaceVariables } from "../../src/utils/replace.js";

describe("replaceVariables", () => {
  test("replaces variables including falsy values", () => {
    const template = "a={{a}}, b={{b}}, c={{c}}";
    const result = replaceVariables(template, { a: 1, b: 0, c: "" });
    expect(result).toBe("a=1, b=0, c=");
  });

  test("throws on missing variables", () => {
    const template = "Hello {{name}}, welcome to {{place}}";
    expect(() => replaceVariables(template, {})).toThrow(/Missing variables: name, place/);
  });

  test("throws on single missing variable", () => {
    const template = "Hello {{name}}";
    expect(() => replaceVariables(template, {})).toThrow("Missing variable: name");
    expect(() => replaceVariables(template, {})).not.toThrow(/--args/);
  });

  test("deduplicates missing variable names", () => {
    const template = "{{x}} and {{x}} again";
    expect(() => replaceVariables(template, {})).toThrow(/Missing variable: x/);
  });

  test("passes when all variables are provided", () => {
    const template = "Hello {{name}}";
    const result = replaceVariables(template, { name: "Alice" });
    expect(result).toBe("Hello Alice");
  });

  test("leaves missing variables in place when strict is false", () => {
    const template = "Hello {{name}}, meet {{breed}}";
    const result = replaceVariables(template, { name: "Alice" }, { strict: false });
    expect(result).toBe("Hello Alice, meet {{breed}}");
  });
});
