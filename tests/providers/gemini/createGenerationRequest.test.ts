import { describe, expect, test } from "vitest";
import { fromModelResponse } from "../../../src/providers/gemini/createGenerationRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("Gemini createGenerationRequest", () => {
  test("preserves thought signatures on function-call parts", () => {
    const result = fromModelResponse(
      {
        responseId: "gemini-123",
        modelVersion: "gemini-3-flash-preview",
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: "call_123",
                    name: "add_numbers",
                    args: { a: 17, b: 25 },
                  },
                  thoughtSignature: "sig-123",
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          totalTokenCount: 15,
        },
      } as any,
      {},
    );

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
    expect(result.content).toEqual([
      {
        type: "tool-call",
        id: "call_123",
        name: "add_numbers",
        parameters: { a: 17, b: 25 },
        providerMetadata: { thoughtSignature: "sig-123" },
      },
    ]);
  });
});
