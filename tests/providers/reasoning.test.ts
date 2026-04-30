import { describe, expect, test } from "vitest";
import { toAnthropicThinking } from "../../src/providers/anthropic/utils.js";
import { toReasoningEffort } from "../../src/providers/chatcompletions/utils.js";
import { toGeminiThinkingConfig } from "../../src/providers/gemini/utils.js";
import { toOpenAIReasoning } from "../../src/providers/openai/utils.js";

describe("reasoning translation", () => {
  describe("Anthropic", () => {
    test("undefined → no field", () => {
      expect(toAnthropicThinking(undefined)).toEqual({});
    });
    test("true → enabled with budget", () => {
      expect(toAnthropicThinking(true)).toEqual({
        thinking: { type: "enabled", budget_tokens: 8192 },
      });
    });
    test("false → no field (Anthropic defaults off)", () => {
      expect(toAnthropicThinking(false)).toEqual({});
    });
  });

  describe("OpenAI", () => {
    test("undefined → no field", () => {
      expect(toOpenAIReasoning(undefined)).toEqual({});
    });
    test("true → effort: high", () => {
      expect(toOpenAIReasoning(true)).toEqual({ reasoning: { effort: "high" } });
    });
    test("false → effort: minimal", () => {
      expect(toOpenAIReasoning(false)).toEqual({ reasoning: { effort: "minimal" } });
    });
  });

  describe("Gemini", () => {
    test("undefined → no field", () => {
      expect(toGeminiThinkingConfig(undefined)).toEqual({});
    });
    test("true → thinkingBudget 8192 with includeThoughts", () => {
      expect(toGeminiThinkingConfig(true)).toEqual({
        thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
      });
    });
    test("false → thinkingBudget 0", () => {
      expect(toGeminiThinkingConfig(false)).toEqual({ thinkingConfig: { thinkingBudget: 0 } });
    });
  });

  describe("ChatCompletions", () => {
    test("undefined → no field", () => {
      expect(toReasoningEffort(undefined)).toEqual({});
    });
    test("true → reasoning_effort: high", () => {
      expect(toReasoningEffort(true)).toEqual({ reasoning_effort: "high" });
    });
    test("false → reasoning_effort: minimal", () => {
      expect(toReasoningEffort(false)).toEqual({ reasoning_effort: "minimal" });
    });
  });
});
