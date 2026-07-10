import { describe, expect, test } from "vitest";
import { resolveFirstPartyModel } from "../../src/providers/model.js";

describe("first-party model resolution", () => {
  test("strips the matching publisher", () => {
    expect(resolveFirstPartyModel("openai/gpt-5.5", ["openai"])).toBe("gpt-5.5");
    expect(resolveFirstPartyModel("google/gemini-3-flash", ["gemini", "google"])).toBe(
      "gemini-3-flash",
    );
  });

  test("preserves unqualified model IDs", () => {
    expect(resolveFirstPartyModel("gpt-5.5", ["openai"])).toBe("gpt-5.5");
  });

  test("rejects a model qualified for another publisher", () => {
    expect(() => resolveFirstPartyModel("zai/glm-5.2", ["openai"])).toThrow(
      'Model "zai/glm-5.2" is not available from openai',
    );
  });
});
