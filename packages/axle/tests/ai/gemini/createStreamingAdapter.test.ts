import {
  FinishReason,
  type GenerateContentResponse,
  Language,
  Outcome,
  type Part,
} from "@google/genai";
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { createGeminiStreamingAdapter } from "../../../src/providers/gemini/createStreamingAdapter.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("createGeminiStreamingAdapter", () => {
  describe("basic streaming events", () => {
    test("should handle first chunk and emit start event", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ parts: [] }));

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].type).toBe("start");
      if (chunks[0].type === "start") {
        expect(chunks[0].id).toBe("resp_123");
        expect(chunks[0].data.model).toBe("gemini-2.0-flash");
      }
    });

    test("should emit text-start before first text-delta", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(makeChunk({ parts: [{ text: "Hello, world!" }] }));

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types.indexOf("text-start")).toBeLessThan(types.indexOf("text-delta"));

      const textDelta = chunks.find((c) => c.type === "text-delta");
      if (textDelta && textDelta.type === "text-delta") {
        expect(textDelta.data.text).toBe("Hello, world!");
        expect(textDelta.data.index).toBe(0);
      }
    });

    test("should not emit text-start on subsequent text chunks", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hello" }] }));
      const chunks = adapter.handleChunk(makeChunk({ parts: [{ text: ", world!" }] }));

      const types = chunks.map((c) => c.type);
      expect(types).not.toContain("text-start");
      expect(types).toContain("text-delta");

      const textDelta = chunks.find((c) => c.type === "text-delta");
      if (textDelta && textDelta.type === "text-delta") {
        expect(textDelta.data.text).toBe(", world!");
      }
    });

    test("should emit text-complete before complete on finish", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hi" }] }));

      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ text: "Done" }],
          finishReason: FinishReason.STOP,
          usage: { promptTokenCount: 10, totalTokenCount: 30 },
        }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types).toContain("complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("complete"));

      const completeChunk = chunks.find((c) => c.type === "complete");
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Stop);
        expect(completeChunk.data.usage.in).toBe(10);
        expect(completeChunk.data.usage.out).toBe(20);
      }
    });

    test("should include cache and reasoning usage details on completion", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ text: "Done" }],
          finishReason: FinishReason.STOP,
          usage: {
            promptTokenCount: 10,
            totalTokenCount: 30,
            cachedContentTokenCount: 6,
            thoughtsTokenCount: 4,
          },
        }),
      );

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk?.type).toBe("complete");
      if (completeChunk?.type === "complete") {
        expect(completeChunk.data.usage).toEqual({
          in: 10,
          out: 20,
          cachedIn: 6,
          reasoningOut: 4,
        });
      }
    });

    test("should handle completion with MAX_TOKENS finish reason", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Hi" }] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.MAX_TOKENS }),
      );

      const completeChunk = chunks.find((c) => c.type === "complete");
      expect(completeChunk).toBeDefined();
      if (completeChunk && completeChunk.type === "complete") {
        expect(completeChunk.data.finishReason).toBe(AxleStopReason.Length);
      }
    });

    test("should handle error finish reasons", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.MALFORMED_FUNCTION_CALL }),
      );

      const errorChunk = chunks.find((c) => c.type === "error");
      expect(errorChunk).toBeDefined();
      if (errorChunk && errorChunk.type === "error") {
        expect(errorChunk.data.type).toBe("FinishReasonError");
        expect(errorChunk.data.message).toContain("Unexpected finish reason");
      }
    });
  });

  describe("thinking content", () => {
    test("should emit thinking-start before first thinking-summary-delta", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [
            { text: "Let me think about this...", thought: true, thoughtSignature: "sig_123" },
          ],
        }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking-start");
      expect(types).toContain("thinking-summary-delta");
      expect(types.indexOf("thinking-start")).toBeLessThan(types.indexOf("thinking-summary-delta"));

      const thinkingStart = chunks.find((c) => c.type === "thinking-start");
      if (thinkingStart?.type === "thinking-start") {
        expect(thinkingStart.data.continuity).toEqual({
          provider: "gemini",
          thoughtSignature: "sig_123",
        });
      }

      const thinkingDelta = chunks.find((c) => c.type === "thinking-summary-delta");
      if (thinkingDelta && thinkingDelta.type === "thinking-summary-delta") {
        expect(thinkingDelta.data.text).toBe("Let me think about this...");
        expect(thinkingDelta.data.index).toBe(0);
      }
    });

    test("a signature-only part after thinking updates the open part's continuity", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Thinking...", thought: true }] }));
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "", thoughtSignature: "sig_late" }] }),
      );

      expect(chunks).toEqual([
        {
          type: "thinking-metadata",
          data: { index: 0, continuity: { provider: "gemini", thoughtSignature: "sig_late" } },
        },
      ]);
    });

    test("a later thought part carrying a signature updates the open part's continuity", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "First, ", thought: true }] }));
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "then.", thought: true, thoughtSignature: "sig_2" }] }),
      );

      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "thinking-metadata",
        "thinking-summary-delta",
      ]);
      expect(chunks[0]).toMatchObject({
        data: { index: 0, continuity: { provider: "gemini", thoughtSignature: "sig_2" } },
      });
    });

    test("a signature-only part after text becomes a continuity-only thinking part", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Answer" }] }));
      const chunks = adapter.handleChunk(makeChunk({ parts: [{ thoughtSignature: "sig_tail" }] }));

      expect(chunks).toEqual([
        { type: "text-complete", data: { index: 0 } },
        {
          type: "thinking-start",
          data: { index: 1, continuity: { provider: "gemini", thoughtSignature: "sig_tail" } },
        },
        { type: "thinking-complete", data: { index: 1 } },
      ]);
    });

    test("should not emit thinking-start on subsequent thinking chunks", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "First, ", thought: true }] }));
      const chunks = adapter.handleChunk(
        makeChunk({ parts: [{ text: "I need to consider...", thought: true }] }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).not.toContain("thinking-start");
      expect(types).toContain("thinking-summary-delta");

      const delta = chunks.find((c) => c.type === "thinking-summary-delta");
      if (delta && delta.type === "thinking-summary-delta") {
        expect(delta.data.text).toBe("I need to consider...");
      }
    });

    test("thinking followed by text produces correct lifecycle", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunk1 = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Thinking...", thought: true }] }),
      );
      const chunk2 = adapter.handleChunk(makeChunk({ parts: [{ text: "Here's my answer." }] }));

      const allChunks = [...chunk1, ...chunk2];
      const types = allChunks.map((c) => c.type);

      expect(types).toContain("thinking-start");
      expect(types).toContain("thinking-summary-delta");
      expect(types).toContain("thinking-complete");
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");

      const thinkingCompleteIdx = types.indexOf("thinking-complete");
      const textStartIdx = types.indexOf("text-start");
      expect(thinkingCompleteIdx).toBeLessThan(textStartIdx);
    });

    test("should emit thinking-complete on finish without text", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Thinking...", thought: true }] }));
      const chunks = adapter.handleChunk(makeChunk({ parts: [], finishReason: FinishReason.STOP }));

      const types = chunks.map((c) => c.type);
      expect(types).toContain("thinking-complete");
      expect(types.indexOf("thinking-complete")).toBeLessThan(types.indexOf("complete"));
    });
  });

  describe("function call events", () => {
    test("should handle function call (buffered, not streamed)", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      const toolComplete = chunks.find((c) => c.type === "tool-call-complete");

      expect(toolStart).toBeDefined();
      expect(toolComplete).toBeDefined();

      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.name).toBe("search");
        expect(toolStart.data.index).toBe(0);
      }
      if (toolComplete && toolComplete.type === "tool-call-complete") {
        expect(toolComplete.data.name).toBe("search");
        expect(toolComplete.data.arguments).toEqual({ query: "test" });
      }
    });

    test("should handle multiple function calls", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [
            { functionCall: { name: "search", args: { query: "test1" } } },
            { functionCall: { name: "calculate", args: { a: 1, b: 2 } } },
          ],
        }),
      );

      const toolCompletes = chunks.filter((c) => c.type === "tool-call-complete");
      expect(toolCompletes).toHaveLength(2);

      if (toolCompletes[0].type === "tool-call-complete") {
        expect(toolCompletes[0].data.name).toBe("search");
        expect(toolCompletes[0].data.arguments).toEqual({ query: "test1" });
      }
      if (toolCompletes[1].type === "tool-call-complete") {
        expect(toolCompletes[1].data.name).toBe("calculate");
        expect(toolCompletes[1].data.arguments).toEqual({ a: 1, b: 2 });
      }
    });

    test("should close active text before function calls", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Let me search" }] }));
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

      const types = chunks.map((c) => c.type);
      expect(types).toContain("text-complete");
      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("tool-call-start"));
    });

    test("should use functionCall.id when available", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { id: "fc_abc", name: "search", args: {} } }],
        }),
      );

      const toolStart = chunks.find((c) => c.type === "tool-call-start");
      if (toolStart && toolStart.type === "tool-call-start") {
        expect(toolStart.data.id).toBe("fc_abc");
      }
    });
  });

  describe("mixed content", () => {
    test("should handle text followed by function call with correct lifecycle", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunk1 = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Let me search for that." }] }),
      );
      const chunk2 = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: { query: "test" } } }],
        }),
      );

      const allChunks = [...chunk1, ...chunk2];
      const types = allChunks.map((c) => c.type);

      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-complete");
      expect(types).toContain("tool-call-start");
      expect(types).toContain("tool-call-complete");

      expect(types.indexOf("text-complete")).toBeLessThan(types.indexOf("tool-call-start"));
    });

    test("function call with STOP sets finishReason to FunctionCall", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: {} } }],
          finishReason: FinishReason.STOP,
        }),
      );

      const complete = chunks.find((c) => c.type === "complete");
      if (complete && complete.type === "complete") {
        expect(complete.data.finishReason).toBe(AxleStopReason.FunctionCall);
      }
    });
  });

  describe("citations", () => {
    test("emits text-citation from grounding metadata", () => {
      const adapter = createGeminiStreamingAdapter();
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ text: "The answer is grounded." }],
          groundingMetadata: {
            groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
            groundingSupports: [
              {
                groundingChunkIndices: [0],
                segment: { partIndex: 0, startIndex: 0, endIndex: 10, text: "The answer" },
              },
            ],
          },
        }),
      );

      const citation = chunks.find((c) => c.type === "text-citation");
      expect(citation?.type).toBe("text-citation");
      if (citation?.type === "text-citation") {
        expect(citation.data.citation).toMatchObject({
          source: { type: "web", title: "Source", url: "https://example.com" },
          outputSpan: { start: 0, end: 10 },
          providerMetadata: { outputText: "The answer" },
        });
      }
    });

    test("falls back to the current text part when grounding metadata has no part index", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = createGeminiStreamingAdapter();

      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ text: "The answer is grounded." }],
          groundingMetadata: {
            groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
            groundingSupports: [
              {
                groundingChunkIndices: [0],
                segment: { startIndex: 0, endIndex: 10, text: "The answer" },
              },
            ],
          },
        }),
      );

      const citation = chunks.find((c) => c.type === "text-citation");
      expect(citation?.type).toBe("text-citation");
      if (citation?.type === "text-citation") {
        expect(citation.data.index).toBe(0);
        expect(citation.data.citation).toMatchObject({
          source: { type: "web", title: "Source", url: "https://example.com" },
          outputSpan: { start: 0, end: 10 },
          providerMetadata: { outputText: "The answer" },
        });
      }
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    test.each([
      [{ thoughtSignature: "signature" }],
      [{ thought: true, text: "Reasoning" }],
      [{ functionCall: { name: "search", args: {} } }],
    ])("attaches delayed grounding to text after %j", (part) => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "The answer" }] }));
      adapter.handleChunk(makeChunk({ parts: [part] }));
      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [],
          finishReason: FinishReason.STOP,
          groundingMetadata: {
            groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
            groundingSupports: [
              {
                groundingChunkIndices: [0],
                segment: { endIndex: 10, text: "The answer" },
              },
            ],
          },
        }),
      );
      expect(chunks.find((chunk) => chunk.type === "text-citation")).toMatchObject({
        type: "text-citation",
        data: { index: 0, citation: { outputSpan: { start: 0, end: 10 } } },
      });
    });

    test("warns when grounding metadata cannot be attached to a text part", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const adapter = createGeminiStreamingAdapter();

      adapter.handleChunk(
        makeChunk({
          parts: [{ functionCall: { name: "search", args: {} } }],
          groundingMetadata: {
            groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
            groundingSupports: [
              {
                groundingChunkIndices: [0],
                segment: { startIndex: 0, endIndex: 10, text: "The answer" },
              },
            ],
          },
        }),
      );

      expect(warn).toHaveBeenCalledWith(
        "[Gemini] received citation without a resolvable text part",
        expect.objectContaining({
          citation: expect.objectContaining({
            source: { type: "web", title: "Source", url: "https://example.com" },
          }),
        }),
      );
      warn.mockRestore();
    });
  });

  describe("google search", () => {
    const searched = { webSearchQueries: ["Anthropic company type overview"] };
    const providerToolChunks = (chunks: Array<{ type: string }>) =>
      chunks.filter((chunk) => chunk.type.startsWith("provider-tool"));

    test("reports the search and its queries when the grounding metadata arrives", () => {
      const adapter = createGeminiStreamingAdapter();
      adapter.handleChunk(makeChunk({ parts: [{ text: "Anthropic is an AI company." }] }));

      const chunks = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.STOP, groundingMetadata: searched }),
      );

      expect(providerToolChunks(chunks)).toEqual([
        {
          type: "provider-tool-start",
          data: { index: 1, id: "resp_123:web_search", name: "web_search" },
        },
        {
          type: "provider-tool-input",
          data: {
            index: 1,
            id: "resp_123:web_search",
            name: "web_search",
            input: { type: "search", queries: ["Anthropic company type overview"] },
          },
        },
        {
          type: "provider-tool-complete",
          data: {
            index: 1,
            id: "resp_123:web_search",
            name: "web_search",
            result: { type: "success" },
          },
        },
      ]);
      expect(chunks.map((chunk) => chunk.type)).toEqual([
        "text-complete",
        "provider-tool-start",
        "provider-tool-input",
        "provider-tool-complete",
        "complete",
      ]);
    });

    test("reports the search once when the metadata is repeated", () => {
      const adapter = createGeminiStreamingAdapter();
      const first = adapter.handleChunk(
        makeChunk({ parts: [{ text: "Anthropic is" }], groundingMetadata: searched }),
      );
      const second = adapter.handleChunk(
        makeChunk({ parts: [], finishReason: FinishReason.STOP, groundingMetadata: searched }),
      );

      expect(providerToolChunks(first)).toHaveLength(3);
      expect(providerToolChunks(second)).toEqual([]);
    });

    test("reports nothing when the grounding metadata lists no queries", () => {
      const adapter = createGeminiStreamingAdapter();

      const chunks = adapter.handleChunk(
        makeChunk({
          parts: [{ text: "The answer is grounded." }],
          finishReason: FinishReason.STOP,
          groundingMetadata: {
            groundingChunks: [{ web: { title: "Source", uri: "https://example.com" } }],
          },
        }),
      );

      expect(providerToolChunks(chunks)).toEqual([]);
    });
  });
});

// Helpers

function makeChunk(options: {
  parts: any[];
  finishReason?: FinishReason;
  usage?: {
    promptTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  groundingMetadata?: Record<string, unknown>;
}) {
  return {
    responseId: "resp_123",
    modelVersion: "gemini-2.0-flash",
    candidates: [
      {
        content: { role: "model", parts: options.parts },
        finishReason: options.finishReason ?? FinishReason.FINISH_REASON_UNSPECIFIED,
        index: 0,
        ...(options.groundingMetadata && { groundingMetadata: options.groundingMetadata }),
      },
    ],
    ...(options.usage && { usageMetadata: options.usage }),
  } as any;
}

describe("createGeminiStreamingAdapter code execution", () => {
  const providerToolChunks = (chunks: Array<{ type: string }>) =>
    chunks.filter((chunk) => chunk.type.startsWith("provider-tool"));

  test("replays a captured gemini-3-flash-preview code execution answer", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { chunks, parts } = replayFixture("../../fixtures/gemini-code-execution.jsonl");

    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "provider-tool-start",
      "provider-tool-input",
      "provider-tool-complete",
      "text-start",
      "text-delta",
      "text-delta",
      "text-complete",
      "thinking-start",
      "thinking-complete",
      "complete",
    ]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();

    const [codePart, resultPart] = parts;
    expect(providerToolChunks(chunks)).toEqual([
      {
        type: "provider-tool-start",
        data: { index: 0, id: "call_675927", name: "code_execution" },
      },
      {
        type: "provider-tool-input",
        data: {
          index: 0,
          id: "call_675927",
          name: "code_execution",
          input: { type: "code", code: codePart.executableCode?.code },
          continuity: { provider: "gemini", parts: [codePart] },
        },
      },
      {
        type: "provider-tool-complete",
        data: {
          index: 0,
          id: "call_675927",
          name: "code_execution",
          result: { type: "success" },
          continuity: { provider: "gemini", parts: [codePart, resultPart] },
        },
      },
    ]);
    expect(codePart.thoughtSignature).toBeDefined();
  });

  test("pairs a result that carries no id with the open call", () => {
    const adapter = createGeminiStreamingAdapter();
    const code = { executableCode: { language: Language.PYTHON, code: "print(1)" } };
    const result = { codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output: "1\n" } };

    adapter.handleChunk(makeChunk({ parts: [code] }));
    const chunks = adapter.handleChunk(makeChunk({ parts: [result] }));

    expect(chunks).toEqual([
      {
        type: "provider-tool-complete",
        data: {
          index: 0,
          id: "resp_123:code_execution:0",
          name: "code_execution",
          result: { type: "success" },
          continuity: { provider: "gemini", parts: [code, result] },
        },
      },
    ]);
  });

  test("reports a failed outcome as an error", () => {
    const adapter = createGeminiStreamingAdapter();
    adapter.handleChunk(
      makeChunk({ parts: [{ executableCode: { language: Language.PYTHON, code: "1/0" } }] }),
    );
    const chunks = adapter.handleChunk(
      makeChunk({
        parts: [
          {
            codeExecutionResult: {
              outcome: Outcome.OUTCOME_FAILED,
              output: "ZeroDivisionError: division by zero",
            },
          },
        ],
      }),
    );

    const complete = chunks.find((chunk) => chunk.type === "provider-tool-complete");
    expect(complete?.type === "provider-tool-complete" ? complete.data.result : complete).toEqual({
      type: "error",
      error: { type: "OUTCOME_FAILED", message: "code_execution failed: OUTCOME_FAILED" },
    });
  });

  test("closes open text before the code part and starts fresh text after the result", () => {
    const adapter = createGeminiStreamingAdapter();
    adapter.handleChunk(makeChunk({ parts: [{ text: "Let me compute." }] }));
    const code = adapter.handleChunk(
      makeChunk({ parts: [{ executableCode: { language: Language.PYTHON, code: "print(1)" } }] }),
    );
    adapter.handleChunk(
      makeChunk({ parts: [{ codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output: "1" } }] }),
    );
    const text = adapter.handleChunk(makeChunk({ parts: [{ text: "It is 1." }] }));

    expect(code.map((chunk) => chunk.type)).toEqual([
      "text-complete",
      "provider-tool-start",
      "provider-tool-input",
    ]);
    expect(text.map((chunk) => chunk.type)).toEqual(["text-start", "text-delta"]);
    const delta = text.find((chunk) => chunk.type === "text-delta");
    expect(delta?.type === "text-delta" ? delta.data.index : delta).toBe(2);
  });
});

function replayFixture(path: string) {
  const adapter = createGeminiStreamingAdapter();
  const fixture = readFileSync(new URL(path, import.meta.url), "utf8");
  const chunks = [];
  const parts: Part[] = [];
  for (const line of fixture.split("\n")) {
    if (!line.trim()) continue;
    const response = JSON.parse(line) as GenerateContentResponse;
    parts.push(...(response.candidates?.[0]?.content?.parts ?? []));
    chunks.push(...adapter.handleChunk(response));
  }
  return { chunks, parts };
}
