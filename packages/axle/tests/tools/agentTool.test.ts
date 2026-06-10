import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { Agent } from "../../src/core/agent/index.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { AxleStopReason, type AIProvider } from "../../src/providers/types.js";
import { createAgentTool } from "../../src/tools/agentTool.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolContext } from "../../src/tools/types.js";

const testCtx: ToolContext = {
  registry: new ToolRegistry(),
  signal: new AbortController().signal,
  emit: () => {},
};

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

    const result = await tool.execute({ task: "summarize" }, testCtx);

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(prompts).toEqual(["Do this: summarize"]);
    expect(result).toBe("child done");
  });

  test("can include child usage in a structured result", async () => {
    const tool = createAgentTool({
      name: "delegate_with_usage",
      description: "Delegate work",
      schema: z.object({ task: z.string() }),
      createAgent: () => new Agent({ provider: createProvider("child done"), model: "mock" }),
      includeUsage: true,
    });

    const result = JSON.parse(String(await tool.execute({ task: "summarize" }, testCtx)));

    expect(result).toEqual({
      response: "child done",
      usage: { in: 3, out: 4 },
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

    await tool.execute(
      { task: "summarize" },
      {
        ...testCtx,
        emit: (chunk) => chunks.push(chunk),
      },
    );

    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "turn:start"))).toBe(true);
    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "text:delta"))).toBe(true);
    expect(chunks.some((chunk) => isTurnEventChunk(chunk, "turn:end"))).toBe(true);
  });
});

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
