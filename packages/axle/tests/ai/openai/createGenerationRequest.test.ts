import OpenAI from "openai";
import { Response } from "openai/resources/responses/responses.js";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import z from "zod";
import { AxleAbortError } from "../../../src/errors/AxleAbortError.js";
import { createGenerationRequest } from "../../../src/providers/openai/createGenerationRequest.js";

const MODEL = "gpt-5.4-mini";

describe("createGenerationRequest (OpenAI)", () => {
  let mockClient: OpenAI;
  let mockCreate: Mock;

  beforeEach(() => {
    mockCreate = vi.fn() as any;
    mockClient = {
      responses: {
        create: mockCreate,
      },
    } as any;
  });

  test("throws AxleAbortError before calling the SDK when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("pre-aborted");

    await expect(
      createGenerationRequest({
        client: mockClient,
        model: MODEL,
        messages: [{ role: "user", content: "Hello" }],
        runtime: {},
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AxleAbortError);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("passes signal to the SDK request", async () => {
    const controller = new AbortController();
    (mockCreate.mockResolvedValue as any)(makeTextResponse("Hello"));

    await createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      runtime: {},
      signal: controller.signal,
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
  });

  test("maps cache and reasoning usage details", async () => {
    const response = makeTextResponse("Hello") as any;
    response.usage.input_tokens_details = { cached_tokens: 7 };
    response.usage.output_tokens_details = { reasoning_tokens: 3 };
    mockCreate.mockResolvedValue(response);

    const result = await createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      runtime: {},
    });

    expect(result.type).toBe("success");
    expect(result.usage).toEqual({ in: 10, out: 20, cachedIn: 7, reasoningOut: 3 });
  });

  test("maps normalized options and lets providerOptions override", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("Hello"));

    await createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      runtime: {},
      reasoning: true,
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 100,
      providerOptions: { max_output_tokens: 200, reasoning: { effort: "medium" } },
    });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      temperature: 0.5,
      top_p: 0.9,
      max_output_tokens: 200,
      reasoning: { effort: "medium" },
    });
  });

  test("maps named function and provider tool choices", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("Hello"));

    await createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      runtime: {},
      tools: [{ name: "lookup", description: "Lookup", schema: z.object({ q: z.string() }) }],
      providerTools: [{ type: "provider", name: "web_search" }],
      toolChoice: { type: "tool", name: "web_search" },
      parallelToolCalls: false,
    });

    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      tools: expect.arrayContaining([
        expect.objectContaining({ type: "function", name: "lookup" }),
        expect.objectContaining({ type: "web_search_preview" }),
      ]),
      tool_choice: { type: "web_search_preview" },
      parallel_tool_calls: false,
    });
  });

  test("throws AxleAbortError when aborted during an in-flight SDK request", async () => {
    const controller = new AbortController();
    mockCreate.mockImplementation(() => new Promise(() => {}));

    const pending = createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      runtime: {},
      signal: controller.signal,
    });

    const reason = { type: "timeout" };
    controller.abort(reason);

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      reason,
    });
  });
});

function makeTextResponse(text: string): Response {
  return {
    id: "resp_123",
    created_at: 1234567890,
    output_text: text,
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    model: MODEL,
    object: "response",
    output: [
      {
        type: "message",
        id: "msg_123",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
            annotations: [],
          },
        ],
      },
    ],
    status: "completed",
    parallel_tool_calls: false,
    temperature: null,
    tool_choice: "auto",
    tools: [],
    top_p: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    },
  } as unknown as Response;
}
