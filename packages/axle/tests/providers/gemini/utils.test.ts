import { Language, Outcome, type Part } from "@google/genai";
import { describe, expect, test } from "vitest";
import { convertAxleMessagesToGemini } from "../../../src/providers/gemini/utils.js";

describe("convertAxleMessagesToGemini", () => {
  test("echoes signed thinking parts as they arrived, in source order", async () => {
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
        { text: "", thoughtSignature: "sig-only" },
        {
          functionCall: { id: "call_1", name: "add_numbers", args: { a: 17, b: 25 } },
          thoughtSignature: "sig-call",
        },
        { text: "Calling the tool." },
      ],
    });
  });
});

describe("convertAxleMessagesToGemini provider tools", () => {
  test("echoes a code execution's parts as they arrived, between the surrounding text", async () => {
    const codePart: Part = {
      executableCode: { language: Language.PYTHON, code: "print(5117)", id: "call_1" },
      thoughtSignature: "sig-code",
    };
    const resultPart: Part = {
      codeExecutionResult: { outcome: Outcome.OUTCOME_OK, output: "5117\n", id: "call_1" },
    };
    const contents = await convertAxleMessagesToGemini([
      { role: "user", content: "Sum the first 50 primes." },
      {
        role: "assistant",
        id: "prev",
        content: [
          {
            type: "provider-tool",
            id: "call_1",
            name: "code_execution",
            input: { type: "code", code: "print(5117)" },
            result: { type: "success" },
            continuity: { provider: "gemini", parts: [codePart, resultPart] },
          },
          { type: "text", text: "The sum is 5117." },
          { type: "thinking", continuity: { provider: "gemini", thoughtSignature: "sig-final" } },
        ],
      },
    ]);

    expect(contents[1]).toEqual({
      role: "model",
      parts: [
        codePart,
        resultPart,
        { text: "The sum is 5117." },
        { text: "", thoughtSignature: "sig-final" },
      ],
    });
  });

  test("skips a provider tool another provider ran", async () => {
    const contents = await convertAxleMessagesToGemini([
      {
        role: "assistant",
        id: "prev",
        content: [
          {
            type: "provider-tool",
            id: "ws_1",
            name: "web_search",
            continuity: {
              provider: "openai",
              item: {
                type: "web_search_call",
                id: "ws_1",
                status: "completed",
                action: { type: "search", query: "axle" },
              },
            },
          },
          { type: "text", text: "Found it." },
        ],
      },
    ]);

    expect(contents[0]).toEqual({ role: "model", parts: [{ text: "Found it." }] });
  });
});
