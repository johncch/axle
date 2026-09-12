import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import { createStreamingRequest } from "../../../src/providers/gemini/createStreamingRequest.js";

async function* chunks() {
  yield {
    responseId: "resp_1",
    modelVersion: "gemini-2.0-flash",
    candidates: [
      { index: 0, content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" },
    ],
    usageMetadata: { promptTokenCount: 10, totalTokenCount: 30 },
  };
}

async function drain(source: AsyncGenerator<AnyStreamChunk, void, unknown>) {
  const out: AnyStreamChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

describe("createStreamingRequest (Gemini)", () => {
  let mockClient: GoogleGenAI;
  let mockStream: Mock;
  const messages = [{ role: "user" as const, content: "Hello" }];

  beforeEach(() => {
    mockStream = vi.fn().mockResolvedValue(chunks()) as any;
    mockClient = { models: { generateContentStream: mockStream } } as any;
  });

  const config = () => mockStream.mock.calls[0][0].config;

  test("maps maxOutputTokens, temperature, and topP", async () => {
    const out = await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages,
        runtime: {},
        maxOutputTokens: 1000,
        temperature: 0.7,
        topP: 0.9,
      }),
    );
    expect(config()).toMatchObject({ maxOutputTokens: 1000, temperature: 0.7, topP: 0.9 });
    expect(out.at(-1)?.type).toBe("complete");
  });

  test("converts stop to stopSequences", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages,
        runtime: {},
        stop: "STOP",
      }),
    );
    expect(config()).toMatchObject({ stopSequences: ["STOP"] });

    mockStream.mockResolvedValue(chunks());
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages,
        runtime: {},
        stop: ["A", "B"],
      }),
    );
    expect(mockStream.mock.calls[1][0].config).toMatchObject({ stopSequences: ["A", "B"] });
  });

  test("omits provider tools when toolChoice is none", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages,
        runtime: {},
        providerTools: [{ type: "provider", name: "web_search" }],
        toolChoice: "none",
      }),
    );
    expect(config().tools).toBeUndefined();
    expect(config().toolConfig).toEqual({
      functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
    });
  });
});
