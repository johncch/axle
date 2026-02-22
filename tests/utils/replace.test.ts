import { describe, expect, test } from "vitest";
import { replaceVariables } from "../../src/utils/replace.js";

describe("replaceVariables", () => {
  test("replaces variables including falsy values", () => {
    const template = "a={{a}}, b={{b}}, c={{c}}";
    const result = replaceVariables(template, { a: 1, b: 0, c: "" });
    expect(result).toBe("a=1, b=0, c=");
  });

  test("leaves unknown placeholders intact in non-strict mode", () => {
    const template = "foo={{bar}}";
    const result = replaceVariables(template, {});
    expect(result).toBe("foo={{bar}}");
  });

  test("throws on missing variables in strict mode", () => {
    const template = "Hello {{name}}, welcome to {{place}}";
    expect(() => replaceVariables(template, {}, { strict: true })).toThrow(
      /Missing variables: name, place/,
    );
  });

  test("throws on single missing variable in strict mode", () => {
    const template = "Hello {{name}}";
    expect(() => replaceVariables(template, {}, { strict: true })).toThrow(
      /Missing variable: name/,
    );
  });

  test("deduplicates missing variable names in strict mode", () => {
    const template = "{{x}} and {{x}} again";
    expect(() => replaceVariables(template, {}, { strict: true })).toThrow(
      /Missing variable: x/,
    );
  });

  test("strict mode passes when all variables are provided", () => {
    const template = "Hello {{name}}";
    const result = replaceVariables(template, { name: "Alice" }, { strict: true });
    expect(result).toBe("Hello Alice");
  });
});
