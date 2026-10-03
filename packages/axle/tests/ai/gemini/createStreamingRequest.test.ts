import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import z from "zod";
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

  test("maps maxOutputTokens", async () => {
    const out = await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-2.0-flash",
        messages,
        runtime: {},
        maxOutputTokens: 1000,
      }),
    );
    expect(config()).toMatchObject({ maxOutputTokens: 1000 });
    expect(out.at(-1)?.type).toBe("complete");
  });

  test("asks for server-side tool invocations when provider tools join function tools", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-3-flash-preview",
        messages,
        runtime: {},
        tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
        providerTools: [{ type: "provider", name: "code_execution" }],
      }),
    );
    expect(config().tools).toEqual([
      expect.objectContaining({
        functionDeclarations: [expect.objectContaining({ name: "lookup" })],
      }),
      { codeExecution: {} },
    ]);
    expect(config().toolConfig).toEqual({ includeServerSideToolInvocations: true });
  });

  test("leaves tool config alone when only provider tools are present", async () => {
    await drain(
      createStreamingRequest({
        client: mockClient,
        model: "gemini-3-flash-preview",
        messages,
        runtime: {},
        providerTools: [{ type: "provider", name: "code_execution" }],
      }),
    );
    expect(config().tools).toEqual([{ codeExecution: {} }]);
    expect(config().toolConfig).toBeUndefined();
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
