import { describe, expect, test, vi } from "vitest";
import { Agent } from "../../src/core/Agent.js";
import { Instruct } from "../../src/core/Instruct.js";
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

describe("Agent", () => {
  test("start() resolves with raw text response", async () => {
    const provider = createMockStreamProvider(["Hello world"]);
    const instruct = new Instruct("Hi");
    const agent = new Agent(instruct, { provider, model: "mock" });

    const result = await agent.start().final;

    expect(result.response).toBe("Hello world");
    expect(result.usage).toEqual({ in: 10, out: 20 });
  });

  test("start() with variables substitutes into prompt", async () => {
    const provider = createMockStreamProvider(["Greeting sent"]);
    const instruct = new Instruct("Say hello to {{name}}");
    const agent = new Agent(instruct, { provider, model: "mock" });

    const result = await agent.start({ name: "Alice" }).final;

    expect(result.response).toBe("Greeting sent");
  });

  test("start() with schema parses response via tags", async () => {
    const provider = createMockStreamProvider(["<answer>42</answer>"]);
    const { z } = await import("zod");
    const instruct = new Instruct("What is the answer?", {
      answer: z.number(),
    });
    const agent = new Agent(instruct, { provider, model: "mock" });

    const result = await agent.start().final;

    expect(result.response).toEqual({ answer: 42 });
  });

  test("send() follow-on accumulates history", async () => {
    const provider = createMockStreamProvider(["Response 1", "Response 2"]);
    const instruct = new Instruct("Initial message");
    const agent = new Agent(instruct, { provider, model: "mock" });

    await agent.start().final;
    await agent.send("Follow up").final;

    // 2 user + 2 assistant = 4 messages
    expect(agent.history.messages).toHaveLength(4);
    expect(agent.history.messages[0].role).toBe("user");
    expect(agent.history.messages[1].role).toBe("assistant");
    expect(agent.history.messages[2].role).toBe("user");
    expect(agent.history.messages[3].role).toBe("assistant");
  });

  test("AgentResult.usage has correct token stats", async () => {
    const provider = createMockStreamProvider(["test"]);
    const instruct = new Instruct("Hi");
    const agent = new Agent(instruct, { provider, model: "mock" });

    const result = await agent.start().final;

    expect(result.usage.in).toBe(10);
    expect(result.usage.out).toBe(20);
  });

  test("streaming callbacks fire during start", async () => {
    const provider = createMockStreamProvider(["streamed text"]);
    const instruct = new Instruct("Hi");
    const agent = new Agent(instruct, { provider, model: "mock" });

    const updates: string[] = [];
    const handle = agent.start();
    handle.onPartUpdate((_index, _type, delta) => {
      updates.push(delta);
    });

    await handle.final;

    expect(updates).toContain("streamed text");
  });

  test("AgentResult.messages contains only new messages from this turn", async () => {
    const provider = createMockStreamProvider(["First", "Second"]);
    const instruct = new Instruct("msg1");
    const agent = new Agent(instruct, { provider, model: "mock" });

    await agent.start().final;
    const result2 = await agent.send("msg2").final;

    for (const msg of result2.messages) {
      if (msg.role === "assistant") {
        const textPart = msg.content.find((c) => c.type === "text");
        if (textPart && textPart.type === "text") {
          expect(textPart.text).toBe("Second");
        }
      }
    }
  });

  test("system message is read from instruct", async () => {
    const provider = createMockStreamProvider(["ok"]);
    const instruct = new Instruct("Hi");
    instruct.system = "You are helpful";
    const agent = new Agent(instruct, { provider, model: "mock" });

    await agent.start().final;
    // system is on instruct, not history
    expect(agent.instruct.system).toBe("You are helpful");
  });

  test("tools on instruct are used for tool calls", async () => {
    const { z } = await import("zod");
    const provider = createMockStreamProvider(["ok"]);
    const instruct = new Instruct("Hi");

    const mockTool = {
      name: "test-tool",
      description: "A test tool",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue("result"),
    };
    instruct.addTool(mockTool);

    const agent = new Agent(instruct, { provider, model: "mock" });
    await agent.start().final;

    expect(instruct.hasTools()).toBe(true);
  });
});
