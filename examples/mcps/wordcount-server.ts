import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { z } from "zod";

function createServer(): McpServer {
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

  return server;
}

const mode = process.argv.includes("--http") ? "http" : "stdio";

if (mode === "stdio") {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
} else {
  const port = parseInt(process.argv[process.argv.indexOf("--port") + 1] || "3100", 10);

  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }

    if (req.method === "POST") {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);
      await transport.handleRequest(req, res, await readBody(req));
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } else {
      res.writeHead(405).end();
    }
  });

  httpServer.listen(port, () => {
    console.log(`Wordcount MCP server listening on http://localhost:${port}/mcp`);
  });
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
