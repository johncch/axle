import { describe, expect, test, vi, beforeEach } from "vitest";
import { MCP } from "../../src/mcp/MCP.js";

// Shared mock state
const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
      {
        name: "image_tool",
        description: "Returns images",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "result" }],
  }),
};

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class MockClient {
    connect = mockClient.connect;
    close = mockClient.close;
    listTools = mockClient.listTools;
    callTool = mockClient.callTool;
  }

  return { Client: MockClient };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  class MockStdioTransport {}
  return { StdioClientTransport: MockStdioTransport };
});

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class MockHTTPTransport {
    constructor(_url: URL, _opts?: any) {}
  }
  return { StreamableHTTPClientTransport: MockHTTPTransport };
});

describe("MCP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("creates with stdio config", () => {
      const mcp = new MCP({
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });
      expect(mcp.connected).toBe(false);
    });

    test("creates with http config", () => {
      const mcp = new MCP({
        transport: "http",
        url: "http://localhost:3000/mcp",
      });
      expect(mcp.connected).toBe(false);
    });
  });

  describe("connect", () => {
    test("connects via stdio transport", async () => {
      const mcp = new MCP({
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { FOO: "bar" },
      });

      await mcp.connect();
      expect(mcp.connected).toBe(true);
    });

    test("connects via http transport", async () => {
      const mcp = new MCP({
        transport: "http",
        url: "http://localhost:3000/mcp",
        headers: { Authorization: "Bearer token" },
      });

      await mcp.connect();
      expect(mcp.connected).toBe(true);
    });

    test("connect is idempotent", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });

      await mcp.connect();
      const connectCount = mockClient.connect.mock.calls.length;
      await mcp.connect();

      // connect on the underlying client should only be called once
      expect(mockClient.connect).toHaveBeenCalledTimes(connectCount);
    });
  });

  describe("listTools", () => {
    test("throws if not connected", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await expect(mcp.listTools()).rejects.toThrow("MCP not connected");
    });

    test("returns Axle Tool objects", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      const tools = await mcp.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("test_tool");
      expect(tools[0].description).toBe("A test tool");
      expect(tools[0].execute).toBeTypeOf("function");
    });

    test("applies prefix", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      const tools = await mcp.listTools({ prefix: "my" });
      expect(tools[0].name).toBe("my_test_tool");
    });

    test("caches tool list", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      const callsBefore = mockClient.listTools.mock.calls.length;
      await mcp.listTools();
      await mcp.listTools();

      // listTools on the underlying client should only be called once for this MCP instance
      expect(mockClient.listTools.mock.calls.length - callsBefore).toBe(1);
    });
  });

  describe("listToolDefinitions", () => {
    test("returns ToolDefinition objects without execute", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      const defs = await mcp.listToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe("test_tool");
      expect(defs[0]).not.toHaveProperty("execute");
    });

    test("throws if not connected", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await expect(mcp.listToolDefinitions()).rejects.toThrow("MCP not connected");
    });
  });

  describe("refreshTools", () => {
    test("clears cache and re-fetches", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      const callsBefore = mockClient.listTools.mock.calls.length;
      await mcp.listTools();
      await mcp.refreshTools();

      // Should have called listTools twice (initial + refresh)
      expect(mockClient.listTools.mock.calls.length - callsBefore).toBe(2);
    });
  });

  describe("close", () => {
    test("closes the connection", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();
      expect(mcp.connected).toBe(true);

      await mcp.close();
      expect(mcp.connected).toBe(false);
    });

    test("close is idempotent", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();

      await mcp.close();
      await mcp.close();
      expect(mcp.connected).toBe(false);
    });

    test("listTools throws after close", async () => {
      const mcp = new MCP({ transport: "stdio", command: "node" });
      await mcp.connect();
      await mcp.close();

      await expect(mcp.listTools()).rejects.toThrow("MCP not connected");
    });
  });
});
