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

    test("runs unmarked tools sequentially", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ input: z.string() });
      const serialTool: ExecutableTool<typeof schema> = {
        name: "unmarked",
        description: "Unmarked",
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
          makeToolCallWithParams("unmarked", "a", { input: "a" }),
          makeToolCallWithParams("unmarked", "b", { input: "b" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(1);
      expect(results.map((result) => result.content)).toEqual(["a", "b"]);
    });

    test("runs contiguous parallel-safe tool calls concurrently and preserves result order", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ input: z.string() });
      const parallelTool: ExecutableTool<typeof schema> = {
        name: "parallel",
        description: "Parallel",
        schema,
        execution: { parallel: true },
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(input.input === "first" ? 20 : 1);
          active -= 1;
          return input.input;
        },
      };
      const registry = new ToolRegistry({
        tools: [parallelTool],
      });

      const { results } = await executeToolCalls(
        [
          makeToolCallWithParams("parallel", "first", { input: "first" }),
          makeToolCallWithParams("parallel", "second", { input: "second" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(2);
      expect(results.map((result) => result.content)).toEqual(["first", "second"]);
    });

    test("uses serial tool calls as barriers between parallel groups", async () => {
      const events: string[] = [];
      const schema = z.object({ input: z.string() });
      const parallelTool: ExecutableTool<typeof schema> = {
        name: "parallel",
        description: "Parallel",
        schema,
        execution: { parallel: true },
        async execute(input) {
          events.push(`start:${input.input}`);
          await delay(5);
          events.push(`end:${input.input}`);
          return input.input;
        },
      };
      const serialTool: ExecutableTool<typeof schema> = {
        name: "serial",
        description: "Serial",
        schema,
        async execute(input) {
          events.push(`start:${input.input}`);
          await delay(1);
          events.push(`end:${input.input}`);
          return input.input;
        },
      };
      const registry = new ToolRegistry({
        tools: [parallelTool, serialTool],
      });

      await executeToolCalls(
        [
          makeToolCallWithParams("parallel", "p1", { input: "p1" }),
          makeToolCallWithParams("parallel", "p2", { input: "p2" }),
          makeToolCallWithParams("serial", "s1", { input: "s1" }),
          makeToolCallWithParams("parallel", "p3", { input: "p3" }),
          makeToolCallWithParams("parallel", "p4", { input: "p4" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(events.indexOf("start:s1")).toBeGreaterThan(events.indexOf("end:p1"));
      expect(events.indexOf("start:s1")).toBeGreaterThan(events.indexOf("end:p2"));
      expect(events.indexOf("start:p3")).toBeGreaterThan(events.indexOf("end:s1"));
      expect(events.indexOf("start:p4")).toBeGreaterThan(events.indexOf("end:s1"));
    });

    test("does not run conflicting parallel-safe calls at the same time", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ path: z.string() });
      const writeLikeTool: ExecutableTool<typeof schema> = {
        name: "write_like",
        description: "Write-like",
        schema,
        execution: {
          parallel: true,
          conflictKey: (input) => input.path,
        },
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(5);
          active -= 1;
          return input.path;
        },
      };
      const registry = new ToolRegistry({
        tools: [writeLikeTool],
      });

      await executeToolCalls(
        [
          makeToolCallWithParams("write_like", "a", { path: "same.txt" }),
          makeToolCallWithParams("write_like", "b", { path: "same.txt" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(1);
    });

    test("honors maxConcurrency for parallel-safe groups", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ input: z.string() });
      const limitedTool: ExecutableTool<typeof schema> = {
        name: "limited",
        description: "Limited",
        schema,
        execution: { parallel: true, maxConcurrency: 2 },
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(5);
          active -= 1;
          return input.input;
        },
      };
      const registry = new ToolRegistry({
        tools: [limitedTool],
      });

      await executeToolCalls(
        [
          makeToolCallWithParams("limited", "a", { input: "a" }),
          makeToolCallWithParams("limited", "b", { input: "b" }),
          makeToolCallWithParams("limited", "c", { input: "c" }),
          makeToolCallWithParams("limited", "d", { input: "d" }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(2);
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
