import OpenAI from "openai";
import { Response } from "openai/resources/responses/responses.js";
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
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
        context: {},
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
      context: {},
      signal: controller.signal,
    });

    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), { signal: controller.signal });
  });

  test("throws AxleAbortError when aborted during an in-flight SDK request", async () => {
    const controller = new AbortController();
    mockCreate.mockImplementation(() => new Promise(() => {}));

    const pending = createGenerationRequest({
      client: mockClient,
      model: MODEL,
      messages: [{ role: "user", content: "Hello" }],
      context: {},
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
