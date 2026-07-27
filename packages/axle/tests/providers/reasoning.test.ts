import { describe, expect, test } from "vitest";
import { toAnthropicThinking } from "../../src/providers/anthropic/utils.js";
import { toReasoningEffort } from "../../src/providers/chatcompletions/utils.js";
import { toTogetherReasoning } from "../../src/providers/chatcompletions/vendors/together.js";
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
    test("true with Opus 4.8 → adaptive thinking with high effort", () => {
      expect(toAnthropicThinking(true, "claude-opus-4-8")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });
    });
    test("true with Opus 4.7 → adaptive thinking with high effort", () => {
      expect(toAnthropicThinking(true, "claude-opus-4-7")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });
    });
    test("true with Sonnet 4.6 → adaptive thinking with high effort", () => {
      expect(toAnthropicThinking(true, "claude-sonnet-4-6")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      });
    });
    test("true with Opus 4.5 → legacy enabled thinking budget", () => {
      expect(toAnthropicThinking(true, "claude-opus-4-5-20251101")).toEqual({
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
    test("false → effort: none", () => {
      expect(toOpenAIReasoning(false)).toEqual({ reasoning: { effort: "none" } });
    });
  });

  describe("Gemini", () => {
    test("undefined → no field", () => {
      expect(toGeminiThinkingConfig(undefined, "gemini-3.5-flash-lite")).toEqual({});
    });
    test("Gemini 3 true → high thinking with included thoughts", () => {
      expect(toGeminiThinkingConfig(true, "gemini-3.5-flash-lite")).toEqual({
        thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
      });
    });
    test("Gemini 3 false → minimal thinking", () => {
      expect(toGeminiThinkingConfig(false, "gemini-3.5-flash-lite")).toEqual({
        thinkingConfig: { thinkingLevel: "minimal" },
      });
    });
    test("Gemini 3 Pro false → low thinking", () => {
      expect(toGeminiThinkingConfig(false, "gemini-3.1-pro-preview")).toEqual({
        thinkingConfig: { thinkingLevel: "low" },
      });
    });
    test("Gemini 2.5 true → thinkingBudget 8192 with included thoughts", () => {
      expect(toGeminiThinkingConfig(true, "gemini-2.5-flash")).toEqual({
        thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
      });
    });
    test("Gemini 2.5 Flash false → thinkingBudget 0", () => {
      expect(toGeminiThinkingConfig(false, "gemini-2.5-flash")).toEqual({
        thinkingConfig: { thinkingBudget: 0 },
      });
    });
    test("Gemini 2.5 Pro false → minimum thinking budget", () => {
      expect(toGeminiThinkingConfig(false, "gemini-2.5-pro")).toEqual({
        thinkingConfig: { thinkingBudget: 128 },
      });
    });
    test("models without thinking controls omit the field", () => {
      expect(toGeminiThinkingConfig(true, "gemini-2.0-flash")).toEqual({});
      expect(toGeminiThinkingConfig(false, "gemini-2.0-flash")).toEqual({});
    });
  });

  describe("ChatCompletions", () => {
    test("undefined → no field", () => {
      expect(toReasoningEffort(undefined)).toEqual({});
    });
    test("true → reasoning_effort: high", () => {
      expect(toReasoningEffort(true)).toEqual({ reasoning_effort: "high" });
    });
    test("false → reasoning_effort: none", () => {
      expect(toReasoningEffort(false)).toEqual({ reasoning_effort: "none" });
    });

    test("Together true → reasoning enabled", () => {
      expect(toTogetherReasoning(true)).toEqual({
        reasoning: { enabled: true },
      });
    });

    test("Together false → reasoning disabled", () => {
      expect(toTogetherReasoning(false)).toEqual({
        reasoning: { enabled: false },
      });
    });

    test("Together undefined → no field", () => {
      expect(toTogetherReasoning(undefined)).toEqual({});
    });
  });
});
