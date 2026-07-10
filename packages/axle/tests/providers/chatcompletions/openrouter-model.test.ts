import { describe, expect, test } from "vitest";
import { Models } from "../../../src/models.js";
import { resolveChatCompletionsModel } from "../../../src/providers/chatcompletions/utils.js";
import { resolveOpenRouterModel } from "../../../src/providers/chatcompletions/vendors/openrouter/index.js";

describe("OpenRouter model resolution", () => {
  test("translates a publisher identity to OpenRouter's diverging slug", () => {
    expect(resolveOpenRouterModel(Models.ZAI.GLM_5_2)).toBe("z-ai/glm-5.2");
    expect(resolveOpenRouterModel(Models.MiniMax.MINIMAX_M3)).toBe("minimax/minimax-m3");
  });

  test("passes through identities that already match OpenRouter's slug", () => {
    expect(resolveOpenRouterModel(Models.DeepSeek.DEEPSEEK_V4_PRO)).toBe("deepseek/deepseek-v4-pro");
    expect(resolveOpenRouterModel(Models.Qwen.QWEN3_7_MAX)).toBe("qwen/qwen3.7-max");
  });

  test("passes through an id already in OpenRouter form so raw slugs still work", () => {
    expect(resolveOpenRouterModel("z-ai/glm-5.2")).toBe("z-ai/glm-5.2");
    expect(resolveOpenRouterModel("anything/unknown")).toBe("anything/unknown");
  });

  test("only the openrouter vendor rewrites; others send identity unchanged", () => {
    expect(resolveChatCompletionsModel(Models.ZAI.GLM_5_2, "openrouter")).toBe("z-ai/glm-5.2");
    expect(resolveChatCompletionsModel(Models.ZAI.GLM_5_2, "together")).toBe(Models.ZAI.GLM_5_2);
    expect(resolveChatCompletionsModel(Models.ZAI.GLM_5_2, undefined)).toBe(Models.ZAI.GLM_5_2);
  });
});
