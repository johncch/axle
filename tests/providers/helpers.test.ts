import { describe, expect, test, vi } from "vitest";
import type { ContentPartToolCall } from "../../src/messages/message.js";
import { executeToolCalls } from "../../src/providers/helpers.js";

function makeToolCall(name: string, id?: string): ContentPartToolCall {
  return {
    type: "tool-call",
    id: id ?? `call-${name}`,
    name,
    parameters: { input: "test" },
  };
}

describe("executeToolCalls", () => {
  describe("with onToolCall", () => {
    test("calls onToolCall and returns success result", async () => {
      const onToolCall = vi.fn().mockResolvedValue({
        type: "success",
        content: "result",
      });

      const { results } = await executeToolCalls([makeToolCall("my-tool")], onToolCall);

      expect(onToolCall).toHaveBeenCalledWith("my-tool", { input: "test" });
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("result");
      expect(results[0].isError).toBeUndefined();
    });

    test("returns error result when tool execution fails", async () => {
      const onToolCall = vi.fn().mockResolvedValue({
        type: "error",
        error: { type: "execution", message: "something broke" },
      });

      const { results } = await executeToolCalls([makeToolCall("bad-tool")], onToolCall);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
    });

    test("returns not-found error when onToolCall returns null", async () => {
      const onToolCall = vi.fn().mockResolvedValue(null);

      const { results } = await executeToolCalls([makeToolCall("unknown")], onToolCall);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("not-found");
    });

    test("continues processing after a missing tool", async () => {
      const onToolCall = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ type: "success", content: "ok" });

      const { results } = await executeToolCalls(
        [makeToolCall("missing"), makeToolCall("found")],
        onToolCall,
      );

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[1].content).toBe("ok");
    });

    test("catches exceptions from onToolCall", async () => {
      const onToolCall = vi.fn().mockRejectedValue(new Error("crash"));

      const { results } = await executeToolCalls([makeToolCall("crasher")], onToolCall);

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("crash");
    });
  });

  describe("without onToolCall", () => {
    test("returns not-found errors for all tool calls", async () => {
      const { results } = await executeToolCalls([makeToolCall("tool-a"), makeToolCall("tool-b")]);

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("not-found");
      expect(results[1].isError).toBe(true);
      expect(results[1].content).toContain("not-found");
    });
  });
});
