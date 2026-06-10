import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { executeToolCalls, type ToolExecutionObserver } from "../../src/providers/helpers.js";
import { AxleStopReason, type AIProvider } from "../../src/providers/types.js";
import { createAgentTool } from "../../src/tools/agentTool.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("createAgentTool", () => {
  test("delegates input to a freshly created child agent", async () => {
    const prompts: string[] = [];
    const createAgent = vi.fn(
      () => new Agent({ provider: createProvider("child done", prompts), model: "mock" }),
    );
    const tool = createAgentTool({
      name: "delegate",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent,
      prompt: (input) => `Do this: ${input.task}`,
    });

    const { results } = await runAgentTool(tool, { task: "summarize" });

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(prompts).toEqual(["Do this: summarize"]);
    expect(results[0].content).toBe("child done");
  });

  test("returns child usage with provider and model attribution", async () => {
    const tool = createAgentTool({
      name: "researcher",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () =>
        new Agent({
          name: "child-researcher",
          provider: createProvider("child done"),
          model: "child-model",
        }),
    });

    const result = await runAgentTool(tool, { task: "summarize" });

    expect(result.results[0].content).toBe("child done");
    expect(result.usage).toEqual({
      in: 3,
      out: 4,
      breakdown: [{ provider: "child-provider", model: "mock", in: 3, out: 4 }],
    });
  });

  test("forwards child agent events through tool progress", async () => {
    const chunks: unknown[] = [];
    const tool = createAgentTool({
      name: "delegate_progress",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () => new Agent({ provider: createProvider("child done"), model: "mock" }),
    });

    await runAgentTool(
      tool,
      { task: "summarize" },
      {
        onDelta: (_call, chunk) => chunks.push(chunk),
      },
    );

    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "turn:start"))).toBe(true);
    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "text:delta"))).toBe(true);
    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "turn:end"))).toBe(true);
  });

  test("reports a failed child send as an error-typed tool result and still bills its usage", async () => {
    const tool = createAgentTool({
      name: "researcher",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () => new Agent({ provider: createErrorChildProvider(), model: "child-model" }),
    });

    const result = await runAgentTool(tool, { task: "summarize" });

    expect(result.results[0].isError).toBe(true);
    expect(result.results[0].content).toContain("Subagent failed");
    expect(result.results[0].content).toContain("rate limited");
    expect(result.usage).toMatchObject({ in: 3, out: 4 });
  });

  test("rolls child usage into the parent with distinct provider and model attribution", async () => {
    const tool = createAgentTool({
      name: "delegate",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () =>
        new Agent({
          name: "researcher",
          provider: createProvider("child done"),
          model: "child-configured-model",
        }),
    });
    const parent = new Agent({
      provider: createParentProvider(),
      model: "parent-configured-model",
      tools: [tool],
    });

    const result = await parent.send("delegate this").final;

    expect(result.usage).toEqual({
      in: 5,
      out: 8,
      breakdown: [
        { provider: "parent-provider", model: "parent-runtime-model", in: 2, out: 4 },
        { provider: "child-provider", model: "mock", in: 3, out: 4 },
      ],
    });
    expect(result.turn?.usage).toMatchObject({
      in: 5,
      out: 8,
      breakdown: [
        { provider: "parent-provider", model: "parent-runtime-model", in: 2, out: 4 },
        { provider: "child-provider", model: "mock", in: 3, out: 4 },
      ],
    });
  });

  test("preserves parent and partial child usage when the subagent fails fatally", async () => {
    const fatalTool = {
      name: "fail",
      description: "Fail fatally",
      schema: z.object({}),
      async execute() {
        throw new AxleToolFatalError("child failed", { toolName: "fail" });
      },
    };
    const tool = createAgentTool({
      name: "delegate",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () =>
        new Agent({
          name: "researcher",
          provider: createFatalChildProvider(),
          model: "child-configured-model",
          tools: [fatalTool],
        }),
    });
    const parent = new Agent({
      provider: createParentProvider(),
      model: "parent-configured-model",
      tools: [tool],
    });

    let thrown: unknown;
    try {
      await parent.send("delegate this").final;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxleToolFatalError);
    const fatal = thrown as AxleToolFatalError;
    expect(fatal.usage).toEqual({
      in: 4,
      out: 6,
      breakdown: [
        { provider: "parent-provider", model: "parent-runtime-model", in: 1, out: 2 },
        { provider: "fatal-child-provider", model: "fatal-child-runtime-model", in: 3, out: 4 },
      ],
    });
    expect(parent.history.turns[1]?.usage).toEqual(fatal.usage);
    // The child's conversation must not leak across the tool boundary.
    expect(fatal.toolName).toBe("delegate");
    expect(fatal.messages).toHaveLength(1);
    expect(fatal.messages?.[0]?.role).toBe("assistant");
  });

  test("preserves parent and partial child usage when the subagent is cancelled", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowTool = {
      name: "wait",
      description: "Wait until released",
      schema: z.object({}),
      async execute() {
        markStarted();
        await gate;
        return "done";
      },
    };
    const tool = createAgentTool({
      name: "delegate",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () =>
        new Agent({
          name: "researcher",
          provider: createBlockingChildProvider(),
          model: "child-configured-model",
          tools: [slowTool],
        }),
    });
    const parent = new Agent({
      provider: createParentProvider(),
      model: "parent-configured-model",
      tools: [tool],
    });

    const handle = parent.send("delegate this");
    await started;
    handle.cancel("cancelled");
    release();

    let thrown: unknown;
    try {
      await handle.final;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxleAgentAbortError);
    const abortError = thrown as AxleAgentAbortError;
    expect(abortError.usage).toEqual({
      in: 4,
      out: 6,
      breakdown: [
        { provider: "parent-provider", model: "parent-runtime-model", in: 1, out: 2 },
        {
          provider: "blocking-child-provider",
          model: "blocking-child-runtime-model",
          in: 3,
          out: 4,
        },
      ],
    });
    expect(parent.history.turns[1]?.usage).toEqual(abortError.usage);
    expect(abortError.messages).toHaveLength(1);
    expect(abortError.messages?.[0]?.role).toBe("assistant");
  });
});

function runAgentTool(
  tool: ReturnType<typeof createAgentTool>,
  parameters: Record<string, unknown>,
  observer?: ToolExecutionObserver,
) {
  const registry = new ToolRegistry({ tools: [tool] });
  return executeToolCalls(
    [
      {
        type: "tool-call",
        id: "agent-tool-call",
        name: tool.name,
        parameters,
      },
    ],
    undefined,
    new AbortController().signal,
    registry,
    undefined,
    observer,
  );
}

function createProvider(response: string, prompts: string[] = []): AIProvider {
  return {
    name: "child-provider",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(_model, params): AsyncGenerator<AnyStreamChunk, void, unknown> {
      const user = params.messages.findLast((message) => message.role === "user");
      const prompt = getMessageText(user?.content);
      if (prompt) prompts.push(prompt);

      yield {
        type: "start",
        id: "child-1",
        data: { model: "mock", timestamp: 0 },
      };
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: response } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 3, out: 4 } },
      };
    },
  };
}

function createParentProvider(): AIProvider {
  let call = 0;
  return {
    name: "parent-provider",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
      call += 1;
      yield {
        type: "start",
        id: `parent-${call}`,
        data: { model: "parent-runtime-model", timestamp: 0 },
      };
      if (call === 1) {
        yield {
          type: "tool-call-start",
          data: { index: 0, id: "delegate-1", name: "delegate" },
        };
        yield {
          type: "tool-call-complete",
          data: {
            index: 0,
            id: "delegate-1",
            name: "delegate",
            arguments: { task: "research" },
          },
        };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 2 } },
        };
        return;
      }

      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: "parent done" } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 2 } },
      };
    },
  };
}

function createErrorChildProvider(): AIProvider {
  return {
    name: "error-child-provider",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
      yield {
        type: "start",
        id: "error-child-1",
        data: { model: "error-child-runtime-model", timestamp: 0 },
      };
      yield {
        type: "error",
        data: { type: "RateLimit", message: "rate limited", usage: { in: 3, out: 4 } },
      };
    },
  };
}

function createFatalChildProvider(): AIProvider {
  return {
    name: "fatal-child-provider",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
      yield {
        type: "start",
        id: "fatal-child-1",
        data: { model: "fatal-child-runtime-model", timestamp: 0 },
      };
      yield {
        type: "tool-call-start",
        data: { index: 0, id: "fail-1", name: "fail" },
      };
      yield {
        type: "tool-call-complete",
        data: { index: 0, id: "fail-1", name: "fail", arguments: {} },
      };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 3, out: 4 } },
      };
    },
  };
}

function createBlockingChildProvider(): AIProvider {
  return {
    name: "blocking-child-provider",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
      yield {
        type: "start",
        id: "blocking-child-1",
        data: { model: "blocking-child-runtime-model", timestamp: 0 },
      };
      yield {
        type: "tool-call-start",
        data: { index: 0, id: "wait-1", name: "wait" },
      };
      yield {
        type: "tool-call-complete",
        data: { index: 0, id: "wait-1", name: "wait", arguments: {} },
      };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 3, out: 4 } },
      };
    },
  };
}

function getMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part?.type === "text")
    .map((part) => part.text)
    .join("");
}

function isTurnEventChunk(chunk: unknown, eventType: string): boolean {
  return (
    typeof chunk === "object" &&
    chunk !== null &&
    "type" in chunk &&
    chunk.type === "turn-event" &&
    "event" in chunk &&
    typeof chunk.event === "object" &&
    chunk.event !== null &&
    "type" in chunk.event &&
    chunk.event.type === eventType
  );
}
