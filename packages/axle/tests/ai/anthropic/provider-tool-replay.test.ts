import { describe, expect, test } from "vitest";
import type { AxleMessage } from "../../../src/messages/message.js";
import { convertToProviderMessages } from "../../../src/providers/anthropic/utils.js";

describe("Anthropic provider tool replay", () => {
  test("sends the stored input and result block back as received", async () => {
    const fetchResult = {
      type: "web_fetch_tool_result",
      tool_use_id: "srvtoolu_1",
      content: { type: "web_fetch_result", url: "https://example.com" },
    };
    const messages: AxleMessage[] = [
      {
        role: "assistant",
        id: "msg_1",
        content: [
          {
            type: "provider-tool",
            id: "srvtoolu_1",
            name: "web_fetch",
            input: { url: "https://example.com" },
            output: fetchResult,
          },
        ],
      },
    ];

    const [converted] = await convertToProviderMessages(messages);

    expect(converted.content).toEqual([
      {
        type: "server_tool_use",
        id: "srvtoolu_1",
        name: "web_fetch",
        input: { url: "https://example.com" },
      },
      fetchResult,
    ]);
  });

  test("sends a server tool that has no result yet on its own", async () => {
    const messages: AxleMessage[] = [
      {
        role: "assistant",
        id: "msg_1",
        content: [
          {
            type: "provider-tool",
            id: "srvtoolu_1",
            name: "web_search",
            input: { query: "axle" },
          },
        ],
      },
    ];

    const [converted] = await convertToProviderMessages(messages);

    expect(converted.content).toEqual([
      { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "axle" } },
    ]);
  });
});
