import { describe, expect, test } from "@jest/globals";
import { replaceVariables } from "../../src/utils/replace.js";

describe("replaceVariables", () => {
  test("replaces variables including falsy values", () => {
    const template = "a={{a}}, b={{b}}, c={{c}}";
    const result = replaceVariables(template, { a: 1, b: 0, c: "" });
    expect(result).toBe("a=1, b=0, c=");
  });

  test("leaves unknown placeholders intact", () => {
    const template = "foo={{bar}}";
    const result = replaceVariables(template, {});
    expect(result).toBe("foo={{bar}}");
  });
});
