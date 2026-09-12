import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { generate } from "../../src/providers/generate.js";
import { stream } from "../../src/providers/stream.js";
import { createStreamingRequest as openai } from "../../src/providers/openai/createStreamingRequest.js";
import { createStreamingRequest as anthropic } from "../../src/providers/anthropic/createStreamingRequest.js";
import { createStreamingRequest as gemini } from "../../src/providers/gemini/createStreamingRequest.js";
import { createStreamingRequest as chat } from "../../src/providers/chatcompletions/createStreamingRequest.js";
import { createStreamingAdapter } from "../../src/providers/openai/createStreamingAdapter.js";
import { createGeminiStreamingAdapter } from "../../src/providers/gemini/createStreamingAdapter.js";
import { normalizeProviderError } from "../../src/providers/utils.js";
import type { AIProvider, ProviderStreamParams } from "../../src/providers/types.js";
import { createTracerAndWriter } from "../scenarios/helpers/recording-writer.js";

const messages = [{ role: "user" as const, content: "hello" }];
const adapters = { openai, anthropic, gemini };
function providerFor(name: keyof typeof adapters, invoke: ReturnType<typeof vi.fn>): AIProvider {
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
afterEach(() => vi.unstubAllGlobals());

test.each(["openai", "anthropic", "gemini"] as const)(
  "%s retains SDK error type and raw payload through generate",
  async (name) => {
    const error = Object.assign(new Error("rate limited"), { name: "RateLimitError" });
    const result = await generate({
      provider: providerFor(
        name,
        vi.fn(() => {
          throw error;
        }),
      ),
      model: "test",
      messages,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "model",
        error: { error: { type: "RateLimitError", message: "rate limited" } },
      },
    });
    if (!result.ok && result.error.kind === "model") expect(result.error.error.raw).toBe(error);
  },
);

test.each([
  [{ error: { error: { type: "overloaded_error", message: "busy" } } }, "overloaded_error", "busy"],
  [
    { error: { type: "authentication_error", message: "bad key" } },
    "authentication_error",
    "bad key",
  ],
  [{ code: "invalid_api_key", message: "bad key" }, "invalid_api_key", "bad key"],
  [{ status: 429, message: "slow down" }, "429", "slow down"],
  [null, "Undetermined", "Unknown error occurred"],
  ["oops", "Undetermined", "oops"],
])("normalizes structured and unknown errors", (error, type, message) => {
  expect(normalizeProviderError(error)).toEqual({ type, message, raw: error });
});

test.each([401, 429])("Chat Completions retains HTTP %s", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad request", { status })));
  const provider: AIProvider = {
    name: "chat",
    createStreamingRequest: (model, params) =>
      chat({ ...params, model, baseUrl: "https://example.test", maxRetries: 0 }),
  };
  const result = await generate({ provider, model: "test", messages });
  expect(result).toMatchObject({
    ok: false,
    error: { error: { error: { type: String(status) }, raw: { status, body: "bad request" } } },
  });
});

test.each([
  ["openai", { stop: "stop" }],
  ["anthropic", { tools: [{ name: "invalid", schema: z.string(), description: "invalid" }] }],
  [
    "gemini",
    {
      tools: [
        {
          name: "invalid",
          schema: z.object({ value: z.transform(() => "x") }),
          description: "invalid",
        },
      ],
    },
  ],
] as const)("%s preparation failure resolves and closes spans", async (name, options) => {
  const invoke = vi.fn();
  const provider = providerFor(name, invoke);
  const { tracer, writer } = createTracerAndWriter();
  const wrapped: AIProvider = {
    name,
    createStreamingRequest: (model, params) =>
      provider.createStreamingRequest(model, { ...params, ...options } as ProviderStreamParams),
  };
  const result = await generate({
    provider: wrapped,
    model: "test",
    messages,
    span: tracer.startSpan("generate", { type: "workflow" }),
  });
  expect(result).toMatchObject({ ok: false, error: { kind: "model" } });
  expect(invoke).not.toHaveBeenCalled();
  expect([...writer.spans.values()].map((s) => s.status)).toEqual(["error", "error"]);
});

test.each(["generate", "stream"])(
  "%s preserves Gemini safety block diagnostics and usage",
  async (api) => {
    const raw = {
      responseId: "blocked",
      promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "unsafe" },
      usageMetadata: { promptTokenCount: 10 },
    };
    const provider: AIProvider = {
      name: "gemini",
      async *createStreamingRequest() {
        yield* createGeminiStreamingAdapter().handleChunk(raw as any);
      },
    };
    const options = { provider, model: "test", messages };
    const result = await (api === "generate" ? generate(options) : stream(options).final);
    expect(result).toMatchObject({
      ok: false,
      usage: { in: 10, out: 0 },
      error: {
        error: {
          error: { type: "Blocked", message: "Response blocked by Google AI: SAFETY, unsafe" },
        },
      },
    });
    if (!result.ok && result.error.kind === "model") expect(result.error.error.raw).toBe(raw);
  },
);

test("OpenAI failed response preserves code, message and usage", async () => {
  const raw = {
    type: "response.failed",
    response: {
      status: "failed",
      error: { code: "server_error", message: "upstream failed" },
      usage: { input_tokens: 12, output_tokens: 3 },
    },
  };
  const provider: AIProvider = {
    name: "openai",
    async *createStreamingRequest() {
      yield* createStreamingAdapter().handleEvent(raw as any);
    },
  };
  const result = await generate({ provider, model: "test", messages });
  expect(result).toMatchObject({
    ok: false,
    usage: { in: 12, out: 3 },
    error: { error: { error: { type: "server_error", message: "upstream failed" }, raw } },
  });
});

test("Gemini cancellation settles while waiting for the first chunk", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const invoke = vi.fn(
    ({ config }) =>
      new Promise((_resolve, reject) => {
        config.abortSignal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        started();
      }),
  );
  const controller = new AbortController();
  const pending = generate({
    provider: providerFor("gemini", invoke),
    model: "test",
    messages,
    signal: controller.signal,
  });
  await ready;
  controller.abort("cancelled");
  await expect(pending).rejects.toMatchObject({
    name: "AbortError",
    reason: "cancelled",
    messages: [],
    usage: { in: 0, out: 0 },
  });
});
