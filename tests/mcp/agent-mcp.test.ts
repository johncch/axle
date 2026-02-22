import { describe, expect, test, vi } from "vitest";
import { Agent } from "../../src/core/Agent.js";
import type { MCP } from "../../src/mcp/MCP.js";
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

function createMockMcp(tools: any[]): MCP {
  return {
    connected: true,
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(tools),
    listToolDefinitions: vi
      .fn()
      .mockResolvedValue(
        tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.schema })),
      ),
    refreshTools: vi.fn().mockResolvedValue(tools),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as MCP;
}

describe("Agent with MCP", () => {
  test("accepts mcps in config", async () => {
    const { z } = await import("zod");
    const mockTool = {
      name: "mcp-tool",
      description: "A tool from MCP",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue("mcp result"),
    };
    const mcp = createMockMcp([mockTool]);
    const provider = createMockStreamProvider(["ok"]);

    const agent = new Agent({ provider, model: "mock", mcps: [mcp] });

    // MCP tools should be resolved on first send
    const result = await agent.send("test").final;
    expect(result.response).toBe("ok");
    expect(mcp.listTools).toHaveBeenCalledTimes(1);
  });

  test("merges MCP tools with local tools", async () => {
    const { z } = await import("zod");
    const localTool = {
      name: "local-tool",
      description: "A local tool",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue("local result"),
    };
    const mcpTool = {
      name: "mcp-tool",
      description: "A tool from MCP",
      schema: z.object({ input: z.string() }),
      execute: vi.fn().mockResolvedValue("mcp result"),
    };
    const mcp = createMockMcp([mcpTool]);
    const provider = createMockStreamProvider(["ok"]);

    const agent = new Agent({
      provider,
      model: "mock",
      tools: [localTool],
      mcps: [mcp],
    });

    await agent.send("test").final;

    // Both local and MCP tools should be in the registry
    expect(agent.tools["local-tool"]).toBeDefined();
    expect(agent.tools["mcp-tool"]).toBeDefined();
  });

  test("MCP tools are resolved only once across multiple sends", async () => {
    const { z } = await import("zod");
    const mcpTool = {
      name: "mcp-tool",
      description: "A tool from MCP",
      schema: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    };
    const mcp = createMockMcp([mcpTool]);
    const provider = createMockStreamProvider(["first", "second"]);

    const agent = new Agent({ provider, model: "mock", mcps: [mcp] });

    await agent.send("msg1").final;
    await agent.send("msg2").final;

    // listTools should only be called once
    expect(mcp.listTools).toHaveBeenCalledTimes(1);
  });

  test("addMcp() adds MCP and forces re-resolution", async () => {
    const { z } = await import("zod");
    const mcpTool1 = {
      name: "tool1",
      description: "Tool 1",
      schema: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    };
    const mcpTool2 = {
      name: "tool2",
      description: "Tool 2",
      schema: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    };
    const mcp1 = createMockMcp([mcpTool1]);
    const mcp2 = createMockMcp([mcpTool2]);
    const provider = createMockStreamProvider(["first", "second"]);

    const agent = new Agent({ provider, model: "mock", mcps: [mcp1] });
    await agent.send("msg1").final;

    agent.addMcp(mcp2);
    await agent.send("msg2").final;

    // Both MCPs should have been resolved
    expect(mcp1.listTools).toHaveBeenCalled();
    expect(mcp2.listTools).toHaveBeenCalled();
  });

  test("hasTools() returns true when MCPs are configured", () => {
    const mcp = createMockMcp([]);
    const provider = createMockStreamProvider([]);
    const agent = new Agent({ provider, model: "mock", mcps: [mcp] });

    expect(agent.hasTools()).toBe(true);
  });

  test("cancel() works before MCP resolution completes", async () => {
    const { z } = await import("zod");
    const mcpTool = {
      name: "slow-tool",
      description: "Slow",
      schema: z.object({}),
      execute: vi.fn().mockResolvedValue("result"),
    };
    const mcp = createMockMcp([mcpTool]);
    const provider = createMockStreamProvider(["ok"]);

    const agent = new Agent({ provider, model: "mock", mcps: [mcp] });
    const handle = agent.send("test");

    // Cancel immediately — before MCP resolution may have completed
    handle.cancel();

    const result = await handle.final;
    // Should not throw, result may be null response due to cancellation
    expect(result).toBeDefined();
  });
});
