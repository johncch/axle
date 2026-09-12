import { describe, expect, test } from "vitest";
import {
  ANTHROPIC_THINKING_BUDGET_MODELS,
  ANTHROPIC_GENERATE_MAX_TOKENS,
  getAnthropicStreamMaxTokens,
  toAnthropicThinking,
} from "../../src/providers/anthropic/utils.js";
import { LEGACY_REASONING_BUDGETS } from "../../src/providers/reasoning.js";
import { toReasoningEffort } from "../../src/providers/chatcompletions/utils.js";
import { toOpenRouterReasoning } from "../../src/providers/chatcompletions/vendors/openrouter/index.js";
import { toTogetherReasoning } from "../../src/providers/chatcompletions/vendors/together.js";
import { toGeminiThinkingConfig } from "../../src/providers/gemini/utils.js";
import { resolveFirstPartyModel } from "../../src/providers/model.js";
import { toOpenAIReasoning } from "../../src/providers/openai/utils.js";
import { resolveReasoning, resolveReasoningDisplay } from "../../src/providers/reasoning.js";

describe("reasoning translation", () => {
  describe("resolveReasoning", () => {
    test("omitted and default apply no override", () => {
      expect(resolveReasoning(undefined)).toBe("default");
      expect(resolveReasoning("default")).toBe("default");
    });
    test("on is medium effort with visible thinking", () => {
      expect(resolveReasoning("on")).toEqual({ effort: "medium", display: "visible" });
    });
    test("off and explicit efforts pass through, display defaults to visible", () => {
      expect(resolveReasoning("off")).toBe("off");
      expect(resolveReasoning({ effort: "low" })).toEqual({ effort: "low", display: "visible" });
      expect(resolveReasoning({ effort: "high", display: "hidden" })).toEqual({
        effort: "high",
        display: "hidden",
      });
    });
    test("resolveReasoningDisplay is visible unless an enable says hidden", () => {
      expect(resolveReasoningDisplay(undefined)).toBe("visible");
      expect(resolveReasoningDisplay("off")).toBe("visible");
      expect(resolveReasoningDisplay("on")).toBe("visible");
      expect(resolveReasoningDisplay({ effort: "low", display: "hidden" })).toBe("hidden");
    });
    test("the 0.30 boolean, unknown efforts, and unknown displays throw", () => {
      expect(() => resolveReasoning(true as never)).toThrow(TypeError);
      expect(() => resolveReasoning(false as never)).toThrow(TypeError);
      expect(() => resolveReasoning({ effort: "xhigh" } as never)).toThrow(TypeError);
      expect(() => resolveReasoning({ effort: "low", display: "summary" } as never)).toThrow(
        TypeError,
      );
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
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
      });
    });
    test.each(["claude-opus-5", "claude-fable-5-1", "claude-sonnet-5", "claude-sonnet-4-6"])(
      "%s takes the adaptive route with named effort",
      (model) => {
        expect(toAnthropicThinking({ effort: "high" }, model)).toEqual({
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
        });
        expect(toAnthropicThinking({ effort: "low" }, model)).toEqual({
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "low" },
        });
      },
    );
    test("unknown and retired models take the adaptive route, never a legacy budget", () => {
      expect(toAnthropicThinking("on", "claude-opus-4-1")).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
      });
      expect(toAnthropicThinking("on", "claude-nova-7")).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: "medium" },
      });
      expect(toAnthropicThinking("on", "")).toEqual({
        thinking: { type: "adaptive", display: "summarized" },
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
        thinking: { type: "enabled", budget_tokens: 2048, display: "summarized" },
      });
      expect(toAnthropicThinking("on", model)).toEqual({
        thinking: { type: "enabled", budget_tokens: 8192, display: "summarized" },
      });
      expect(toAnthropicThinking({ effort: "high" }, model)).toEqual({
        thinking: { type: "enabled", budget_tokens: 16384, display: "summarized" },
      });
    });

    test("display hidden → display omitted on both routes", () => {
      expect(toAnthropicThinking({ effort: "high", display: "hidden" }, "claude-opus-5")).toEqual({
        thinking: { type: "adaptive", display: "omitted" },
        output_config: { effort: "high" },
      });
      expect(toAnthropicThinking({ effort: "low", display: "hidden" }, "claude-haiku-4-5")).toEqual(
        {
          thinking: { type: "enabled", budget_tokens: 2048, display: "omitted" },
        },
      );
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
            thinking: { type: "enabled", budget_tokens: 16384, display: "summarized" },
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
    test("on → effort: medium with auto summary", () => {
      expect(toOpenAIReasoning("on")).toEqual({
        reasoning: { effort: "medium", summary: "auto" },
      });
    });
    test.each(["low", "medium", "high"] as const)("effort %s passes through", (effort) => {
      expect(toOpenAIReasoning({ effort })).toEqual({ reasoning: { effort, summary: "auto" } });
    });
    test("display hidden → no summary field", () => {
      expect(toOpenAIReasoning({ effort: "high", display: "hidden" })).toEqual({
        reasoning: { effort: "high" },
      });
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
    test("display hidden → includeThoughts false on both routes", () => {
      expect(
        toGeminiThinkingConfig({ effort: "high", display: "hidden" }, "gemini-3.1-pro-preview"),
      ).toEqual({
        thinkingConfig: { thinkingLevel: "high", includeThoughts: false },
      });
      expect(
        toGeminiThinkingConfig({ effort: "low", display: "hidden" }, "gemini-2.5-flash"),
      ).toEqual({
        thinkingConfig: { thinkingBudget: 2048, includeThoughts: false },
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
    test("display has no field on generic endpoints and Together and is dropped", () => {
      expect(toReasoningEffort({ effort: "low", display: "hidden" })).toEqual({
        reasoning_effort: "low",
      });
      expect(toTogetherReasoning({ effort: "low", display: "hidden" })).toEqual({
        reasoning: { enabled: true },
        reasoning_effort: "low",
      });
    });

    test("OpenRouter maps display hidden to reasoning.exclude", () => {
      expect(toOpenRouterReasoning(undefined)).toEqual({});
      expect(toOpenRouterReasoning("off")).toEqual({ reasoning_effort: "none" });
      expect(toOpenRouterReasoning("on")).toEqual({ reasoning_effort: "medium" });
      expect(toOpenRouterReasoning({ effort: "low", display: "hidden" })).toEqual({
        reasoning_effort: "low",
        reasoning: { exclude: true },
      });
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
