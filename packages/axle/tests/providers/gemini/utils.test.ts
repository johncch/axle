import { describe, expect, test } from "vitest";
import { convertAxleMessagesToGemini } from "../../../src/providers/gemini/utils.js";

describe("convertAxleMessagesToGemini", () => {
  test("echoes thinking parts that carry a Gemini signature, in source order", async () => {
    const contents = await convertAxleMessagesToGemini([
      { role: "user", content: "Add 17 and 25." },
      {
        role: "assistant",
        id: "prev",
        content: [
          {
            type: "thinking",
            summary: "Simple addition.",
            continuity: { provider: "gemini", thoughtSignature: "sig-thought" },
          },
          { type: "thinking", continuity: { provider: "gemini", thoughtSignature: "sig-only" } },
          {
            type: "thinking",
            summary: "Not ours",
            continuity: { provider: "anthropic", signature: "x" },
          },
          { type: "thinking", summary: "No signature" },
          {
            type: "tool-call",
            id: "call_1",
            name: "add_numbers",
            parameters: { a: 17, b: 25 },
            providerMetadata: { thoughtSignature: "sig-call" },
          },
          { type: "text", text: "Calling the tool." },
        ],
      },
    ]);

    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        { thought: true, text: "Simple addition.", thoughtSignature: "sig-thought" },
        { thought: true, text: "", thoughtSignature: "sig-only" },
        {
          functionCall: { id: "call_1", name: "add_numbers", args: { a: 17, b: 25 } },
          thoughtSignature: "sig-call",
        },
        { text: "Calling the tool." },
      ],
    });
  });
});
