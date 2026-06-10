import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import type { ContentPartToolCall } from "../../src/messages/message.js";
import { executeToolCalls } from "../../src/providers/helpers.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ExecutableTool } from "../../src/tools/types.js";

const testSignal = new AbortController().signal;
const testRegistry = new ToolRegistry();

function makeToolCall(name: string, id?: string): ContentPartToolCall {
  return {
    type: "tool-call",
    id: id ?? `call-${name}`,
    name,
    parameters: { input: "test" },
  };
}

function makeToolCallWithParams(
  name: string,
  id: string,
  parameters: Record<string, unknown>,
): ContentPartToolCall {
  return {
    type: "tool-call",
    id,
    name,
    parameters,
  };
}

describe("executeToolCalls", () => {
  describe("with onToolCall", () => {
    test("calls onToolCall and returns success result", async () => {
      const onToolCall = vi.fn().mockResolvedValue({
        type: "success",
        content: "result",
      });

      const { results } = await executeToolCalls(
        [makeToolCall("my-tool")],
        onToolCall,
        testSignal,
        testRegistry,
      );

      expect(onToolCall).toHaveBeenCalledWith("my-tool", { input: "test" }, expect.anything());
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("result");
      expect(results[0].isError).toBeUndefined();
    });

    test("returns error result when tool execution fails", async () => {
      const onToolCall = vi.fn().mockResolvedValue({
        type: "error",
        error: { type: "execution", message: "something broke" },
      });

      const { results } = await executeToolCalls(
        [makeToolCall("bad-tool")],
        onToolCall,
        testSignal,
        testRegistry,
      );

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
    });

    test("returns not-found error when onToolCall returns null", async () => {
      const onToolCall = vi.fn().mockResolvedValue(null);

      const { results } = await executeToolCalls(
        [makeToolCall("unknown")],
        onToolCall,
        testSignal,
        testRegistry,
      );

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
        testSignal,
        testRegistry,
      );

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[1].content).toBe("ok");
    });

    test("catches exceptions from onToolCall", async () => {
      const onToolCall = vi.fn().mockRejectedValue(new Error("crash"));

      const { results } = await executeToolCalls(
        [makeToolCall("crasher")],
        onToolCall,
        testSignal,
        testRegistry,
      );

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("crash");
    });

    test("rethrows AxleToolFatalError from onToolCall", async () => {
      const fatal = new AxleToolFatalError("sandbox terminated", { toolName: "fatal-tool" });
      const onToolCall = vi.fn().mockRejectedValue(fatal);

      await expect(
        executeToolCalls([makeToolCall("fatal-tool")], onToolCall, testSignal, testRegistry),
      ).rejects.toBe(fatal);
    });

    test("passes a ToolContext with signal, tracer span, and registry", async () => {
      const onToolCall = vi.fn().mockResolvedValue({ type: "success", content: "ok" });

      await executeToolCalls([makeToolCall("t")], onToolCall, testSignal, testRegistry);

      const ctx = onToolCall.mock.calls[0][2];
      expect(ctx.signal).toBe(testSignal);
      expect(ctx.registry).toBe(testRegistry);
    });
  });

  describe("without onToolCall", () => {
    test("executes matching tools from the registry", async () => {
      const execute = vi.fn().mockResolvedValue("saw test");
      const registry = new ToolRegistry({
        tools: [
          {
            name: "registered-tool",
            description: "Registered test tool",
            schema: z.object({ input: z.string() }),
            execute,
          },
        ],
      });

      const { results } = await executeToolCalls(
        [makeToolCall("registered-tool")],
        undefined,
        testSignal,
        registry,
      );

      expect(execute).toHaveBeenCalledWith({ input: "test" }, expect.anything());
      expect(results).toHaveLength(1);
      expect(results[0].content).toBe("saw test");
      expect(results[0].isError).toBeUndefined();
    });

    test("returns not-found errors for all tool calls", async () => {
      const { results } = await executeToolCalls(
        [makeToolCall("tool-a"), makeToolCall("tool-b")],
        undefined,
        testSignal,
        testRegistry,
      );

      expect(results).toHaveLength(2);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("not-found");
      expect(results[1].isError).toBe(true);
      expect(results[1].content).toContain("not-found");
    });

    test("runs tool calls sequentially in call order", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ input: z.string() });
      const serialTool: ExecutableTool<typeof schema> = {
        name: "serial",
        description: "Serial",
        schema,
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(5);
          active -= 1;
          return input.input;
        },
      };
      const registry = new ToolRegistry({ tools: [serialTool] });

      const { results } = await executeToolCalls(
        [
          makeToolCallWithParams("serial", "a", { input: "a" }),
          makeToolCallWithParams("serial", "b", { input: "b" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(1);
      expect(results.map((result) => result.content)).toEqual(["a", "b"]);
    });

    test("accumulates usage reported through ctx.reportUsage", async () => {
      const schema = z.object({ input: z.string() });
      const reportingTool: ExecutableTool<typeof schema> = {
        name: "reporting",
        description: "Reports child usage",
        schema,
        async execute(input, ctx) {
          ctx.reportUsage?.({
            in: 10,
            out: 5,
            breakdown: [{ provider: "anthropic", model: "claude-x", in: 10, out: 5 }],
          });
          return input.input;
        },
      };
      const registry = new ToolRegistry({ tools: [reportingTool] });

      const { usage } = await executeToolCalls(
        [
          makeToolCallWithParams("reporting", "a", { input: "a" }),
          makeToolCallWithParams("reporting", "b", { input: "b" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(usage).toMatchObject({ in: 20, out: 10 });
      expect(usage?.breakdown).toEqual([
        { provider: "anthropic", model: "claude-x", in: 20, out: 10 },
      ]);
    });

    test("treats a tool-thrown AbortError as recoverable while the signal is live", async () => {
      const schema = z.object({ input: z.string() });
      const timeoutTool: ExecutableTool<typeof schema> = {
        name: "timeout",
        description: "Internal timeout",
        schema,
        async execute() {
          const error = new Error("fetch timed out");
          error.name = "AbortError";
          throw error;
        },
      };
      const registry = new ToolRegistry({ tools: [timeoutTool] });

      const { results } = await executeToolCalls(
        [makeToolCall("timeout")],
        undefined,
        testSignal,
        registry,
      );

      expect(results).toHaveLength(1);
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("fetch timed out");
    });

    test("attaches usage from completed calls to a later terminal error", async () => {
      const schema = z.object({ input: z.string() });
      const reportingTool: ExecutableTool<typeof schema> = {
        name: "reporting",
        description: "Reports usage",
        schema,
        async execute(input, ctx) {
          ctx.reportUsage?.({ in: 10, out: 5 });
          return input.input;
        },
      };
      const fatalTool: ExecutableTool<typeof schema> = {
        name: "fatal",
        description: "Fails fatally",
        schema,
        async execute() {
          throw new AxleToolFatalError("boom", { toolName: "fatal" });
        },
      };
      const registry = new ToolRegistry({ tools: [reportingTool, fatalTool] });

      let thrown: unknown;
      try {
        await executeToolCalls(
          [makeToolCall("reporting"), makeToolCall("fatal")],
          undefined,
          testSignal,
          registry,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AxleToolFatalError);
      expect((thrown as AxleToolFatalError).usage).toMatchObject({ in: 10, out: 5 });
    });

    test("returns no usage when no tool reports any", async () => {
      const schema = z.object({ input: z.string() });
      const silentTool: ExecutableTool<typeof schema> = {
        name: "silent",
        description: "Silent",
        schema,
        execute: async (input) => input.input,
      };
      const registry = new ToolRegistry({ tools: [silentTool] });

      const { usage } = await executeToolCalls(
        [makeToolCall("silent")],
        undefined,
        testSignal,
        registry,
      );

      expect(usage).toBeUndefined();
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
