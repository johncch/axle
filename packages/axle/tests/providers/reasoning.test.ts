import { describe, expect, test } from "vitest";
import {
  ANTHROPIC_THINKING_BUDGET_MODELS,
  ANTHROPIC_GENERATE_MAX_TOKENS,
  getAnthropicStreamMaxTokens,
  toAnthropicThinking,
} from "../../src/providers/anthropic/utils.js";
import { LEGACY_REASONING_BUDGETS } from "../../src/providers/reasoning.js";
import { toReasoningEffort } from "../../src/providers/chatcompletions/utils.js";
import { toTogetherReasoning } from "../../src/providers/chatcompletions/vendors/together.js";
import { toGeminiThinkingConfig } from "../../src/providers/gemini/utils.js";
import { resolveFirstPartyModel } from "../../src/providers/model.js";
import { toOpenAIReasoning } from "../../src/providers/openai/utils.js";
import { resolveReasoning } from "../../src/providers/reasoning.js";

describe("reasoning translation", () => {
  describe("resolveReasoning", () => {
    test("omitted and default apply no override", () => {
      expect(resolveReasoning(undefined)).toBe("default");
      expect(resolveReasoning("default")).toBe("default");
    });
    test("on is medium effort", () => {
      expect(resolveReasoning("on")).toBe("medium");
    });
    test("off and explicit efforts pass through", () => {
      expect(resolveReasoning("off")).toBe("off");
      expect(resolveReasoning({ effort: "low" })).toBe("low");
      expect(resolveReasoning({ effort: "high" })).toBe("high");
    });
    test("the 0.30 boolean and unknown efforts throw instead of enabling thinking", () => {
      expect(() => resolveReasoning(true as never)).toThrow(TypeError);
      expect(() => resolveReasoning(false as never)).toThrow(TypeError);
      expect(() => resolveReasoning({ effort: "xhigh" } as never)).toThrow(TypeError);
    });
  });

  describe("Anthropic", () => {
    test("default → no field", () => {
      expect(toAnthropicThinking(undefined, "claude-opus-5")).toEqual({});
      expect(toAnthropicThinking("default", "claude-haiku-4-5")).toEqual({});
    });
    test("off → thinking disabled on every route", () => {
      expect(toAnthropicThinking("off", "claude-opus-5")).toEqual({
        thinking: { type: "disabled" },
      });
      expect(toAnthropicThinking("off", "claude-haiku-4-5")).toEqual({
        thinking: { type: "disabled" },
      });
    });
    test("on → adaptive thinking at medium effort on modern models", () => {
      expect(toAnthropicThinking("on", "claude-opus-4-8")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      });
    });
    test.each(["claude-opus-5", "claude-fable-5-1", "claude-sonnet-5", "claude-sonnet-4-6"])(
      "%s takes the adaptive route with named effort",
      (model) => {
        expect(toAnthropicThinking({ effort: "high" }, model)).toEqual({
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
        });
        expect(toAnthropicThinking({ effort: "low" }, model)).toEqual({
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
        });
      },
    );
    test("unknown and retired models take the adaptive route, never a legacy budget", () => {
      expect(toAnthropicThinking("on", "claude-opus-4-1")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      });
      expect(toAnthropicThinking("on", "claude-nova-7")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      });
      expect(toAnthropicThinking("on", "")).toEqual({
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      });
    });
    test.each([
      "claude-haiku-4-5",
      "claude-haiku-4-5-20251001",
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "Claude-Opus-4-5",
    ])("%s takes the legacy budget route", (model) => {
      expect(toAnthropicThinking({ effort: "low" }, model)).toEqual({
        thinking: { type: "enabled", budget_tokens: 2048 },
      });
      expect(toAnthropicThinking("on", model)).toEqual({
        thinking: { type: "enabled", budget_tokens: 8192 },
      });
      expect(toAnthropicThinking({ effort: "high" }, model)).toEqual({
        thinking: { type: "enabled", budget_tokens: 16384 },
      });
    });

    describe("implicit max_tokens", () => {
      test("stream() defaults to the registry's output ceiling, else 64,000", () => {
        expect(getAnthropicStreamMaxTokens("claude-haiku-4-5")).toBe(64000);
        expect(getAnthropicStreamMaxTokens("claude-fable-5-1")).toBe(128000);
        expect(getAnthropicStreamMaxTokens("claude-nova-7")).toBe(64000);
      });
      test("generate() defaults to the largest cap the SDK sends without streaming", () => {
        expect(ANTHROPIC_GENERATE_MAX_TOKENS).toBe(21000);
      });
      test("every legacy budget model's defaults exceed the high preset on both paths", () => {
        for (const registryId of ANTHROPIC_THINKING_BUDGET_MODELS) {
          const model = resolveFirstPartyModel(registryId, ["anthropic"]);
          expect(toAnthropicThinking({ effort: "high" }, model)).toEqual({
            thinking: { type: "enabled", budget_tokens: 16384 },
          });
          expect(getAnthropicStreamMaxTokens(model)).toBeGreaterThan(LEGACY_REASONING_BUDGETS.high);
        }
        expect(ANTHROPIC_GENERATE_MAX_TOKENS).toBeGreaterThan(LEGACY_REASONING_BUDGETS.high);
      });
    });
  });

  describe("OpenAI", () => {
    test("default → no field", () => {
      expect(toOpenAIReasoning(undefined)).toEqual({});
      expect(toOpenAIReasoning("default")).toEqual({});
    });
    test("off → effort: none", () => {
      expect(toOpenAIReasoning("off")).toEqual({ reasoning: { effort: "none" } });
    });
    test("on → effort: medium", () => {
      expect(toOpenAIReasoning("on")).toEqual({ reasoning: { effort: "medium" } });
    });
    test.each(["low", "medium", "high"] as const)("effort %s passes through", (effort) => {
      expect(toOpenAIReasoning({ effort })).toEqual({ reasoning: { effort } });
    });
  });

  describe("Gemini", () => {
    test("default → no field", () => {
      expect(toGeminiThinkingConfig(undefined, "gemini-3.5-flash-lite")).toEqual({});
      expect(toGeminiThinkingConfig("default", "gemini-2.5-flash")).toEqual({});
    });
    test("off → thinkingBudget 0 on every route", () => {
      expect(toGeminiThinkingConfig("off", "gemini-3.5-flash-lite")).toEqual({
        thinkingConfig: { thinkingBudget: 0 },
      });
      expect(toGeminiThinkingConfig("off", "gemini-2.5-pro")).toEqual({
        thinkingConfig: { thinkingBudget: 0 },
      });
      expect(toGeminiThinkingConfig("off", "gemini-flash-lite-latest")).toEqual({
        thinkingConfig: { thinkingBudget: 0 },
      });
    });
    test("on → medium thinking level with included thoughts", () => {
      expect(toGeminiThinkingConfig("on", "gemini-3.5-flash-lite")).toEqual({
        thinkingConfig: { thinkingLevel: "medium", includeThoughts: true },
      });
    });
    test.each([
      "gemini-3.1-pro-preview",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
      "gemini-4-flash",
      "gemini-2.0-flash",
    ])("%s takes the named-level route", (model) => {
      expect(toGeminiThinkingConfig({ effort: "high" }, model)).toEqual({
        thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
      });
      expect(toGeminiThinkingConfig({ effort: "low" }, model)).toEqual({
        thinkingConfig: { thinkingLevel: "low", includeThoughts: true },
      });
    });
    test.each(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "Gemini-2.5-Flash"])(
      "%s takes the legacy budget route",
      (model) => {
        expect(toGeminiThinkingConfig({ effort: "low" }, model)).toEqual({
          thinkingConfig: { thinkingBudget: 2048, includeThoughts: true },
        });
        expect(toGeminiThinkingConfig("on", model)).toEqual({
          thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
        });
        expect(toGeminiThinkingConfig({ effort: "high" }, model)).toEqual({
          thinkingConfig: { thinkingBudget: 16384, includeThoughts: true },
        });
      },
    );
  });

  describe("ChatCompletions", () => {
    test("default → no field", () => {
      expect(toReasoningEffort(undefined)).toEqual({});
      expect(toReasoningEffort("default")).toEqual({});
    });
    test("off → reasoning_effort: none", () => {
      expect(toReasoningEffort("off")).toEqual({ reasoning_effort: "none" });
    });
    test("on → reasoning_effort: medium", () => {
      expect(toReasoningEffort("on")).toEqual({ reasoning_effort: "medium" });
    });
    test.each(["low", "medium", "high"] as const)("effort %s passes through", (effort) => {
      expect(toReasoningEffort({ effort })).toEqual({ reasoning_effort: effort });
    });

    test("Together default → no field", () => {
      expect(toTogetherReasoning(undefined)).toEqual({});
    });
    test("Together off → reasoning disabled", () => {
      expect(toTogetherReasoning("off")).toEqual({ reasoning: { enabled: false } });
    });
    test("Together on and efforts → enabled plus reasoning_effort", () => {
      expect(toTogetherReasoning("on")).toEqual({
        reasoning: { enabled: true },
        reasoning_effort: "medium",
      });
      expect(toTogetherReasoning({ effort: "high" })).toEqual({
        reasoning: { enabled: true },
        reasoning_effort: "high",
      });
    });
  });
});
