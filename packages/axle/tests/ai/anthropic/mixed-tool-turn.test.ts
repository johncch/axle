import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import z from "zod";
import type { AxleMessage } from "../../../src/messages/message.js";
import { createAnthropicStreamingAdapter } from "../../../src/providers/anthropic/createStreamingAdapter.js";
import { createStreamingRequest } from "../../../src/providers/anthropic/createStreamingRequest.js";
import {
  findOpenProviderToolCalls,
  resolveAnthropicProviderToolName,
} from "../../../src/providers/anthropic/utils.js";
import { generate } from "../../../src/providers/generate.js";
import { stream, type StreamEvent } from "../../../src/providers/stream.js";
import type { AIProvider } from "../../../src/providers/types.js";
import type { ExecutableTool, ProviderTool } from "../../../src/tools/types.js";

function messageStart(id: string, inputTokens: number) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-haiku-4-5",
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  };
}

function messageEnd(stopReason: string, outputTokens: number) {
  return [
    {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    },
    { type: "message_stop" },
  ];
}

function textBlock(index: number, text: string) {
  return [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ];
}

const searchResult = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_1",
  caller: { type: "direct" },
  content: [
    {
      type: "web_search_result",
      url: "https://www.anthropic.com/",
      title: "Home \\ Anthropic",
      encrypted_content: "enc",
      page_age: null,
    },
  ],
};

const callsSearchAndClientTool = [
  messageStart("msg_1", 2319),
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"query": "Anthropic homepage"}' },
  },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: {
      type: "tool_use",
      id: "toolu_1",
      name: "get_build_number",
      input: {},
      caller: { type: "direct" },
    },
  },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "" } },
  { type: "content_block_stop", index: 1 },
  ...messageEnd("tool_use", 78),
];

const opensWithSearchResult = [
  messageStart("msg_2", 6662),
  { type: "content_block_start", index: 0, content_block: searchResult },
  { type: "content_block_stop", index: 0 },
  ...textBlock(1, "Anthropic is an AI safety company, and the build number is 4127."),
  ...messageEnd("end_turn", 53),
];

const answersFollowUp = [
  messageStart("msg_3", 7000),
  ...textBlock(0, "4127."),
  ...messageEnd("end_turn", 5),
];

async function* responseOf(events: unknown[]) {
  for (const event of events) yield event;
}

const webSearch: ProviderTool = { type: "provider", name: "web_search" };
const userMessages: AxleMessage[] = [
  { role: "user", content: "Search for the Anthropic homepage and get the build number." },
];

describe("Anthropic server tool called alongside a client tool", () => {
  let mockClient: Anthropic;
  let mockCreate: Mock;
  let getBuildNumber: ExecutableTool;

  beforeEach(() => {
    mockCreate = vi.fn();
    mockClient = { messages: { create: mockCreate } } as any;
    getBuildNumber = {
      name: "get_build_number",
      description: "Return the current build number of this machine.",
      schema: z.object({}),
      execute: vi.fn().mockResolvedValue("build 4127"),
    };
  });

  const respondWith = (...responses: unknown[][]) => {
    for (const events of responses) mockCreate.mockResolvedValueOnce(responseOf(events));
  };

  const provider = (): AIProvider => ({
    name: "anthropic",
    resolveProviderToolName: resolveAnthropicProviderToolName,
    createStreamingRequest: (model, params) =>
      createStreamingRequest({ client: mockClient, model, ...params }),
  });

  test("completes the search when its result opens the next step's response", async () => {
    respondWith(callsSearchAndClientTool, opensWithSearchResult);
    const events: StreamEvent[] = [];

    const handle = stream({
      provider: provider(),
      model: "claude-haiku-4-5",
      messages: userMessages,
      tools: [getBuildNumber],
      providerTools: [webSearch],
    });
    handle.on((event) => events.push(event));
    await handle.final;

    expect(events.filter((event) => event.type === "provider-tool:start")).toMatchObject([
      { id: "srvtoolu_1", name: "web_search" },
    ]);
    expect(events.filter((event) => event.type === "provider-tool:complete")).toEqual([
      { type: "provider-tool:complete", id: "srvtoolu_1", name: "web_search" },
    ]);
  });

  test("stores the result at the start of the next assistant message", async () => {
    respondWith(callsSearchAndClientTool, opensWithSearchResult);

    const result = await generate({
      provider: provider(),
      model: "claude-haiku-4-5",
      messages: userMessages,
      tools: [getBuildNumber],
      providerTools: [webSearch],
    });

    expect(result.messages.map((message) => message.role)).toEqual([
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.messages[0].content).toEqual([
      {
        type: "provider-tool",
        id: "srvtoolu_1",
        name: "web_search",
        input: { type: "search", queries: ["Anthropic homepage"] },
        continuity: {
          provider: "anthropic",
          call: {
            type: "server_tool_use",
            id: "srvtoolu_1",
            name: "web_search",
            input: { query: "Anthropic homepage" },
          },
        },
      },
      { type: "tool-call", id: "toolu_1", name: "get_build_number", parameters: {} },
    ]);
    expect(result.messages[2].content).toEqual([
      {
        type: "provider-tool-result",
        id: "srvtoolu_1",
        name: "web_search",
        result: { type: "success" },
        continuity: { provider: "anthropic", result: searchResult },
      },
      { type: "text", text: "Anthropic is an AI safety company, and the build number is 4127." },
    ]);
  });

  test("sends the exchange back in Anthropic's order on a later request", async () => {
    respondWith(callsSearchAndClientTool, opensWithSearchResult, answersFollowUp);

    const first = await generate({
      provider: provider(),
      model: "claude-haiku-4-5",
      messages: userMessages,
      tools: [getBuildNumber],
      providerTools: [webSearch],
    });
    await generate({
      provider: provider(),
      model: "claude-haiku-4-5",
      messages: [
        ...userMessages,
        ...first.messages,
        { role: "user", content: "What was the build number again?" },
      ],
      tools: [getBuildNumber],
      providerTools: [webSearch],
    });

    const followUpRequest = mockCreate.mock.calls[2][0];
    expect(followUpRequest.messages.map((message: Anthropic.MessageParam) => message.role)).toEqual(
      ["user", "assistant", "user", "assistant", "user"],
    );
    expect(followUpRequest.messages[1].content).toEqual([
      {
        type: "server_tool_use",
        id: "srvtoolu_1",
        name: "web_search",
        input: { query: "Anthropic homepage" },
      },
      { type: "tool_use", id: "toolu_1", name: "get_build_number", input: {} },
    ]);
    expect(followUpRequest.messages[3].content).toEqual([
      searchResult,
      { type: "text", text: "Anthropic is an AI safety company, and the build number is 4127." },
    ]);
  });

  describe("createAnthropicStreamingAdapter", () => {
    const resultChunks = (adapter: ReturnType<typeof createAnthropicStreamingAdapter>) =>
      opensWithSearchResult
        .flatMap((event) => adapter.handleEvent(event as Anthropic.MessageStreamEvent))
        .filter((chunk) => chunk.type.startsWith("provider-tool"));

    test("emits the result of a call it was told is open", () => {
      const adapter = createAnthropicStreamingAdapter([{ id: "srvtoolu_1", name: "web_search" }]);

      expect(resultChunks(adapter)).toEqual([
        {
          type: "provider-tool-result",
          data: {
            index: 0,
            id: "srvtoolu_1",
            name: "web_search",
            result: { type: "success" },
            continuity: { provider: "anthropic", result: searchResult },
          },
        },
      ]);
    });

    test("skips a result whose call it does not know", () => {
      const adapter = createAnthropicStreamingAdapter([
        { id: "srvtoolu_other", name: "web_search" },
      ]);

      expect(resultChunks(adapter)).toEqual([]);
    });
  });

  describe("findOpenProviderToolCalls", () => {
    const openCall = { type: "provider-tool", id: "srvtoolu_1", name: "web_search" } as const;
    const assistant = (id: string, content: any[]): AxleMessage => ({
      role: "assistant",
      id,
      content,
    });

    test("finds a call with no result", () => {
      expect(findOpenProviderToolCalls([...userMessages, assistant("msg_1", [openCall])])).toEqual([
        { id: "srvtoolu_1", name: "web_search" },
      ]);
    });

    test("leaves out a call that carries its own result", () => {
      const answered = { ...openCall, result: { type: "success" } };

      expect(findOpenProviderToolCalls([assistant("msg_1", [answered])])).toEqual([]);
    });

    test("leaves out a call answered by a later message", () => {
      const result = {
        type: "provider-tool-result",
        id: "srvtoolu_1",
        name: "web_search",
        result: { type: "success" },
      };

      expect(
        findOpenProviderToolCalls([
          assistant("msg_1", [openCall]),
          assistant("msg_2", [{ type: "text", text: "Still working." }]),
          assistant("msg_3", [result]),
        ]),
      ).toEqual([]);
    });

    test("keeps a call open across assistant messages that do not answer it", () => {
      expect(
        findOpenProviderToolCalls([
          assistant("msg_1", [openCall]),
          assistant("msg_2", [{ type: "text", text: "Still working." }]),
        ]),
      ).toEqual([{ id: "srvtoolu_1", name: "web_search" }]);
    });
  });
});
