import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import z from "zod";
import type { AxleMessage } from "../../../src/messages/message.js";
import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/anthropic/createStreamingRequest.js";
import { resolveAnthropicProviderToolName } from "../../../src/providers/anthropic/utils.js";
import { generate } from "../../../src/providers/generate.js";
import { stream, type StreamEvent } from "../../../src/providers/stream.js";
import { AxleStopReason, type AIProvider } from "../../../src/providers/types.js";
import type { ExecutableTool, ProviderTool } from "../../../src/tools/types.js";

const directCaller = { type: "direct" } as const;

function messageStart(id: string, inputTokens: number) {
  return {
    type: "message_start",
    message: {
      id,
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-opus-4-8",
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

function searchCallBlock(index: number, id: string, query: string) {
  const json = JSON.stringify({ query });
  return [
    {
      type: "content_block_start",
      index,
      content_block: {
        type: "server_tool_use",
        id,
        name: "web_search",
        input: {},
        caller: directCaller,
      },
    },
    {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: json.slice(0, 5) },
    },
    {
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: json.slice(5) },
    },
    { type: "content_block_stop", index },
  ];
}

function searchResult(id: string) {
  return {
    type: "web_search_tool_result",
    tool_use_id: id,
    caller: directCaller,
    content: [
      {
        type: "web_search_result",
        url: "https://example.com",
        title: "Example",
        encrypted_content: "enc",
        page_age: null,
      },
    ],
  };
}

function searchResultBlock(index: number, id: string) {
  return [
    { type: "content_block_start", index, content_block: searchResult(id) },
    { type: "content_block_stop", index },
  ];
}

const pausedBeforeSearchRuns = [
  messageStart("msg_1", 10),
  ...textBlock(0, "Let me look that up."),
  ...searchCallBlock(1, "srvtoolu_1", "axle"),
  ...messageEnd("pause_turn", 20),
];

const pausedBeforeSearchRunsContent = [
  { type: "text", text: "Let me look that up." },
  {
    type: "server_tool_use",
    id: "srvtoolu_1",
    name: "web_search",
    input: { query: "axle" },
    caller: directCaller,
  },
];

const finishesAfterSearch = [
  messageStart("msg_2", 40),
  ...searchResultBlock(0, "srvtoolu_1"),
  ...textBlock(1, "Found it."),
  ...messageEnd("end_turn", 7),
];

async function* responseOf(events: unknown[]) {
  for (const event of events) yield event;
}

async function drain(source: AsyncGenerator<AnyStreamChunk, void, unknown>) {
  const chunks: AnyStreamChunk[] = [];
  for await (const chunk of source) chunks.push(chunk);
  return chunks;
}

const webSearch: ProviderTool = { type: "provider", name: "web_search" };
const userMessages: AxleMessage[] = [{ role: "user", content: "Search for axle" }];

describe("Anthropic pause_turn continuation", () => {
  let mockClient: Anthropic;
  let mockCreate: Mock;

  beforeEach(() => {
    mockCreate = vi.fn();
    mockClient = { messages: { create: mockCreate } } as any;
  });

  const respondWith = (...responses: unknown[][]) => {
    for (const events of responses) mockCreate.mockResolvedValueOnce(responseOf(events));
  };

  const requestAt = (call: number) => mockCreate.mock.calls[call][0];

  describe("createStreamingRequest", () => {
    const run = (signal?: AbortSignal) =>
      drain(
        createStreamingRequest({
          client: mockClient,
          model: "claude-opus-4-8",
          messages: userMessages,
          providerTools: [webSearch],
          runtime: {},
          signal,
        }),
      );

    test("re-sends the paused assistant content unchanged with the same request", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);

      await run();

      expect(mockCreate).toHaveBeenCalledTimes(2);
      const { messages: firstMessages, ...firstRest } = requestAt(0);
      const { messages: secondMessages, ...secondRest } = requestAt(1);
      expect(secondRest).toEqual(firstRest);
      expect(secondMessages).toEqual([
        ...firstMessages,
        { role: "assistant", content: pausedBeforeSearchRunsContent },
      ]);
    });

    test("presents both responses as one step", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);

      const chunks = await run();

      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "start",
        "text-start",
        "text-delta",
        "text-complete",
        "provider-tool-start",
        "provider-tool-input",
        "provider-tool-complete",
        "text-start",
        "text-delta",
        "text-complete",
        "complete",
      ]);
      expect(chunks[0]).toMatchObject({ type: "start", id: "msg_1" });
      expect(chunks.at(-1)).toMatchObject({
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 50, out: 27 } },
      });
    });

    test("completes a search whose result arrives in the next response", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);

      const chunks = await run();

      const started = chunks.find((chunk) => chunk.type === "provider-tool-start");
      const completed = chunks.find((chunk) => chunk.type === "provider-tool-complete");
      expect(completed?.data).toMatchObject({
        id: "srvtoolu_1",
        name: "web_search",
        index: started?.data.index,
      });
    });

    test("keeps block indices distinct across responses", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);

      const chunks = await run();

      const textStartIndices = chunks
        .filter((chunk) => chunk.type === "text-start")
        .map((chunk) => chunk.data.index);
      const searchIndex = chunks.find((chunk) => chunk.type === "provider-tool-start")?.data.index;
      // Response 1 holds blocks 0-1; response 2's blocks 0-1 continue as 2-3.
      expect(textStartIndices).toEqual([0, 3]);
      expect(searchIndex).toBe(1);
    });

    test("replays every paused response, in order, when the turn pauses repeatedly", async () => {
      const pausedAgain = [
        messageStart("msg_2", 40),
        ...searchResultBlock(0, "srvtoolu_1"),
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "thinking_delta", thinking: "Need more." },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "signature_delta", signature: "sig_1" },
        },
        { type: "content_block_stop", index: 1 },
        ...searchCallBlock(2, "srvtoolu_2", "axle cli"),
        ...searchResultBlock(3, "srvtoolu_2"),
        ...messageEnd("pause_turn", 30),
      ];
      const finishes = [
        messageStart("msg_3", 90),
        ...textBlock(0, "Done."),
        ...messageEnd("end_turn", 3),
      ];
      respondWith(pausedBeforeSearchRuns, pausedAgain, finishes);

      const chunks = await run();

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(requestAt(2).messages).toEqual([
        ...requestAt(0).messages,
        {
          role: "assistant",
          content: [
            ...pausedBeforeSearchRunsContent,
            searchResult("srvtoolu_1"),
            { type: "thinking", thinking: "Need more.", signature: "sig_1" },
            {
              type: "server_tool_use",
              id: "srvtoolu_2",
              name: "web_search",
              input: { query: "axle cli" },
              caller: directCaller,
            },
            searchResult("srvtoolu_2"),
          ],
        },
      ]);
      expect(chunks.filter((chunk) => chunk.type === "start")).toHaveLength(1);
      expect(chunks.at(-1)).toMatchObject({
        type: "complete",
        data: { usage: { in: 140, out: 53 } },
      });
    });

    test("replays text citations gathered from deltas", async () => {
      const citation = {
        type: "web_search_result_location",
        cited_text: "Axle is a runtime",
        encrypted_index: "idx",
        title: "Example",
        url: "https://example.com",
      };
      const pausedWithCitedText = [
        messageStart("msg_1", 10),
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Axle is" } },
        { type: "content_block_stop", index: 0 },
        ...messageEnd("pause_turn", 20),
      ];
      respondWith(pausedWithCitedText, finishesAfterSearch);

      await run();

      expect(requestAt(1).messages.at(-1)).toEqual({
        role: "assistant",
        content: [{ type: "text", text: "Axle is", citations: [citation] }],
      });
    });

    test("does not continue once the signal is aborted", async () => {
      const controller = new AbortController();
      mockCreate.mockResolvedValueOnce(
        (async function* () {
          yield* pausedBeforeSearchRuns;
          controller.abort();
        })(),
      );

      const chunks = await run(controller.signal);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(chunks.some((chunk) => chunk.type === "complete")).toBe(false);
    });
  });

  describe("through stream() and generate()", () => {
    const provider = (): AIProvider => ({
      name: "anthropic",
      resolveProviderToolName: resolveAnthropicProviderToolName,
      createStreamingRequest: (model, params) =>
        createStreamingRequest({ client: mockClient, model, ...params }),
    });

    test("stream() reports one step with each part emitted once", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);
      const events: StreamEvent[] = [];

      const handle = stream({
        provider: provider(),
        model: "claude-opus-4-8",
        messages: userMessages,
        providerTools: [webSearch],
      });
      handle.on((event) => events.push(event));
      const result = await handle.final;

      expect(events.filter((event) => event.type === "step:start")).toHaveLength(1);
      expect(events.filter((event) => event.type === "step:complete")).toHaveLength(1);
      expect(events.flatMap((event) => (event.type === "text:end" ? [event.final] : []))).toEqual([
        "Let me look that up.",
        "Found it.",
      ]);
      expect(events.filter((event) => event.type === "provider-tool:start")).toMatchObject([
        { id: "srvtoolu_1" },
      ]);
      expect(events.filter((event) => event.type === "provider-tool:complete")).toMatchObject([
        { id: "srvtoolu_1" },
      ]);

      expect(result.ok).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.final).toMatchObject({
        role: "assistant",
        finishReason: AxleStopReason.Stop,
        content: [
          { type: "text", text: "Let me look that up." },
          { type: "provider-tool", id: "srvtoolu_1", name: "web_search" },
          { type: "text", text: "Found it." },
        ],
      });
      expect(result.final?.content[1]).toMatchObject({
        input: { type: "search", queries: ["axle"] },
        result: { type: "success" },
        continuity: {
          provider: "anthropic",
          call: { type: "server_tool_use", id: "srvtoolu_1", input: { query: "axle" } },
          result: searchResult("srvtoolu_1"),
        },
      });
      expect(result.usage).toMatchObject({ in: 50, out: 27 });
    });

    test("generate() resolves with the continued answer", async () => {
      respondWith(pausedBeforeSearchRuns, finishesAfterSearch);

      const result = await generate({
        provider: provider(),
        model: "claude-opus-4-8",
        messages: userMessages,
        providerTools: [webSearch],
      });

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
      expect(result.final?.finishReason).toBe(AxleStopReason.Stop);
      expect(result.usage).toMatchObject({ in: 50, out: 27 });
    });

    test("a continuation that asks for a client tool enters the normal tool loop", async () => {
      const lookup: ExecutableTool = {
        name: "lookup",
        description: "Look up a value",
        schema: z.object({ key: z.string() }),
        execute: vi.fn().mockResolvedValue("42"),
      };
      const asksForClientTool = [
        messageStart("msg_2", 40),
        ...searchResultBlock(0, "srvtoolu_1"),
        {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
        },
        {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"key":"a"}' },
        },
        { type: "content_block_stop", index: 1 },
        ...messageEnd("tool_use", 9),
      ];
      const finishes = [
        messageStart("msg_3", 70),
        ...textBlock(0, "The answer is 42."),
        ...messageEnd("end_turn", 6),
      ];
      respondWith(pausedBeforeSearchRuns, asksForClientTool, finishes);

      const result = await generate({
        provider: provider(),
        model: "claude-opus-4-8",
        messages: userMessages,
        tools: [lookup],
        providerTools: [webSearch],
      });

      expect(lookup.execute).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.messages.map((message) => message.role)).toEqual([
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(result.messages[0]).toMatchObject({ finishReason: AxleStopReason.FunctionCall });
      expect(requestAt(2).messages[1]).toEqual({
        role: "assistant",
        content: [
          { type: "text", text: "Let me look that up." },
          {
            type: "server_tool_use",
            id: "srvtoolu_1",
            name: "web_search",
            input: { query: "axle" },
            caller: directCaller,
          },
          searchResult("srvtoolu_1"),
          { type: "tool_use", id: "toolu_1", name: "lookup", input: { key: "a" } },
        ],
      });
      expect(result.usage).toMatchObject({ in: 120, out: 35 });
    });
  });
});
