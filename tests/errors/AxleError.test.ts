import { describe, expect, it } from "vitest";
import { AxleError } from "../../src/errors/AxleError.js";

describe("AxleError", () => {
  it("should serialize to JSON with message", () => {
    const error = new AxleError("Test error message");
    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);

    expect(parsed.message).toBe("Test error message");
    expect(parsed.name).toBe("AxleError");
    expect(parsed.code).toBe("AXLE_ERROR");
  });

  it("should serialize cause chain to JSON", () => {
    const innerError = new Error("Inner error message");
    const axleError = new AxleError("Outer error message", { cause: innerError });

    const json = JSON.stringify(axleError);
    const parsed = JSON.parse(json);

    console.log("Serialized error:", JSON.stringify(parsed, null, 2));

    expect(parsed.message).toBe("Outer error message");
    expect(parsed.cause).toBeDefined();
    expect(parsed.cause.message).toBe("Inner error message");
    expect(parsed.cause.name).toBe("Error");
  });

  it("should serialize nested cause chain", () => {
    const innermost = new Error("Innermost");
    const middle = new AxleError("Middle", { cause: innermost });
    const outer = new AxleError("Outer", { cause: middle });

    const json = JSON.stringify(outer);
    const parsed = JSON.parse(json);

    console.log("Nested cause chain:", JSON.stringify(parsed, null, 2));

    expect(parsed.message).toBe("Outer");
    expect(parsed.cause.message).toBe("Middle");
    expect(parsed.cause.cause.message).toBe("Innermost");
  });
});
