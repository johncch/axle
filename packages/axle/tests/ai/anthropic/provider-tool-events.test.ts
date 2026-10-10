import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import type { AxleMessage } from "../../../src/messages/message.js";
import { createStreamingRequest } from "../../../src/providers/anthropic/createStreamingRequest.js";
import { convertToProviderMessages } from "../../../src/providers/anthropic/utils.js";
import { stream, type StreamEvent } from "../../../src/providers/stream.js";
import type { AIProvider } from "../../../src/providers/types.js";

function searchCall(index: number, id: string, query: string) {
  return [
    {
      type: "content_block_start",
      index,
      content_block: { type: "server_tool_use", id, name: "web_search", input: {} },
    },
    {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: JSON.stringify({ query }) },
    },
    { type: "content_block_stop", index },
  ];
}

function searchResult(index: number, result: unknown) {
  return [
    { type: "content_block_start", index, content_block: result },
    { type: "content_block_stop", index },
  ];
}

const found = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_1",
  caller: { type: "direct" },
  content: [
    {
      type: "web_search_result",
      url: "https://www.anthropic.com/",
      title: "Home",
      encrypted_content: "enc",
      page_age: null,
    },
  ],
};

const limitReached = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_2",
  caller: { type: "direct" },
  content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
};

const searchesTwiceWithLimitOfOne = [
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-haiku-4-5",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  },
  ...searchCall(0, "srvtoolu_1", "Anthropic homepage"),
  ...searchResult(1, found),
  ...searchCall(2, "srvtoolu_2", "OpenAI homepage"),
  ...searchResult(3, limitReached),
  { type: "content_block_start", index: 4, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 4, delta: { type: "text_delta", text: "Done." } },
  { type: "content_block_stop", index: 4 },
  {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: 20 },
  },
  { type: "message_stop" },
];

async function* responseOf(events: unknown[]) {
  for (const event of events) yield event;
}

const userMessages: AxleMessage[] = [{ role: "user", content: "Search twice." }];

describe("Anthropic provider tool events", () => {
  let mockCreate: Mock;
  let provider: AIProvider;

  beforeEach(() => {
    mockCreate = vi.fn().mockResolvedValue(responseOf(searchesTwiceWithLimitOfOne));
    const mockClient = { messages: { create: mockCreate } } as unknown as Anthropic;
    provider = {
      name: "anthropic",
      createStreamingRequest: (model, params) =>
        createStreamingRequest({ client: mockClient, model, ...params }),
    };
  });

  const run = async () => {
    const events: StreamEvent[] = [];
    const handle = stream({
      provider,
      model: "claude-haiku-4-5",
      messages: userMessages,
      providerTools: [{ type: "provider", name: "web_search" }],
    });
    handle.on((event) => {
      if (event.type.startsWith("provider-tool:")) events.push(event);
    });
    return { events, result: await handle.final };
  };

  test("reports each search's input before its outcome", async () => {
    const { events } = await run();

    expect(events.map((event) => event.type)).toEqual([
      "provider-tool:start",
      "provider-tool:input",
      "provider-tool:complete",
      "provider-tool:start",
      "provider-tool:input",
      "provider-tool:error",
    ]);
    expect(events[1]).toEqual({
      type: "provider-tool:input",
      id: "srvtoolu_1",
      name: "web_search",
      input: { type: "search", queries: ["Anthropic homepage"] },
    });
  });

  test("reports a failed search as an error carrying Anthropic's error code", async () => {
    const { events } = await run();

    expect(events.at(-1)).toEqual({
      type: "provider-tool:error",
      id: "srvtoolu_2",
      name: "web_search",
      error: { type: "max_uses_exceeded", message: "web_search failed: max_uses_exceeded" },
    });
  });

  test("stores the error block and sends it back unchanged", async () => {
    const { result } = await run();

    expect(result.final?.content[1]).toEqual({
      type: "provider-tool",
      id: "srvtoolu_2",
      name: "web_search",
      input: { type: "search", queries: ["OpenAI homepage"] },
      result: {
        type: "error",
        error: { type: "max_uses_exceeded", message: "web_search failed: max_uses_exceeded" },
      },
      continuity: {
        provider: "anthropic",
        call: {
          type: "server_tool_use",
          id: "srvtoolu_2",
          name: "web_search",
          input: { query: "OpenAI homepage" },
        },
        result: limitReached,
      },
    });
    const [replayed] = await convertToProviderMessages(result.messages);
    expect((replayed.content as unknown[])[3]).toEqual(limitReached);
  });
});
