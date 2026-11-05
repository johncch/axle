import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import { executeToolCalls, type ToolExecutionObserver } from "../../src/execution/helpers.js";
import type { ContentPartToolCall } from "../../src/messages/message.js";
import { parallelize } from "../../src/tools/parallelize.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type {
  DeferredTool,
  ExecutableTool,
  ToolCallCallback,
  ToolContext,
} from "../../src/tools/types.js";
import { attributeStats } from "../../src/utils/stats.js";

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

function deferred(name: string, schema = z.looseObject({}), timeout?: number): DeferredTool {
  return {
    type: "deferred",
    name,
    description: `deferred ${name}`,
    schema,
    ...(timeout === undefined ? {} : { timeout }),
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
  describe("deferred tools", () => {
    const deferredRegistry = new ToolRegistry({
      tools: [
        deferred("my-tool"),
        deferred("bad-tool"),
        deferred("crasher"),
        deferred("fatal-tool"),
        deferred("t"),
        deferred("strict", z.object({ count: z.number() })),
        deferred("slow", z.looseObject({}), 20),
        {
          name: "runs-itself",
          description: "executable",
          schema: z.object({ input: z.string() }),
          async execute() {
            return "ran";
          },
        },
      ],
    });

    test("hands a deferred call to onToolCall and returns its answer", async () => {
      const onToolCall = vi.fn(() => "result");

      const { results } = await executeToolCalls(
        [makeToolCall("my-tool")],
        onToolCall,
        testSignal,
        deferredRegistry,
      );

      expect(onToolCall).toHaveBeenCalledWith(
        { id: "call-my-tool", name: "my-tool", input: { input: "test" } },
        expect.objectContaining({ signal: expect.any(AbortSignal), emit: expect.any(Function) }),
      );
      expect(results).toEqual([{ id: "call-my-tool", name: "my-tool", content: "result" }]);
    });

    test("never consults onToolCall for an executable tool", async () => {
      const onToolCall = vi.fn(() => "intercepted");

      const { results } = await executeToolCalls(
        [makeToolCall("runs-itself")],
        onToolCall,
        testSignal,
        deferredRegistry,
      );

      expect(onToolCall).not.toHaveBeenCalled();
      expect(results[0].content).toBe("ran");
    });

    test("a thrown error is an execution error carrying the reason", async () => {
      const { results } = await executeToolCalls(
        [makeToolCall("bad-tool")],
        () => {
          throw new Error("not here");
        },
        testSignal,
        deferredRegistry,
      );

      expect(results[0].isError).toBe(true);
      expect(JSON.parse(String(results[0].content))).toEqual({
        error: { type: "execution", message: "not here" },
      });
    });

    test("returning nothing is an unanswered error", async () => {
      const { results } = await executeToolCalls(
        [makeToolCall("my-tool")],
        () => undefined,
        testSignal,
        deferredRegistry,
      );

      expect(JSON.parse(String(results[0].content))).toEqual({
        error: { type: "unanswered", message: "No handler answered my-tool" },
      });
      expect(results[0].isError).toBe(true);
    });

    test("a deferred call with no onToolCall is unanswered without waiting", async () => {
      const onWaiting = vi.fn();
      const { results } = await executeToolCalls(
        [makeToolCall("my-tool")],
        undefined,
        testSignal,
        deferredRegistry,
        undefined,
        { onWaiting },
      );

      expect(onWaiting).not.toHaveBeenCalled();
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("unanswered");
    });

    test("validates the arguments before the handler sees them", async () => {
      const onToolCall = vi.fn(() => "never");

      const { results } = await executeToolCalls(
        [makeToolCallWithParams("strict", "c1", { count: "three" })],
        onToolCall,
        testSignal,
        deferredRegistry,
      );

      expect(onToolCall).not.toHaveBeenCalled();
      expect(results[0].isError).toBe(true);
      expect(results[0].content).toContain("validation");
    });

    test("rethrows AxleToolFatalError from onToolCall", async () => {
      const fatal = new AxleToolFatalError("sandbox terminated", { toolName: "fatal-tool" });

      await expect(
        executeToolCalls(
          [makeToolCall("fatal-tool")],
          () => {
            throw fatal;
          },
          testSignal,
          deferredRegistry,
        ),
      ).rejects.toBe(fatal);
    });

    test("passes a context whose signal follows the run signal", async () => {
      const controller = new AbortController();
      let seen: ToolContext | undefined;
      const onToolCall: ToolCallCallback = (_call, ctx) => {
        seen = ctx;
        expect(ctx.signal.aborted).toBe(false);
        controller.abort("done");
        return "ok";
      };

      await expect(
        executeToolCalls([makeToolCall("t")], onToolCall, controller.signal, deferredRegistry),
      ).rejects.toBeInstanceOf(AxleAbortError);

      expect(seen?.signal.aborted).toBe(true);
      expect(seen?.signal.reason).toBe("done");
    });

    test("a rejection after a pending promise is the call's error result", async () => {
      let reject!: (error: Error) => void;
      const answered = new Promise<string>((_resolve, rejectAnswer) => {
        reject = rejectAnswer;
      });
      const pending = executeToolCalls(
        [makeToolCall("my-tool")],
        () => answered,
        testSignal,
        deferredRegistry,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      reject(new Error("user dismissed"));

      const { results } = await pending;
      expect(JSON.parse(String(results[0].content))).toEqual({
        error: { type: "execution", message: "user dismissed" },
      });
    });

    test("the tool's timeout settles the call and aborts the handler's signal", async () => {
      let seen: ToolContext | undefined;
      const { results } = await executeToolCalls(
        [makeToolCall("slow")],
        (_call, ctx) => {
          seen = ctx;
          return new Promise<string>(() => {});
        },
        testSignal,
        deferredRegistry,
      );

      expect(results[0].isError).toBe(true);
      expect(JSON.parse(String(results[0].content))).toEqual({
        error: { type: "timeout", message: "No answer for slow within 20ms" },
      });
      expect(seen?.signal.aborted).toBe(true);
    });

    test("aborting the run settles a waiting call without the handler's answer", async () => {
      const controller = new AbortController();
      let seen: ToolContext | undefined;
      const pending = executeToolCalls(
        [makeToolCall("my-tool")],
        (_call, ctx) => {
          seen = ctx;
          return new Promise<string>(() => {});
        },
        controller.signal,
        deferredRegistry,
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort("cancelled");

      const error = await pending.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AxleAbortError);
      expect(seen?.signal.aborted).toBe(true);
      expect(seen?.signal.reason).toBe("cancelled");
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

    test("returns a validation error to the model without executing invalid arguments", async () => {
      const execute = vi.fn().mockResolvedValue("saved");
      const registry = new ToolRegistry({
        tools: [
          {
            name: "add_walk",
            description: "Add a walk",
            schema: z.object({
              description: z.string(),
              steps: z.array(z.object({ label: z.string() })),
            }),
            execute,
          },
        ],
      });

      const { results } = await executeToolCalls(
        [makeToolCallWithParams("add_walk", "walk", { steps: [{}] })],
        undefined,
        testSignal,
        registry,
      );

      expect(execute).not.toHaveBeenCalled();
      expect(results[0].isError).toBe(true);
      expect(JSON.parse(String(results[0].content))).toEqual({
        error: {
          type: "validation",
          message:
            "Invalid arguments for add_walk: " +
            "description: Invalid input: expected string, received undefined; " +
            "steps.0.label: Invalid input: expected string, received undefined",
        },
      });
    });

    test("passes parsed arguments to execute so defaults apply", async () => {
      const execute = vi.fn().mockResolvedValue("ok");
      const registry = new ToolRegistry({
        tools: [
          {
            name: "with-default",
            description: "Tool with a default",
            schema: z.object({ input: z.string(), limit: z.number().default(10) }),
            execute,
          },
        ],
      });

      await executeToolCalls([makeToolCall("with-default")], undefined, testSignal, registry);

      expect(execute).toHaveBeenCalledWith({ input: "test", limit: 10 }, expect.anything());
    });

    test("rejects a parallelized tool call when any item is invalid", async () => {
      const execute = vi.fn().mockResolvedValue("saved");
      const registry = new ToolRegistry({
        tools: [
          parallelize({
            name: "add_walk",
            description: "Add a walk",
            schema: z.object({ description: z.string() }),
            execute,
          }),
        ],
      });

      const { results } = await executeToolCalls(
        [
          makeToolCallWithParams("add_walk_batch", "batch", {
            items: [{ description: "a" }, {}],
          }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(execute).not.toHaveBeenCalled();
      expect(results[0].isError).toBe(true);
      expect(String(results[0].content)).toContain('"type":"validation"');
      expect(String(results[0].content)).toContain("items.1.description");
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

    test("runs tool calls concurrently and returns results in call order", async () => {
      let active = 0;
      let maxActive = 0;
      const schema = z.object({ input: z.string(), ms: z.number() });
      const timedTool: ExecutableTool<typeof schema> = {
        name: "timed",
        description: "Timed",
        schema,
        async execute(input) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await delay(input.ms);
          active -= 1;
          return input.input;
        },
      };
      const registry = new ToolRegistry({ tools: [timedTool] });

      const { results } = await executeToolCalls(
        [
          makeToolCallWithParams("timed", "a", { input: "a", ms: 20 }),
          makeToolCallWithParams("timed", "b", { input: "b", ms: 1 }),
          makeToolCallWithParams("timed", "c", { input: "c", ms: 10 }),
        ],
        undefined,
        testSignal,
        registry,
      );

      expect(maxActive).toBe(3);
      expect(results.map((result) => result.id)).toEqual(["a", "b", "c"]);
      expect(results.map((result) => result.content)).toEqual(["a", "b", "c"]);
    });

    test("a fatal error aborts the other calls in the batch", async () => {
      const schema = z.object({ input: z.string() });
      const seen: string[] = [];
      const waitingTool: ExecutableTool<typeof schema> = {
        name: "waiting",
        description: "Waits on its signal",
        schema,
        execute(input, ctx) {
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => {
              seen.push(input.input);
              reject(ctx.signal.reason);
            });
          });
        },
      };
      const fatalTool: ExecutableTool<typeof schema> = {
        name: "fatal",
        description: "Fails fatally",
        schema,
        async execute() {
          await delay(1);
          throw new AxleToolFatalError("boom", { toolName: "fatal" });
        },
      };
      const registry = new ToolRegistry({ tools: [waitingTool, fatalTool] });
      const errors: Array<{ id: string; type: string }> = [];
      const observer: ToolExecutionObserver = {
        onError(call, error) {
          errors.push({
            id: call.id,
            type: error instanceof AxleToolFatalError ? "fatal" : "aborted",
          });
        },
      };

      await expect(
        executeToolCalls(
          [
            makeToolCallWithParams("waiting", "a", { input: "a" }),
            makeToolCall("fatal"),
            makeToolCallWithParams("waiting", "c", { input: "c" }),
          ],
          undefined,
          testSignal,
          registry,
          undefined,
          observer,
        ),
      ).rejects.toBeInstanceOf(AxleToolFatalError);

      expect(seen.sort()).toEqual(["a", "c"]);
      expect(errors).toEqual([
        { id: "call-fatal", type: "fatal" },
        { id: "a", type: "aborted" },
        { id: "c", type: "aborted" },
      ]);
    });

    test("aborting the run signal aborts every call in the batch", async () => {
      const schema = z.object({ input: z.string() });
      const waitingTool: ExecutableTool<typeof schema> = {
        name: "waiting",
        description: "Waits on its signal",
        schema,
        execute(_input, ctx) {
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
          });
        },
      };
      const registry = new ToolRegistry({ tools: [waitingTool] });
      const controller = new AbortController();
      const errors: string[] = [];
      const observer: ToolExecutionObserver = {
        onError(call) {
          errors.push(call.id);
        },
      };

      const pending = executeToolCalls(
        [
          makeToolCallWithParams("waiting", "a", { input: "a" }),
          makeToolCallWithParams("waiting", "b", { input: "b" }),
        ],
        undefined,
        controller.signal,
        registry,
        undefined,
        observer,
      );
      await delay(1);
      controller.abort("user cancelled");

      const thrown = await pending.catch((error: unknown) => error);
      expect(thrown).toBeInstanceOf(AxleAbortError);
      expect((thrown as AxleAbortError).reason).toBe("user cancelled");
      expect(errors.sort()).toEqual(["a", "b"]);
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
            breakdown: [
              {
                provider: "anthropic",
                model: "claude-x",
                requestedModel: "claude-x",
                at: "2026-10-30T12:00:00.000Z",
                in: 10,
                out: 5,
              },
            ],
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
      const row = {
        provider: "anthropic",
        model: "claude-x",
        requestedModel: "claude-x",
        at: "2026-10-30T12:00:00.000Z",
        in: 10,
        out: 5,
      };
      expect(usage?.breakdown).toEqual([row, row]);
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

    test("attaches usage from every settled call to the thrown terminal error", async () => {
      const schema = z.object({ input: z.string() });
      const reportingTool: ExecutableTool<typeof schema> = {
        name: "reporting",
        description: "Reports usage",
        schema,
        async execute(input, ctx) {
          ctx.reportUsage?.(
            attributeStats({ in: 10, out: 5 }, { model: "m", requestedModel: "m" }),
          );
          return input.input;
        },
      };
      const reportingThenWaitingTool: ExecutableTool<typeof schema> = {
        name: "reporting-waiting",
        description: "Reports usage then waits on its signal",
        schema,
        execute(_input, ctx) {
          ctx.reportUsage?.(
            attributeStats({ in: 100, out: 50 }, { model: "m", requestedModel: "m" }),
          );
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
          });
        },
      };
      const fatalTool: ExecutableTool<typeof schema> = {
        name: "fatal",
        description: "Fails fatally",
        schema,
        async execute(_input, ctx) {
          ctx.reportUsage?.(attributeStats({ in: 1, out: 1 }, { model: "m", requestedModel: "m" }));
          await delay(5);
          throw new AxleToolFatalError("boom", { toolName: "fatal" });
        },
      };
      const registry = new ToolRegistry({
        tools: [reportingTool, reportingThenWaitingTool, fatalTool],
      });

      let thrown: unknown;
      try {
        await executeToolCalls(
          [makeToolCall("reporting"), makeToolCall("reporting-waiting"), makeToolCall("fatal")],
          undefined,
          testSignal,
          registry,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(AxleToolFatalError);
      expect((thrown as AxleToolFatalError).usage).toMatchObject({ in: 111, out: 56 });
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
