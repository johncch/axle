import { AuthenticationError as AnthropicAuthenticationError } from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { AuthenticationError as OpenAIAuthenticationError, RateLimitError } from "openai";
import { afterEach, expect, test, vi } from "vitest";
import { createStreamingRequest as anthropic } from "../../src/providers/anthropic/createStreamingRequest.js";
import { createStreamingRequest as chat } from "../../src/providers/chatcompletions/createStreamingRequest.js";
import { createStreamingRequest as gemini } from "../../src/providers/gemini/createStreamingRequest.js";
import { generate } from "../../src/providers/generate.js";
import { createStreamingRequest as openai } from "../../src/providers/openai/createStreamingRequest.js";
import type { AIProvider } from "../../src/providers/types.js";

const messages = [{ role: "user" as const, content: "hello" }];
const adapters = { openai, anthropic, gemini };

function sdkProvider(name: keyof typeof adapters, error: Error): AIProvider {
  const invoke = vi.fn(() => {
    throw error;
  });
  const clients = {
    openai: { responses: { stream: invoke } },
    anthropic: { messages: { create: invoke } },
    gemini: { models: { generateContentStream: invoke } },
  };
  return {
    name,
    createStreamingRequest: (model, params) =>
      (adapters[name] as (params: any) => ReturnType<typeof openai>)({
        ...params,
        model,
        client: clients[name],
      }),
  };
}

function chatProvider(status: number, body: string): AIProvider {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
  return {
    name: "chat",
    createStreamingRequest: (model, params) =>
      chat({ ...params, model, baseUrl: "https://example.test", maxRetries: 0 }),
  };
}

afterEach(() => vi.unstubAllGlobals());

const geminiBody = (reason: string, message: string) =>
  JSON.stringify({
    error: {
      code: 400,
      message,
      status: "INVALID_ARGUMENT",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }],
    },
  });

const rejected: Array<[string, () => AIProvider, number]> = [
  [
    "anthropic",
    () =>
      sdkProvider(
        "anthropic",
        new AnthropicAuthenticationError(
          401,
          { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
          undefined,
          new Headers(),
        ),
      ),
    401,
  ],
  [
    "openai",
    () =>
      sdkProvider(
        "openai",
        new OpenAIAuthenticationError(
          401,
          { message: "Incorrect API key provided", type: "invalid_request_error" },
          undefined,
          new Headers(),
        ),
      ),
    401,
  ],
  [
    "gemini",
    () =>
      sdkProvider(
        "gemini",
        new GeminiApiError({
          status: 400,
          message: geminiBody("API_KEY_INVALID", "API key not valid. Please pass a valid API key."),
        }),
      ),
    400,
  ],
  [
    "chatCompletions",
    () => chatProvider(401, '{"error":{"message":"No auth credentials found"}}'),
    401,
  ],
];

test.each(rejected)("%s reports a rejected key as authentication", async (_, make, status) => {
  const result = await generate({ provider: make(), model: "test", messages });
  expect(result).toMatchObject({
    ok: false,
    error: { kind: "model", type: "authentication", status },
  });
});

const notRejected: Array<[string, () => AIProvider, string, number]> = [
  [
    "openai rate limit",
    () =>
      sdkProvider(
        "openai",
        new RateLimitError(429, { message: "slow down" }, undefined, new Headers()),
      ),
    "Error",
    429,
  ],
  [
    "gemini bad request",
    () =>
      sdkProvider(
        "gemini",
        new GeminiApiError({
          status: 400,
          message: geminiBody("INVALID_ARGUMENT", "Unknown name \"foo\" at 'generation_config'"),
        }),
      ),
    "ApiError",
    400,
  ],
  ["chatCompletions server error", () => chatProvider(500, "upstream down"), "500", 500],
];

test.each(notRejected)("%s is not authentication", async (_, make, type, status) => {
  const result = await generate({ provider: make(), model: "test", messages });
  expect(result).toMatchObject({ ok: false, error: { kind: "model", type, status } });
});
