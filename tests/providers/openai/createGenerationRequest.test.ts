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
});
