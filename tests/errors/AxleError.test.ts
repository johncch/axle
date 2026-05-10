import { describe, expect, it } from "vitest";
import { AxleError } from "../../src/errors/AxleError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";

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

describe("AxleToolFatalError", () => {
  it("serializes tool metadata and partial turn state", () => {
    const cause = { code: "SANDBOX_DEAD" };
    const error = new AxleToolFatalError("Sandbox terminated", {
      toolName: "exec",
      messages: [{ role: "assistant", id: "a1", content: [], finishReason: "function_call" as any }],
      partial: { role: "assistant", id: "a1", content: [], finishReason: "function_call" as any },
      usage: { in: 10, out: 2 },
      cause,
    });

    const parsed = JSON.parse(JSON.stringify(error));

    expect(parsed.name).toBe("AxleToolFatalError");
    expect(parsed.code).toBe("TOOL_FATAL_ERROR");
    expect(parsed.toolName).toBe("exec");
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.partial.id).toBe("a1");
    expect(parsed.usage).toEqual({ in: 10, out: 2 });
    expect(parsed.cause).toEqual(cause);
  });
});
