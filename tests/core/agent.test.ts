import { describe, expect, test, vi } from "vitest";
import { Agent } from "../../src/core/Agent.js";
import { Instruct } from "../../src/core/Instruct.js";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import type { AgentMemory } from "../../src/memory/types.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";

function createMockStreamProvider(responses: string[]): AIProvider {
  let callIndex = 0;
  return {
    name: "mock-stream",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
      const text = responses[callIndex++] ?? "default";
      yield {
        type: "start",
        id: `mock-${callIndex}`,
        data: { model: "mock", timestamp: Date.now() },
      };
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 10, out: 20 } },
      };
    },
  };
}

function createToolThenTextProvider(toolNames: string[], finalText = "Recovered") {
  let callCount = 0;
  const requests: unknown[][] = [];
  const provider: AIProvider = {
    name: "mock-tool-stream",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      callCount += 1;
      requests.push([...messages]);
      yield {
        type: "start",
        id: `mock-${callCount}`,
        data: { model: "mock", timestamp: 0 },
      };

      if (callCount === 1) {
        for (const [index, name] of toolNames.entries()) {
          yield {
            type: "tool-call-start",
            data: { index, id: `tc${index + 1}`, name },
          };
          yield {
            type: "tool-call-complete",
            data: {
              index,
              id: `tc${index + 1}`,
              name,
              arguments: { input: "value" },
            },
          };
        }
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 2 } },
        };
        return;
      }

      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: finalText } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 3, out: 4 } },
      };
    },
  };

  return {
    provider,
    requests,
    get callCount() {
      return callCount;
    },
  };
}

describe("Agent", () => {
  test("send(instruct) resolves with raw text response", async () => {
    const provider = createMockStreamProvider(["Hello world"]);
    const instruct = new Instruct("Hi");
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toBe("Hello world");
    expect(result.turn?.status).toBe("complete");
    expect(result.usage).toEqual({ in: 10, out: 20 });
  });

  test("send(instruct.withInputs()) substitutes into prompt", async () => {
    const provider = createMockStreamProvider(["Greeting sent"]);
    const instruct = new Instruct("Say hello to {{name}}").withInputs({ name: "Alice" });
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toBe("Greeting sent");
  });

  test("send(instruct) with schema parses response via tags", async () => {
    const provider = createMockStreamProvider(["<answer>42</answer>"]);
    const { z } = await import("zod");
    const instruct = new Instruct("What is the answer?", {
      answer: z.number(),
    });
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toEqual({ answer: 42 });
  });

  test("send() follow-on accumulates history", async () => {
    const provider = createMockStreamProvider(["Response 1", "Response 2"]);
    const instruct = new Instruct("Initial message");
    const agent = new Agent({ provider, model: "mock" });

    await agent.send(instruct).final;
    await agent.send("Follow up").final;

    // 2 user + 2 agent = 4 turns
    expect(agent.history.turns).toHaveLength(4);
    expect(agent.history.turns[0].owner).toBe("user");
    expect(agent.history.turns[1].owner).toBe("agent");
    expect(agent.history.turns[2].owner).toBe("user");
    expect(agent.history.turns[3].owner).toBe("agent");
  });

  test("AgentResult.usage has correct token stats", async () => {
    const provider = createMockStreamProvider(["test"]);
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send("Hi").final;

    expect(result.usage.in).toBe(10);
    expect(result.usage.out).toBe(20);
  });

  describe("abort signals", () => {
    test("send(string, { signal }) passes an abort signal to the provider", async () => {
      let providerSignal: AbortSignal | undefined;
      const provider: AIProvider = {
        name: "mock-stream",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(_model, { signal }): AsyncGenerator<AnyStreamChunk, void> {
          providerSignal = signal;
          yield {
            type: "start",
            id: "mock-1",
            data: { model: "mock", timestamp: Date.now() },
          };
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "ok" } };
          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        },
      };

      const controller = new AbortController();
      const agent = new Agent({ provider, model: "mock" });

      await agent.send("Hi", { signal: controller.signal }).final;

      expect(providerSignal).toBeInstanceOf(AbortSignal);
      expect(providerSignal?.aborted).toBe(false);
    });

    test("send(instruct, { signal }) supports shared send options", async () => {
      let providerSignal: AbortSignal | undefined;
      let requestMessages: Array<{ role: string }> = [];
      const provider: AIProvider = {
        name: "mock-stream",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(
          _model,
          { messages, signal },
        ): AsyncGenerator<AnyStreamChunk, void> {
          providerSignal = signal;
          requestMessages = messages.map((message) => ({ role: message.role }));
          yield {
            type: "start",
            id: "mock-1",
            data: { model: "mock", timestamp: Date.now() },
          };
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "ok" } };
          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        },
      };

      const controller = new AbortController();
      const instruct = new Instruct("Say hi");
      const agent = new Agent({ provider, model: "mock" });

      await agent.send(instruct, { signal: controller.signal }).final;

      expect(providerSignal).toBeInstanceOf(AbortSignal);
      expect(requestMessages[0]?.role).toBe("user");
    });

    test("send(instruct.withInputs(), { signal }) aborts the in-flight stream", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let observedSignal: AbortSignal | undefined;

      const provider: AIProvider = {
        name: "mock-stream",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(
          _model,
          { signal },
        ): AsyncGenerator<AnyStreamChunk, void, unknown> {
          observedSignal = signal;
          yield {
            type: "start",
            id: "mock-1",
            data: { model: "mock", timestamp: Date.now() },
          };
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "Hello" } };
          await gate;
          if (signal?.aborted) return;
          yield { type: "text-delta", data: { index: 0, text: " world" } };
          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        },
      };

      const controller = new AbortController();
      const instruct = new Instruct("Hello {{name}}").withInputs({ name: "Alice" });
      const agent = new Agent({ provider, model: "mock" });

      const handle = agent.send(instruct, {
        signal: controller.signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const reason = { type: "user-cancel" };
      controller.abort(reason);
      release();

      let error: unknown;
      try {
        await handle.final;
      } catch (e) {
        error = e;
      }

      expect(observedSignal?.aborted).toBe(true);
      expect(error).toBeInstanceOf(AxleAgentAbortError);
      expect((error as AxleAbortError).name).toBe("AbortError");
      expect((error as AxleAbortError).reason).toBe(reason);
      expect((error as AxleAgentAbortError).turn?.status).toBe("cancelled");
      expect((error as AxleAbortError).partial?.content).toEqual([{ type: "text", text: "Hello" }]);
    });

    test("queued cancellation does not append a phantom user message to history", async () => {
      let releaseFirst!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let callCount = 0;

      const provider: AIProvider = {
        name: "mock-stream",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
          callCount += 1;
          const isFirstCall = callCount === 1;

          yield {
            type: "start",
            id: `mock-${callCount}`,
            data: { model: "mock", timestamp: Date.now() },
          };
          yield { type: "text-start", data: { index: 0 } };
          yield {
            type: "text-delta",
            data: { index: 0, text: isFirstCall ? "First" : "Second" },
          };

          if (isFirstCall) {
            await firstGate;
          }

          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        },
      };

      const agent = new Agent({ provider, model: "mock" });

      const first = agent.send("first");
      const second = agent.send("second");
      const reason = "queued-cancel";
      second.cancel(reason);
      releaseFirst();

      const firstResult = await first.final;
      let secondError: unknown;
      try {
        await second.final;
      } catch (e) {
        secondError = e;
      }

      expect(firstResult.response).toBe("First");
      expect(secondError).toBeInstanceOf(AxleAgentAbortError);
      expect((secondError as AxleAbortError).name).toBe("AbortError");
      expect((secondError as AxleAbortError).reason).toBe(reason);
      expect((secondError as AxleAgentAbortError).turn).toBeUndefined();
      expect(callCount).toBe(1);
      expect(agent.history.turns).toHaveLength(2);
      expect(agent.history.log).toHaveLength(2);
      expect(agent.history.log[0]).toMatchObject({ role: "user" });
      expect(agent.history.log[1]).toMatchObject({ role: "assistant" });
    });

    test("cancel during tool execution preserves assistant history and cancelled turn state", async () => {
      const { z } = await import("zod");
      let releaseTool!: () => void;
      const toolGate = new Promise<void>((resolve) => {
        releaseTool = resolve;
      });
      let markToolStarted!: () => void;
      const toolStarted = new Promise<void>((resolve) => {
        markToolStarted = resolve;
      });
      let callCount = 0;

      const provider: AIProvider = {
        name: "mock-stream",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
          callCount += 1;
          yield {
            type: "start",
            id: `mock-${callCount}`,
            data: { model: "mock", timestamp: Date.now() },
          };
          yield {
            type: "tool-call-start",
            data: { index: 0, id: "call_1", name: "search" },
          };
          yield {
            type: "tool-call-complete",
            data: { index: 0, id: "call_1", name: "search", arguments: { q: "test" } },
          };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
          };
        },
      };

      const slowTool = {
        name: "search",
        description: "Search",
        schema: z.object({ q: z.string() }),
        async execute() {
          markToolStarted();
          await toolGate;
          return "results";
        },
      };

      const agent = new Agent({ provider, model: "mock", tools: [slowTool] });
      const handle = agent.send("search for test");

      await toolStarted;
      const reason = { type: "tool-exec-cancel" };
      handle.cancel(reason);
      releaseTool();

      let error: unknown;
      try {
        await handle.final;
      } catch (e) {
        error = e;
      }

      expect(callCount).toBe(1);
      expect(error).toBeInstanceOf(AxleAgentAbortError);
      expect((error as AxleAbortError).reason).toEqual(reason);
      expect((error as AxleAbortError).messages).toHaveLength(1);
      expect((error as AxleAbortError).messages![0].role).toBe("assistant");
      expect((error as AxleAgentAbortError).turn?.status).toBe("cancelled");
      expect((error as AxleAgentAbortError).turn?.usage).toEqual({ in: 1, out: 1 });
      expect(agent.history.log).toHaveLength(2);
      expect(agent.history.log[0]).toMatchObject({ role: "user" });
      expect(agent.history.log[1]).toMatchObject({ role: "assistant" });
      expect(agent.history.turns[1]?.status).toBe("cancelled");
    });
  });

  test("streaming callbacks fire during send", async () => {
    const provider = createMockStreamProvider(["streamed text"]);
    const agent = new Agent({ provider, model: "mock" });

    const updates: string[] = [];
    agent.on((event) => {
      if (event.type === "text:delta") {
        updates.push(event.delta);
      }
    });

    await agent.send("Hi").final;

    expect(updates).toContain("streamed text");
  });

  test("AgentResult.turn contains the completed agent turn", async () => {
    const provider = createMockStreamProvider(["First", "Second"]);
    const instruct = new Instruct("msg1");
    const agent = new Agent({ provider, model: "mock" });

    await agent.send(instruct).final;
    const result2 = await agent.send("msg2").final;

    expect(result2.turn).toBeDefined();
    expect(result2.turn!.owner).toBe("agent");
    const textPart = result2.turn!.parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
    if (textPart && textPart.type === "text") {
      expect(textPart.text).toBe("Second");
    }
  });

  test("system message is set on Agent", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({ provider, model: "mock", system: "You are helpful" });

    await agent.send("Hi").final;

    expect(agent.system).toBe("You are helpful");
  });

  test("resolveMcpTools passes mcp.name as prefix", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({ provider, model: "mock" });

    const mockListTools = vi.fn().mockResolvedValue([
      {
        name: "prefixed_tool",
        description: "A tool",
        schema: {},
        execute: vi.fn(),
      },
    ]);

    const mockMcp = {
      name: "myprefix",
      listTools: mockListTools,
      connected: true,
    };

    agent.addMcp(mockMcp as any);
    await agent.send("Hi").final;

    expect(mockListTools).toHaveBeenCalledWith(expect.objectContaining({ prefix: "myprefix" }));
  });

  test("resolveMcpTools passes undefined prefix when mcp.name is undefined", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({ provider, model: "mock" });

    const mockListTools = vi.fn().mockResolvedValue([]);

    const mockMcp = {
      name: undefined,
      listTools: mockListTools,
      connected: true,
    };

    agent.addMcp(mockMcp as any);
    await agent.send("Hi").final;

    expect(mockListTools).toHaveBeenCalledWith(expect.objectContaining({ prefix: undefined }));
  });

  test("tools on Agent are used for tool calls", async () => {
    const { z } = await import("zod");
    const provider = createMockStreamProvider(["ok"]);

    const mockTool = {
      name: "test-tool",
      description: "A test tool",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue("result"),
    };

    const agent = new Agent({ provider, model: "mock", tools: [mockTool] });
    await agent.send("Hi").final;

    expect(agent.hasTools()).toBe(true);
  });

  test("tool AxleToolFatalError rejects send without feeding the error back to the model", async () => {
    const { z } = await import("zod");
    const fatalCause = new Error("sandbox gone");
    const toolStream = createToolThenTextProvider(["exec", "next_tool"]);
    const events: { type: string }[] = [];

    const execTool = {
      name: "exec",
      description: "Run a command",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockRejectedValue(
        new AxleToolFatalError("Sandbox terminated", {
          toolName: "exec",
          cause: fatalCause,
        }),
      ),
    };

    const agent = new Agent({ provider: toolStream.provider, model: "mock", tools: [execTool] });
    agent.on((event) => events.push(event));

    let thrown: unknown;
    try {
      await agent.send("run it").final;
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AxleToolFatalError);
    const fatal = thrown as AxleToolFatalError;
    expect(fatal.message).toBe("Sandbox terminated");
    expect(fatal.toolName).toBe("exec");
    expect(fatal.cause).toBe(fatalCause);
    expect(fatal.usage).toEqual({ in: 1, out: 2 });
    expect(fatal.messages).toHaveLength(1);
    expect(fatal.partial?.role).toBe("assistant");
    expect(execTool.execute).toHaveBeenCalledTimes(1);
    expect(toolStream.callCount).toBe(1);
    expect(events.filter((event) => event.type === "action:running")).toHaveLength(1);
  });

  test("regular tool Error remains model-visible and can be retried", async () => {
    const { z } = await import("zod");
    const toolStream = createToolThenTextProvider(["exec"], "Recovered");

    const execTool = {
      name: "exec",
      description: "Run a command",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockRejectedValue(new Error("temporary failure")),
    };

    const agent = new Agent({ provider: toolStream.provider, model: "mock", tools: [execTool] });

    const result = await agent.send("run it").final;

    expect(result.response).toBe("Recovered");
    expect(execTool.execute).toHaveBeenCalledTimes(1);
    expect(toolStream.callCount).toBe(2);
    expect(JSON.stringify(toolStream.requests[1])).toContain("temporary failure");
  });

  test("a tool can mutate ctx.registry mid-send", async () => {
    const { z } = await import("zod");

    let callIndex = 0;
    const provider: AIProvider = {
      name: "mock",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
        callIndex++;
        yield {
          type: "start",
          id: `mock-${callIndex}`,
          data: { model: "mock", timestamp: 0 },
        };
        if (callIndex === 1) {
          yield {
            type: "tool-call-start",
            data: { index: 0, id: "tc1", name: "load_more" },
          };
          yield {
            type: "tool-call-complete",
            data: { index: 0, id: "tc1", name: "load_more", arguments: {} },
          };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
          };
        } else {
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "done" } };
          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        }
      },
    };

    const lateTool = {
      name: "late-tool",
      description: "added during a tool call",
      schema: z.object({}),
      async execute() {
        return "ok";
      },
    };

    const loadTool = {
      name: "load_more",
      description: "loads more tools",
      schema: z.object({}),
      execute: vi.fn(async (_input: any, ctx: any) => {
        ctx.registry.add(lateTool);
        return "loaded";
      }),
    };

    const agent = new Agent({ provider, model: "mock", tools: [loadTool] });
    await agent.send("hi").final;

    expect(loadTool.execute).toHaveBeenCalled();
    expect(agent.registry.get("late-tool")).toBeDefined();
  });

  describe("memory integration", () => {
    function createMockMemory(overrides?: Partial<AgentMemory>): AgentMemory {
      return {
        recall: vi.fn().mockResolvedValue({}),
        record: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    test("recall() augments system prompt before execution", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory({
        recall: vi.fn().mockResolvedValue({
          systemSuffix: "## Learned Instructions\n\n1. Be concise",
        }),
      });

      const agent = new Agent({
        provider,
        model: "mock",
        name: "test-agent",
        system: "You are helpful.",
        memory,
      });

      await agent.send("Hi").final;

      expect(memory.recall).toHaveBeenCalledOnce();
      expect(agent.system).toBe("You are helpful.");
    });

    test("recall() works when agent has no system prompt", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory({
        recall: vi.fn().mockResolvedValue({
          systemSuffix: "## Learned Instructions\n\n1. Be concise",
        }),
      });

      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory });

      await agent.send("Hi").final;

      expect(memory.recall).toHaveBeenCalledOnce();
      expect(agent.system).toBeUndefined();
    });

    test("recall() sees the pending user message before history is committed", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory();

      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory });
      await agent.send("Hi").final;

      expect(memory.recall).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
        }),
      );
    });

    test("name and scope are passed through to memory context", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory();

      const agent = new Agent({
        provider,
        model: "mock",
        name: "test-agent",
        scope: { user: "john" },
        memory,
      });

      await agent.send("Hi").final;

      expect(memory.recall).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-agent",
          scope: { user: "john" },
        }),
      );
      expect(memory.record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "test-agent",
          scope: { user: "john" },
        }),
      );
    });

    test("record() receives newMessages from the turn", async () => {
      const provider = createMockStreamProvider(["response text"]);
      const memory = createMockMemory();

      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory });
      await agent.send("Hi").final;

      expect(memory.record).toHaveBeenCalledWith(
        expect.objectContaining({
          newMessages: expect.arrayContaining([expect.objectContaining({ role: "assistant" })]),
        }),
      );
    });

    test("memory tools are registered on agent", async () => {
      const { z } = await import("zod");
      const mockTool = {
        name: "add_instruction",
        description: "Add instruction",
        schema: z.object({ instruction: z.string() }),
        execute: vi.fn().mockResolvedValue("ok"),
      };

      const memory = createMockMemory({
        tools: () => [mockTool],
      });

      const provider = createMockStreamProvider(["ok"]);
      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory });

      expect(agent.registry.get("add_instruction")).toBeDefined();
      expect(agent.hasTools()).toBe(true);
    });

    test("record() failure does not prevent result from being returned", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory({
        record: vi.fn().mockRejectedValue(new Error("disk full")),
      });

      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory });
      const result = await agent.send("Hi").final;

      expect(result.response).toBe("ok");
    });

    test("record() failure is logged via tracer", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory({
        record: vi.fn().mockRejectedValue(new Error("disk full")),
      });

      const tracer = {
        warn: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        startSpan: vi.fn().mockReturnValue(null),
        end: vi.fn(),
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        setResult: vi.fn(),
      };

      const agent = new Agent({ provider, model: "mock", name: "test-agent", memory, tracer });
      await agent.send("Hi").final;

      expect(tracer.warn).toHaveBeenCalledWith(
        "memory record failed",
        expect.objectContaining({ error: "disk full" }),
      );
    });

    test("record() is not called on error", async () => {
      const errorProvider: AIProvider = {
        name: "mock-error",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
          yield {
            type: "error",
            data: { type: "server_error", message: "Something broke" },
          };
        },
      };

      const memory = createMockMemory();
      const agent = new Agent({
        provider: errorProvider,
        model: "mock",
        name: "test-agent",
        memory,
      });

      await expect(agent.send("Hi").final).rejects.toThrow();
      expect(memory.record).not.toHaveBeenCalled();
    });

    test("throws if memory is provided without name", () => {
      const provider = createMockStreamProvider(["ok"]);
      const memory = createMockMemory();

      expect(() => new Agent({ provider, model: "mock", memory })).toThrow(/requires a 'name'/);
    });
  });

  describe("agent events", () => {
    test("on() receives turn:user event when send(string) is called", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const agent = new Agent({ provider, model: "mock" });

      const events: { type: string }[] = [];
      agent.on((event) => events.push(event));

      await agent.send("Hello").final;

      const userEvents = events.filter((e) => e.type === "turn:user");
      expect(userEvents).toHaveLength(1);
      const userEvent = userEvents[0] as {
        type: "turn:user";
        turn: { id: string; owner: string; parts: unknown[] };
      };
      expect(userEvent.turn.owner).toBe("user");
      expect(userEvent.turn.id).toBeDefined();
      expect(typeof userEvent.turn.id).toBe("string");
    });

    test("on() receives turn:user event when send(instruct) is called", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const agent = new Agent({ provider, model: "mock" });
      const instruct = new Instruct("Tell me about {{topic}}").withInputs({ topic: "cats" });

      const events: { type: string }[] = [];
      agent.on((event) => events.push(event));

      await agent.send(instruct).final;

      const userEvents = events.filter((e) => e.type === "turn:user");
      expect(userEvents).toHaveLength(1);
      const userEvent = userEvents[0] as {
        type: "turn:user";
        turn: { parts: Array<{ type: string; text?: string }> };
      };
      const textPart = userEvent.turn.parts.find((p: { type: string }) => p.type === "text") as
        | { text: string }
        | undefined;
      expect(textPart?.text).toContain("cats");
    });

    test("turn:user arrives before turn:start", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const agent = new Agent({ provider, model: "mock" });

      const eventTypes: string[] = [];
      agent.on((event) => eventTypes.push(event.type));

      await agent.send("Hi").final;

      const userIdx = eventTypes.indexOf("turn:user");
      const turnIdx = eventTypes.indexOf("turn:start");
      expect(userIdx).toBeGreaterThanOrEqual(0);
      expect(turnIdx).toBeGreaterThanOrEqual(0);
      expect(userIdx).toBeLessThan(turnIdx);
    });

    test("event callback receives both agent events and stream events", async () => {
      const provider = createMockStreamProvider(["streamed"]);
      const agent = new Agent({ provider, model: "mock" });

      const eventTypes = new Set<string>();
      agent.on((event) => eventTypes.add(event.type));

      await agent.send("Hi").final;

      expect(eventTypes.has("turn:user")).toBe(true);
      expect(eventTypes.has("turn:start")).toBe(true);
      expect(eventTypes.has("text:delta")).toBe(true);
      expect(eventTypes.has("turn:end")).toBe(true);
    });

    test("user turn has UUID id in history", async () => {
      const provider = createMockStreamProvider(["ok"]);
      const agent = new Agent({ provider, model: "mock" });

      await agent.send("Hi").final;

      const userTurn = agent.history.turns[0];
      expect(userTurn.owner).toBe("user");
      expect(userTurn.id).toBeDefined();
      expect(typeof userTurn.id).toBe("string");
    });

    test("ctx.emit from a tool surfaces as action:progress events", async () => {
      const { z } = await import("zod");

      let callIndex = 0;
      const provider: AIProvider = {
        name: "mock",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
          callIndex++;
          yield {
            type: "start",
            id: `mock-${callIndex}`,
            data: { model: "mock", timestamp: 0 },
          };
          if (callIndex === 1) {
            yield {
              type: "tool-call-start",
              data: { index: 0, id: "tc1", name: "noisy" },
            };
            yield {
              type: "tool-call-complete",
              data: { index: 0, id: "tc1", name: "noisy", arguments: {} },
            };
            yield {
              type: "complete",
              data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
            };
          } else {
            yield { type: "text-start", data: { index: 0 } };
            yield { type: "text-delta", data: { index: 0, text: "ok" } };
            yield { type: "text-complete", data: { index: 0 } };
            yield {
              type: "complete",
              data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
            };
          }
        },
      };

      const noisyTool = {
        name: "noisy",
        description: "emits progress",
        schema: z.object({}),
        async execute(_input: any, ctx: any) {
          ctx.emit("step 1");
          ctx.emit("step 2");
          return "done";
        },
      };

      const agent = new Agent({ provider, model: "mock", tools: [noisyTool] });
      const events: any[] = [];
      const inProgressSnapshots: any[] = [];
      agent.on((e) => {
        events.push(e);
        if (e.type === "action:progress") {
          const turn = agent.history.turns[1];
          const part = turn?.parts.find(
            (p) => p.type === "action" && (p as any).kind === "tool",
          ) as any;
          inProgressSnapshots.push(part?.detail.result);
        }
      });
      await agent.send("hi").final;

      const progress = events.filter((e) => e.type === "action:progress");
      expect(progress).toHaveLength(2);
      expect(progress[0].chunk).toBe("step 1");
      expect(progress[1].chunk).toBe("step 2");

      // During streaming, result.content accumulates as type "in-progress".
      expect(inProgressSnapshots).toEqual([
        { type: "in-progress", content: "step 1" },
        { type: "in-progress", content: "step 1step 2" },
      ]);

      // After completion, the final success result replaces the in-progress state.
      const agentTurn = agent.history.turns[1];
      const toolPart = agentTurn.parts.find(
        (p) => p.type === "action" && (p as any).kind === "tool",
      ) as any;
      expect(toolPart?.detail.result?.type).toBe("success");
      expect(toolPart?.detail.result?.content).toBe("done");
    });
  });
});
