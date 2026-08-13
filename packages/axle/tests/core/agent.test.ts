import { describe, expect, test, vi } from "vitest";
import * as z from "zod";
import { Agent, createAgentConfig } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import { InstructVariableError } from "../../src/errors/InstructVariableError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { getTextContent } from "../../src/messages/utils.js";
import type { LogEntry, SpanData } from "../../src/observability/index.js";
import { Tracer } from "../../src/observability/index.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import { createAgentTool } from "../../src/tools/agentTool.js";
import { Transcript } from "../../src/turns/transcript.js";
import type { TurnEvent } from "../../src/turns/events.js";
import type { Turn } from "../../src/turns/types.js";

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

function createEchoStreamProvider(requests: string[]): AIProvider {
  let callCount = 0;
  return {
    name: "mock-echo-stream",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      callCount += 1;
      const userMessage = messages.findLast((message) => message.role === "user");
      const text = userMessage ? getTextContent(userMessage.content) : "";
      requests.push(text);
      yield {
        type: "start",
        id: `mock-${callCount}`,
        data: { model: "mock", timestamp: 0 },
      };
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
      };
    },
  };
}

describe("Agent", () => {
  describe("automatic compaction", () => {
    test("consults the decision policy at configured turn boundaries with pre/post state", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });
      const order: string[] = [];
      const beforeMessageCounts: number[] = [];
      const afterMessageCounts: number[] = [];
      const compact = vi.fn(async () => ({ messages: [] }));

      agent.setCompaction({
        shouldCompactOnTrigger: ({ messages }, { usage, trigger }) => {
          order.push(trigger);
          if (trigger === "beforeTurn") {
            beforeMessageCounts.push(messages.length);
          } else {
            afterMessageCounts.push(messages.length);
          }
          expect(usage.total).toBeGreaterThanOrEqual(0);
          return false;
        },
        compact,
        triggers: {
          beforeTurn: true,
          afterTurn: true,
        },
      });

      await agent.send("first").final;
      await agent.send("second").final;

      expect(order).toEqual(["beforeTurn", "afterTurn", "beforeTurn", "afterTurn"]);
      expect(beforeMessageCounts).toEqual([0, 2]);
      expect(afterMessageCounts).toEqual([2, 4]);
      expect(requests).toEqual(["first", "second"]);
      expect(compact).not.toHaveBeenCalled();
    });

    test("setting compaction again replaces the previous configuration", async () => {
      const agent = new Agent({
        provider: createMockStreamProvider(["ok"]),
        model: "mock",
      });
      const first = vi.fn(() => false);
      const second = vi.fn(() => false);
      const compact = vi.fn(async () => ({ messages: [] }));

      agent.setCompaction({
        shouldCompactOnTrigger: first,
        compact,
        triggers: { beforeTurn: true },
      });
      agent.setCompaction({
        shouldCompactOnTrigger: second,
        compact,
        triggers: { beforeTurn: true },
      });
      await agent.send("hello").final;

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(compact).not.toHaveBeenCalled();
    });
  });

  describe("send and stop", () => {
    test("runs queued sends FIFO", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });

      const first = agent.send("first");
      const second = agent.send("second");
      const third = agent.send("third");

      const results = await Promise.all([first.final, second.final, third.final]);

      expect(requests).toEqual(["first", "second", "third"]);
      expect(results.map((result) => result.response)).toEqual(["first", "second", "third"]);
      expect(
        agent.messages
          .filter((message) => message.role === "user")
          .map((message) => getTextContent(message.content)),
      ).toEqual(["first", "second", "third"]);
    });

    test("stop() finishes the complete tool batch, settles the handle, and the queued send continues", async () => {
      const toolStream = createToolThenTextProvider(["first_tool", "second_tool"], "taken over");
      let stopResult: boolean | undefined;
      const firstTool = {
        name: "first_tool",
        description: "First tool",
        schema: z.object({ input: z.string() }),
        execute: vi.fn().mockImplementation(async () => {
          stopResult = agent.stop();
          return "first result";
        }),
      };
      const secondTool = {
        name: "second_tool",
        description: "Second tool",
        schema: z.object({ input: z.string() }),
        execute: vi.fn().mockResolvedValue("second result"),
      };
      const agent = new Agent({
        provider: toolStream.provider,
        model: "mock",
        tools: [firstTool, secondTool],
      });

      const first = agent.send("run both tools");
      const next = agent.send("take over");
      const [firstResult, nextResult] = await Promise.all([first.final, next.final]);

      expect(stopResult).toBe(true);
      expect(firstResult.ok).toBe(true);
      expect(firstResult.turn?.status).toBe("complete");
      expect(nextResult.response).toBe("taken over");
      expect(firstTool.execute).toHaveBeenCalledTimes(1);
      expect(secondTool.execute).toHaveBeenCalledTimes(1);
      expect(toolStream.callCount).toBe(2);
      expect(toolStream.requests[1]?.map((message: any) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "user",
      ]);
      expect(agent.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "user",
        "assistant",
      ]);
    });

    test("cancelling a queued send removes it without appending a user turn", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });

      const first = agent.send("first");
      const withdrawn = agent.send("withdrawn");
      const third = agent.send("third");
      const reason = "withdraw-send";
      const withdrawnFinal = withdrawn.final.catch((error) => error);
      withdrawn.cancel(reason);

      await Promise.all([first.final, third.final]);
      const error = await withdrawnFinal;

      expect(error).toBeInstanceOf(AxleAgentAbortError);
      expect((error as AxleAbortError).reason).toBe(reason);
      expect((error as AxleAgentAbortError).turn).toBeUndefined();
      expect(requests).toEqual(["first", "third"]);
      expect(
        agent.messages
          .filter((message) => message.role === "user")
          .map((message) => getTextContent(message.content)),
      ).toEqual(["first", "third"]);
    });

    test("send with an already-aborted signal rejects without committing a user turn", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });
      const events: unknown[] = [];
      agent.on((event) => events.push(event));

      await expect(
        agent.send("never sent", { signal: AbortSignal.abort("stop") }).final,
      ).rejects.toMatchObject({ name: "AbortError", reason: "stop", turn: undefined });

      expect(agent.messages).toEqual([]);
      expect(events).toEqual([]);
      expect(requests).toEqual([]);
    });

    test("a setup failure rejects without committing and a retry does not duplicate the user turn", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });
      const listTools = vi
        .fn()
        .mockRejectedValueOnce(new Error("mcp unreachable"))
        .mockResolvedValue([]);
      agent.addMcp({ name: "flaky", listTools, connected: true } as any);

      await expect(agent.send("hello").final).rejects.toThrow("mcp unreachable");
      expect(agent.messages).toEqual([]);

      await expect(agent.send("hello").final).resolves.toMatchObject({
        ok: true,
        response: "hello",
      });
      expect(requests).toEqual(["hello"]);
      expect(agent.messages.filter((message) => message.role === "user")).toHaveLength(1);
    });

    test("stop() + clear() + send() interjects the new message ahead of queued work", async () => {
      const toolStream = createToolThenTextProvider(["first_tool"], "interjected");
      let cleared: number | undefined;
      const firstTool = {
        name: "first_tool",
        description: "First tool",
        schema: z.object({ input: z.string() }),
        execute: vi.fn().mockImplementation(async () => {
          agent.stop();
          cleared = agent.clear();
          agent.send("urgent");
          return "first result";
        }),
      };
      const agent = new Agent({
        provider: toolStream.provider,
        model: "mock",
        tools: [firstTool],
      });

      const first = agent.send("run the tool");
      const stale = agent.send("stale");
      const staleFinal = stale.final.catch((error) => error);

      const firstResult = await first.final;
      const staleError = await staleFinal;
      await vi.waitFor(() => expect(toolStream.callCount).toBe(2));

      expect(cleared).toBe(1);
      expect(firstResult.ok).toBe(true);
      expect(firstResult.turn?.status).toBe("complete");
      expect(staleError).toBeInstanceOf(AxleAgentAbortError);
      expect((staleError as AxleAgentAbortError).turn).toBeUndefined();
      expect(
        agent.messages
          .filter((message) => message.role === "user")
          .map((message) => getTextContent(message.content)),
      ).toEqual(["run the tool", "urgent"]);
    });

    test("clear() returns 0 when nothing is queued", async () => {
      const agent = new Agent({
        provider: createEchoStreamProvider([]),
        model: "mock",
      });

      expect(agent.clear()).toBe(0);

      await agent.send("hello").final;
      expect(agent.clear()).toBe(0);
    });

    test("stop() returns false when no turn is active", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });

      expect(agent.stop()).toBe(false);

      await agent.send("hello").final;
      expect(agent.stop()).toBe(false);
    });

    test("stop() during a turn without tool calls completes normally", async () => {
      const requests: string[] = [];
      const agent = new Agent({
        provider: createEchoStreamProvider(requests),
        model: "mock",
      });
      let stopResult: boolean | undefined;
      agent.on((event) => {
        if (event.type === "turn:start") {
          stopResult = agent.stop();
        }
      });

      await expect(agent.send("hello").final).resolves.toMatchObject({
        ok: true,
        response: "hello",
      });
      expect(stopResult).toBe(true);

      await expect(agent.send("again").final).resolves.toMatchObject({
        ok: true,
        response: "again",
      });
      expect(requests).toEqual(["hello", "again"]);
    });
  });

  test("threads a span hierarchy through a send (agent.send → stream → turn)", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const starts: SpanData[] = [];
    const ends: SpanData[] = [];
    const tracer = new Tracer();
    tracer.addWriter({
      onSpanStart: (span) => starts.push({ ...span }),
      onSpanEnd: (span) => ends.push({ ...span }),
    });
    const agent = new Agent({
      provider,
      model: "mock",
      sessionId: "session-1",
      observability: { trace: tracer },
    });

    await agent.send("Hi").final;

    expect(starts.map((span) => span.name)).toEqual(["agent.send", "stream", "step-1"]);
    expect(ends.map((span) => span.name)).toEqual(["step-1", "stream", "agent.send"]);

    const [agentSend, streamSpan, turnSpan] = starts;
    expect(agentSend.attributes).toMatchObject({ sessionId: "session-1" });
    expect(agentSend.parentSpanId).toBeUndefined();
    expect(streamSpan.parentSpanId).toBe(agentSend.spanId);
    expect(turnSpan.parentSpanId).toBe(streamSpan.spanId);
    expect(ends.every((span) => span.status === "ok")).toBe(true);
  });

  test("nests a send under a provided span (trace: Span)", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const starts: SpanData[] = [];
    const tracer = new Tracer();
    tracer.addWriter({
      onSpanStart: (span) => starts.push({ ...span }),
      onSpanEnd: () => {},
    });
    const job = tracer.startSpan("job", { type: "workflow" });

    const agent = new Agent({
      provider,
      model: "mock",
      observability: { trace: job },
    });
    await agent.send("Hi").final;
    job.end();

    const jobSpan = starts.find((span) => span.name === "job");
    const agentSend = starts.find((span) => span.name === "agent.send");
    expect(agentSend?.parentSpanId).toBe(jobSpan?.spanId);
    expect(agentSend?.traceId).toBe(jobSpan?.traceId);
  });

  test("projects the agent.send completion with status and tokens", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const entries: LogEntry[] = [];
    const agent = new Agent({
      provider,
      model: "mock",
      observability: { log: (entry) => entries.push(entry) },
    });

    await agent.send("Hi").final;

    const send = entries.find((entry) => entry.message === "agent.send");
    expect(send).toMatchObject({
      level: "info",
      fields: { type: "workflow", status: "ok", inputTokens: 10, outputTokens: 20 },
    });
    expect(typeof send?.fields?.durationMs).toBe("number");
  });

  test("send metadata is stored on user messages and copied to user turns", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({ provider, model: "mock" });
    const transcript = new Transcript();
    const events: { type: string; turn?: { metadata?: Record<string, unknown> } }[] = [];
    agent.on((event) => {
      transcript.apply(event as TurnEvent);
      events.push(event);
    });

    await agent.send("Render this specially", { metadata: { source: "system-editor" } }).final;

    expect(agent.messages[0]).toMatchObject({
      role: "user",
      metadata: { source: "system-editor" },
    });
    expect(transcript.turns[0]).toMatchObject({
      owner: "user",
      metadata: { source: "system-editor" },
    });
    expect(events.find((event) => event.type === "turn:user")?.turn?.metadata).toEqual({
      source: "system-editor",
    });
    const session = await agent.snapshot();
    expect(session.messages[0]).toMatchObject({
      metadata: { source: "system-editor" },
    });
  });

  test("instruct metadata is copied to user messages and turns", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({ provider, model: "mock" });
    const transcript = new Transcript();
    agent.on((event) => transcript.apply(event));
    const instruct = new Instruct({
      prompt: "Review this prompt",
      metadata: { surface: "prompt-review" },
    });

    await agent.send(instruct).final;

    expect(agent.messages[0]).toMatchObject({
      role: "user",
      metadata: { surface: "prompt-review" },
    });
    expect(transcript.turns[0]).toMatchObject({
      owner: "user",
      metadata: { surface: "prompt-review" },
    });
  });

  test("snapshot and restore preserve model and render state", async () => {
    const requests: unknown[][] = [];
    const provider: AIProvider = {
      name: "snapshot-provider",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
        requests.push([...messages]);
        yield {
          type: "start",
          id: `mock-${requests.length}`,
          data: { model: "mock", timestamp: Date.now() },
        };
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: `response-${requests.length}` } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 2 } },
        };
      },
    };

    const agent = new Agent({ provider, model: "mock" });
    const transcript = new Transcript();
    agent.on((event) => transcript.apply(event));
    await agent.send("one").final;

    const session = await agent.snapshot();
    expect(session).toEqual({
      sessionId: agent.sessionId,
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ role: "assistant" }),
      ],
    });

    const restored = new Agent({ provider, model: "mock" }, session);
    const restoredTranscript = new Transcript(transcript.state);
    restored.on((event) => restoredTranscript.apply(event));

    expect(restored.messages).toEqual(session.messages);
    expect(restored.sessionId).toBe(session.sessionId);
    expect(restoredTranscript.turns).toMatchObject([
      { owner: "user" },
      { owner: "agent", status: "complete" },
    ]);

    await restored.send("two").final;

    expect(requests[1]).toHaveLength(3);
    expect(requests[1]).toMatchObject([{ role: "user" }, { role: "assistant" }, { role: "user" }]);
    expect(restoredTranscript.turns).toHaveLength(4);
  });

  test("constructor ignores unknown keys in sessions stored by older versions", async () => {
    const agent = new Agent({ provider: createMockStreamProvider(["ok"]), model: "mock" }, {
      version: 1,
      sessionId: "session-1",
      messages: [{ role: "user", content: "hello" }],
      archive: [{ role: "user", content: "hello" }],
      compactions: [],
      turns: [{ id: "t1", owner: "user", parts: [], status: "complete" }],
      sessionAnnotations: [],
    } as any);

    expect(agent.sessionId).toBe("session-1");
    expect(agent.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(await agent.snapshot()).toEqual({
      sessionId: "session-1",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  test("constructor restores continuation state from an agent session", async () => {
    const requests: unknown[][] = [];
    const provider: AIProvider = {
      name: "restore-provider",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
        requests.push([...messages]);
        yield {
          type: "start",
          id: `mock-${requests.length}`,
          data: { model: "mock", timestamp: Date.now() },
        };
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: `response-${requests.length}` } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 2 } },
        };
      },
    };
    const original = new Agent({ provider, model: "mock" });
    await original.send("one").final;

    const saved = {
      definition: {
        version: 1,
        name: "restored-agent",
        provider: { type: "mock" },
        model: "mock",
        system: "You are restored.",
      },
      session: await original.snapshot(),
    } as const;

    const config = await createAgentConfig(saved.definition, (definition) => {
      expect(definition.provider.type).toBe("mock");
      return { provider };
    });
    const restored = new Agent({ ...config, sessionId: "runtime-session" }, saved.session);

    expect(restored.sessionId).toBe(saved.session.sessionId);
    expect(restored.messages).toEqual(saved.session.messages);

    await restored.send("two").final;

    expect(requests[1]).toMatchObject([{ role: "user" }, { role: "assistant" }, { role: "user" }]);
  });

  test("context() estimates committed history as a synchronous snapshot", async () => {
    const provider = createMockStreamProvider(["Hello world"]);
    const agent = new Agent({ provider, model: "mock", system: "You are helpful." });

    await agent.send("Hi").final;

    const context = agent.context();

    expect(context.system).toBeGreaterThan(0);
    expect(context.messages).toBeGreaterThan(0);
    expect(context.tools).toBe(0);
    expect(context.mcpTools).toBe(0);
    expect(context.providerTools).toBe(0);
    expect(context.total).toBe(
      context.system + context.tools + context.mcpTools + context.providerTools + context.messages,
    );
  });

  test("context() splits local tools and MCP tools", () => {
    const provider = createMockStreamProvider(["ok"]);
    const localTool = {
      name: "local",
      description: "Local tool",
      schema: z.object({ q: z.string() }),
      async execute() {
        return "local";
      },
    };
    const mcpTool = {
      name: "mcp_search",
      description: "MCP search",
      schema: z.object({ q: z.string() }),
      async execute() {
        return "mcp";
      },
    };
    const agent = new Agent({ provider, model: "mock", tools: [localTool] });
    agent.registry.addMcp(mcpTool);

    const context = agent.context();

    expect(context.tools).toBeGreaterThan(0);
    expect(context.mcpTools).toBeGreaterThan(0);
    expect(context.providerTools).toBe(0);
    expect(context.messages).toBe(0);
    expect(context.total).toBe(
      context.system + context.tools + context.mcpTools + context.providerTools + context.messages,
    );
  });

  test("context() splits provider tools", () => {
    const provider = createMockStreamProvider(["ok"]);
    const agent = new Agent({
      provider,
      model: "mock",
      providerTools: [{ type: "provider", name: "web_search" }],
    });

    const context = agent.context();

    expect(context.tools).toBe(0);
    expect(context.mcpTools).toBe(0);
    expect(context.providerTools).toBeGreaterThan(0);
    expect(context.total).toBe(
      context.system + context.tools + context.mcpTools + context.providerTools + context.messages,
    );
  });

  test("send(instruct) resolves with raw text response", async () => {
    const provider = createMockStreamProvider(["Hello world"]);
    const instruct = new Instruct({ prompt: "Hi" });
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toBe("Hello world");
    expect(result.turn?.status).toBe("complete");
    expect(result.usage).toEqual({
      in: 10,
      out: 20,
      breakdown: [{ provider: "mock-stream", model: "mock", in: 10, out: 20 }],
    });
  });

  test("send(instruct.withInputs()) substitutes into prompt", async () => {
    const provider = createMockStreamProvider(["Greeting sent"]);
    const instruct = new Instruct({ prompt: "Say hello to {{name}}" }).withInputs({
      name: "Alice",
    });
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toBe("Greeting sent");
  });

  test("invalid instruct throws before scheduling a turn", () => {
    const provider = createMockStreamProvider(["unreachable"]);
    const instruct = new Instruct({ prompt: "Say hello to {{name}}" });
    const agent = new Agent({ provider, model: "mock" });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event));

    expect(() => agent.send(instruct)).toThrow(InstructVariableError);
    expect(agent.messages).toEqual([]);
    expect(events).toEqual([]);
  });

  test("send(instruct) with schema parses JSON response", async () => {
    const provider = createMockStreamProvider(['{"answer":42}']);
    const { z } = await import("zod");
    const instruct = new Instruct({
      prompt: "What is the answer?",
      schema: z.object({
        answer: z.number(),
      }),
    });
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send(instruct).final;

    expect(result.response).toEqual({ answer: 42 });
  });

  test("send() follow-on accumulates history", async () => {
    const provider = createMockStreamProvider(["Response 1", "Response 2"]);
    const instruct = new Instruct({ prompt: "Initial message" });
    const agent = new Agent({ provider, model: "mock" });
    const transcript = new Transcript();
    agent.on((event) => transcript.apply(event));

    await agent.send(instruct).final;
    await agent.send("Follow up").final;

    // 2 user + 2 agent = 4 turns
    expect(transcript.turns).toHaveLength(4);
    expect(transcript.turns.map((entry) => (entry as Turn).owner)).toEqual([
      "user",
      "agent",
      "user",
      "agent",
    ]);
  });

  test("AgentResult.usage has correct token stats", async () => {
    const provider = createMockStreamProvider(["test"]);
    const agent = new Agent({ provider, model: "mock" });

    const result = await agent.send("Hi").final;

    expect(result.usage.in).toBe(10);
    expect(result.usage.out).toBe(20);
  });

  test("send() merges per-call request options over agent defaults", async () => {
    let observedRequest: unknown;
    const provider: AIProvider = {
      name: "mock-stream",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(_model, params): AsyncGenerator<AnyStreamChunk, void> {
        observedRequest = {
          reasoning: params.reasoning,
          maxOutputTokens: params.maxOutputTokens,
          temperature: params.temperature,
          topP: params.topP,
          providerOptions: params.providerOptions,
        };
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
    const agent = new Agent({
      provider,
      model: "mock",
      reasoning: true,
      temperature: 0.7,
      maxOutputTokens: 100,
      providerOptions: { seed: 1, metadata: { source: "agent" } },
    });

    await agent.send("Hi", {
      reasoning: false,
      maxOutputTokens: 20,
      topP: 0.5,
      providerOptions: { metadata: { source: "send" } },
    }).final;

    expect(observedRequest).toEqual({
      reasoning: false,
      maxOutputTokens: 20,
      temperature: 0.7,
      topP: 0.5,
      providerOptions: { seed: 1, metadata: { source: "send" } },
    });
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
      const instruct = new Instruct({ prompt: "Say hi" });
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
      const instruct = new Instruct({ prompt: "Hello {{name}}" }).withInputs({ name: "Alice" });
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
      const transcript = new Transcript();
      agent.on((event) => transcript.apply(event));

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
      expect(transcript.turns).toHaveLength(2);
      expect(agent.messages).toHaveLength(2);
      expect(agent.messages[0]).toMatchObject({ role: "user" });
      expect(agent.messages[1]).toMatchObject({ role: "assistant" });
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
      const transcript = new Transcript();
      agent.on((event) => transcript.apply(event));
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
      expect((error as AxleAgentAbortError).turn?.usage).toMatchObject({
        in: 1,
        out: 1,
        breakdown: [{ provider: "mock-stream", model: "mock", in: 1, out: 1 }],
      });
      expect(agent.messages).toHaveLength(2);
      expect(agent.messages[0]).toMatchObject({ role: "user" });
      expect(agent.messages[1]).toMatchObject({ role: "assistant" });
      expect(transcript.turns[1]?.status).toBe("cancelled");
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
    const instruct = new Instruct({ prompt: "msg1" });
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
        schema: z.object({}),
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
    expect(fatal.usage).toMatchObject({
      in: 1,
      out: 2,
      breakdown: [{ provider: "mock-tool-stream", model: "mock", in: 1, out: 2 }],
    });
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
      const instruct = new Instruct({ prompt: "Tell me about {{topic}}" }).withInputs({
        topic: "cats",
      });

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
        { text: string } | undefined;
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
      const transcript = new Transcript();
      agent.on((event) => transcript.apply(event));

      await agent.send("Hi").final;

      const userTurn = transcript.turns[0] as Turn;
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
      const transcript = new Transcript();
      const events: any[] = [];
      const inProgressSnapshots: any[] = [];
      agent.on((e) => {
        transcript.apply(e);
        events.push(e);
        if (e.type === "action:progress") {
          const turn = transcript.turns[1] as Turn | undefined;
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
      const agentTurn = transcript.turns[1] as Turn;
      const toolPart = agentTurn.parts.find(
        (p) => p.type === "action" && (p as any).kind === "tool",
      ) as any;
      expect(toolPart?.detail.result?.type).toBe("success");
      expect(toolPart?.detail.result?.content).toBe("done");
    });

    test("structured ctx.emit turn events accumulate under agent action children", async () => {
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
              data: { index: 0, id: "tc1", name: "childish" },
            };
            yield {
              type: "tool-call-complete",
              data: { index: 0, id: "tc1", name: "childish", arguments: {} },
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

      const childProvider: AIProvider = {
        name: "child-provider",
        async createGenerationRequest() {
          throw new Error("not used");
        },
        async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void, unknown> {
          yield {
            type: "start",
            id: "child-response",
            data: { model: "child-runtime-model", timestamp: 0 },
          };
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "child text" } };
          yield { type: "text-complete", data: { index: 0 } };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
          };
        },
      };
      const tool = createAgentTool({
        name: "childish",
        description: "emits child event progress",
        schema: z.object({}),
        createAgent: () =>
          new Agent({
            name: "childish",
            provider: childProvider,
            model: "child-configured-model",
          }),
      });

      const agent = new Agent({ provider, model: "mock", tools: [tool] });
      const transcript = new Transcript();
      const events: any[] = [];
      agent.on((event) => {
        transcript.apply(event);
        events.push(event);
      });

      await agent.send("hi").final;

      const childEvents = events.filter((event) => event.type === "action:child-event");
      expect(childEvents.length).toBeGreaterThanOrEqual(4);
      expect(childEvents.find((event) => event.event.type === "text:delta")?.event).toMatchObject({
        type: "text:delta",
        delta: "child text",
      });
      expect(events.some((event) => event.type === "action:progress")).toBe(false);

      const agentTurn = transcript.turns[1] as Turn;
      const agentPart = agentTurn.parts.find(
        (part) => part.type === "action" && part.kind === "agent",
      ) as any;
      expect(agentPart).toBeDefined();
      expect(agentPart.detail.name).toBe("childish");
      expect(agentPart.detail.children).toHaveLength(2);
      expect(agentPart.detail.children.find((turn: any) => turn.owner === "agent")).toMatchObject({
        owner: "agent",
        status: "complete",
        usage: { in: 1, out: 1 },
        parts: [{ type: "text", text: "child text" }],
      });
      expect(agentTurn.usage).toMatchObject({
        in: 3,
        out: 3,
        breakdown: [
          { provider: "mock", model: "mock", in: 2, out: 2 },
          { provider: "child-provider", model: "child-runtime-model", in: 1, out: 1 },
        ],
      });
    });
  });
});
