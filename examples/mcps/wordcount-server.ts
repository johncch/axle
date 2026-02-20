import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { z } from "zod";

const server = new McpServer({ name: "wordcount", version: "1.0.0" });

server.registerTool(
  "word_count",
  {
    description: "Count the number of words in a text string",
    inputSchema: { text: z.string().describe("The text to count words in") },
  },
  async ({ text }) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return {
      content: [{ type: "text", text: JSON.stringify({ words: words.length }) }],
    };
  },
);

server.registerTool(
  "char_count",
  {
    description: "Count the number of characters in a text string",
    inputSchema: { text: z.string().describe("The text to count characters in") },
  },
  async ({ text }) => {
    return {
      content: [{ type: "text", text: JSON.stringify({ characters: text.length }) }],
    };
  },
);

server.registerTool(
  "line_count",
  {
    description: "Count the number of lines in a text string",
    inputSchema: { text: z.string().describe("The text to count lines in") },
  },
  async ({ text }) => {
    const lines = text.split("\n").length;
    return {
      content: [{ type: "text", text: JSON.stringify({ lines }) }],
    };
  },
);

const mode = process.argv.includes("--http") ? "http" : "stdio";

if (mode === "stdio") {
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const port = parseInt(process.argv[process.argv.indexOf("--port") + 1] || "3100", 10);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);

  const httpServer = http.createServer(async (req, res) => {
    if (req.url === "/mcp") {
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(404).end();
    }
  });

  httpServer.listen(port, () => {
    console.log(`Wordcount MCP server listening on http://localhost:${port}/mcp`);
  });
}
