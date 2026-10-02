import type { ServerToolUseBlock } from "@anthropic-ai/sdk/resources/messages.js";
import { describe, expect, test } from "vitest";
import type { AxleMessage } from "../../../src/messages/message.js";
import type { AnthropicServerToolResultBlock } from "../../../src/messages/providerTool.js";
import { convertToProviderMessages } from "../../../src/providers/anthropic/utils.js";

const fetchCall: ServerToolUseBlock = {
  type: "server_tool_use",
  id: "srvtoolu_1",
  name: "web_fetch",
  input: { url: "https://example.com" },
  caller: { type: "direct" },
};

const fetchResult: AnthropicServerToolResultBlock = {
  type: "web_fetch_tool_result",
  tool_use_id: "srvtoolu_1",
  caller: { type: "direct" },
  content: {
    type: "web_fetch_result",
    url: "https://example.com",
    retrieved_at: null,
    content: {
      type: "document",
      title: null,
      citations: null,
      source: { type: "text", media_type: "text/plain", data: "Example Domain" },
    },
  },
};

async function replayed(content: Extract<AxleMessage, { role: "assistant" }>["content"]) {
  const [converted] = await convertToProviderMessages([
    { role: "assistant", id: "msg_1", content },
  ]);
  return converted.content;
}

describe("Anthropic provider tool replay", () => {
  test("sends the stored call and result blocks back as received", async () => {
    const content = await replayed([
      {
        type: "provider-tool",
        id: "srvtoolu_1",
        name: "web_fetch",
        input: { type: "open", url: "https://example.com" },
        result: { type: "success" },
        continuity: { provider: "anthropic", call: fetchCall, result: fetchResult },
      },
    ]);

    expect(content).toEqual([fetchCall, fetchResult]);
  });

  test("sends a server tool that has no result yet on its own", async () => {
    const content = await replayed([
      {
        type: "provider-tool",
        id: "srvtoolu_1",
        name: "web_fetch",
        input: { type: "open", url: "https://example.com" },
        continuity: { provider: "anthropic", call: fetchCall },
      },
    ]);

    expect(content).toEqual([fetchCall]);
  });

  test("sends a result whose call is in an earlier message on its own", async () => {
    const content = await replayed([
      {
        type: "provider-tool-result",
        id: "srvtoolu_1",
        name: "web_fetch",
        result: { type: "success" },
        continuity: { provider: "anthropic", result: fetchResult },
      },
    ]);

    expect(content).toEqual([fetchResult]);
  });

  test("leaves out a provider tool call that another provider made", async () => {
    const content = await replayed([
      {
        type: "provider-tool",
        id: "ws_1",
        name: "web_search",
        input: { type: "search", queries: ["axle"] },
        result: { type: "success" },
        continuity: {
          provider: "openai",
          item: {
            id: "ws_1",
            type: "web_search_call",
            status: "completed",
            action: { type: "search", query: "axle" },
          },
        },
      },
      { type: "text", text: "Found it." },
    ]);

    expect(content).toEqual([{ type: "text", text: "Found it." }]);
  });

  test("leaves out a provider tool part that has nothing to send back", async () => {
    const content = await replayed([
      {
        type: "provider-tool",
        id: "srvtoolu_1",
        name: "web_fetch",
        input: { type: "open", url: "https://example.com" },
        result: { type: "success" },
      },
      { type: "text", text: "Found it." },
    ]);

    expect(content).toEqual([{ type: "text", text: "Found it." }]);
  });
});
