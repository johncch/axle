import { describe, expect, test } from "vitest";
import { fromModelResponse } from "../../../src/providers/gemini/createGenerationRequest.js";
import { AxleStopReason } from "../../../src/providers/types.js";

describe("Gemini createGenerationRequest", () => {
  test("a signature-only part becomes a continuity-only thinking part", () => {
    const result = fromModelResponse(
      {
        responseId: "gemini-124",
        modelVersion: "gemini-3-flash-preview",
        candidates: [
          {
            content: {
              parts: [
                { text: "Summary.", thought: true },
                { text: "", thoughtSignature: "sig-only" },
                { text: "Answer" },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 },
      } as any,
      {},
    );

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.content).toEqual([
      { type: "thinking", summary: "Summary." },
      { type: "thinking", continuity: { provider: "gemini", thoughtSignature: "sig-only" } },
      { type: "text", text: "Answer" },
    ]);
  });

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
          cachedContentTokenCount: 4,
          thoughtsTokenCount: 2,
        },
      } as any,
      {},
    );

    expect(result.type).toBe("success");
    if (result.type !== "success") return;
    expect(result.finishReason).toBe(AxleStopReason.FunctionCall);
    expect(result.usage).toEqual({ in: 10, out: 5, cachedIn: 4, reasoningOut: 2 });
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
