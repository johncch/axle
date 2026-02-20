import { describe, expect, test, vi } from "vitest";
import { createMcpToolDefinitions, createMcpTools } from "../../src/mcp/tools.js";

function createMockClient(responses: Record<string, any> = {}) {
  return {
    callTool: vi.fn().mockImplementation(async (params: { name: string }) => {
      if (responses[params.name]) {
        return responses[params.name];
      }
      return {
        content: [{ type: "text", text: "default response" }],
      };
    }),
  } as any;
}

const sampleTools = [
  {
    name: "read_file",
    description: "Read a file from disk",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a file to disk",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
];

describe("createMcpTools", () => {
  test("creates Axle Tool objects from MCP tool definitions", () => {
    const client = createMockClient();
    const tools = createMcpTools(sampleTools, client);

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("read_file");
    expect(tools[0].description).toBe("Read a file from disk");
    expect(tools[0].schema).toBeDefined();
    expect(tools[0].execute).toBeTypeOf("function");
    expect(tools[1].name).toBe("write_file");
  });

  test("applies prefix to tool names", () => {
    const client = createMockClient();
    const tools = createMcpTools(sampleTools, client, "fs");

    expect(tools[0].name).toBe("fs_read_file");
    expect(tools[1].name).toBe("fs_write_file");
  });

  test("execute() calls client.callTool with original name", async () => {
    const client = createMockClient();
    const tools = createMcpTools(sampleTools, client, "fs");

    await tools[0].execute({ path: "/test.txt" });

    expect(client.callTool).toHaveBeenCalledWith({
      name: "read_file", // original name, not prefixed
      arguments: { path: "/test.txt" },
    });
  });

  test("execute() returns text content as string", async () => {
    const client = createMockClient({
      read_file: {
        content: [
          { type: "text", text: "line 1" },
          { type: "text", text: "line 2" },
        ],
      },
    });
    const tools = createMcpTools(sampleTools, client);
    const result = await tools[0].execute({ path: "/test.txt" });

    expect(result).toBe("line 1\nline 2");
  });

  test("execute() returns mixed content as ToolResultPart[]", async () => {
    const client = createMockClient({
      read_file: {
        content: [
          { type: "text", text: "Here is the image:" },
          { type: "image", data: "base64data==", mimeType: "image/png" },
        ],
      },
    });
    const tools = createMcpTools(sampleTools, client);
    const result = await tools[0].execute({ path: "/test.png" });

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([
      { type: "text", text: "Here is the image:" },
      { type: "image", data: "base64data==", mimeType: "image/png" },
    ]);
  });

  test("execute() throws on error results", async () => {
    const client = createMockClient({
      read_file: {
        content: [{ type: "text", text: "File not found" }],
        isError: true,
      },
    });
    const tools = createMcpTools(sampleTools, client);

    await expect(tools[0].execute({ path: "/missing.txt" })).rejects.toThrow("File not found");
  });

  test("execute() uses default error message when error has no text", async () => {
    const client = createMockClient({
      read_file: {
        content: [],
        isError: true,
      },
    });
    const tools = createMcpTools(sampleTools, client);

    await expect(tools[0].execute({ path: "/missing.txt" })).rejects.toThrow(
      "MCP tool execution error",
    );
  });

  test("handles tools with empty description", () => {
    const client = createMockClient();
    const tools = createMcpTools(
      [{ name: "test", inputSchema: { type: "object" } }],
      client,
    );

    expect(tools[0].description).toBe("");
  });
});

describe("createMcpToolDefinitions", () => {
  test("creates ToolDefinition objects without execute", () => {
    const defs = createMcpToolDefinitions(sampleTools);

    expect(defs).toHaveLength(2);
    expect(defs[0].name).toBe("read_file");
    expect(defs[0].description).toBe("Read a file from disk");
    expect(defs[0].schema).toBeDefined();
    expect(defs[0]).not.toHaveProperty("execute");
  });

  test("applies prefix to tool definition names", () => {
    const defs = createMcpToolDefinitions(sampleTools, "fs");

    expect(defs[0].name).toBe("fs_read_file");
    expect(defs[1].name).toBe("fs_write_file");
  });
});
