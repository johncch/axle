import { describe, expect, test } from "vitest";
import { fromModelResponse } from "../../../src/providers/openai/createGenerationRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("OpenAI createGenerationRequest", () => {
  test("marks function_call output as a function-call stop", () => {
    const result = fromModelResponse({
      id: "resp_123",
      model: "gpt-5.4-mini",
      output: [
        {
          type: "function_call",
          id: "fc_123",
          call_id: "call_123",
          name: "add_numbers",
          arguments: '{"a":17,"b":25}',
        },
      ],
      output_text: "",
      usage: { input_tokens: 10, output_tokens: 5 },
    } as any);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
    expect(result.content).toEqual([
      {
        type: "tool-call",
        id: "call_123",
        name: "add_numbers",
        parameters: { a: 17, b: 25 },
      },
    ]);
  });

  test("preserves output text citations", () => {
    const result = fromModelResponse({
      id: "resp_123",
      model: "gpt-5.4-mini",
      output: [
        {
          type: "message",
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "OpenAI announced new models.",
              annotations: [
                {
                  type: "url_citation",
                  start_index: 0,
                  end_index: 6,
                  title: "OpenAI",
                  url: "https://openai.com",
                },
              ],
            },
          ],
        },
      ],
      output_text: "OpenAI announced new models.",
      usage: { input_tokens: 10, output_tokens: 5 },
    } as any);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.content[0]).toEqual({
      type: "text",
      text: "OpenAI announced new models.",
      citations: [
        {
          source: { type: "web", title: "OpenAI", url: "https://openai.com" },
          outputSpan: { start: 0, end: 6 },
          providerMetadata: { type: "url_citation" },
        },
      ],
    });
  });

  test("preserves reasoning summary and encrypted continuity", () => {
    const result = fromModelResponse({
      id: "resp_123",
      model: "gpt-5.4-mini",
      output: [
        {
          type: "reasoning",
          id: "rs_123",
          summary: [{ type: "summary_text", text: "Checked the constraints." }],
          encrypted_content: "encrypted-reasoning",
        },
      ],
      output_text: "",
      usage: { input_tokens: 10, output_tokens: 5 },
    } as any);

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.content[0]).toEqual({
      type: "thinking",
      id: "rs_123",
      summary: "Checked the constraints.",
      continuity: { provider: "openai", encrypted: "encrypted-reasoning" },
    });
  });
});
