import { describe, expect, test } from "vitest";
import { ModelInfo, Models } from "../../src/models.js";

describe("model registry", () => {
  test("exposes string constants and metadata from one provider namespace", () => {
    expect(Models.OpenAI.GPT_5_5).toBe("openai/gpt-5.5");
    expect(ModelInfo[Models.OpenAI.GPT_5_5]).toMatchObject({
      contextWindow: 1_050_000,
      maxOutputTokens: 128_000,
    });
    expect(ModelInfo[Models.OpenAI.GPT_5_5].multimodal).toBe(true);
    expect(Models.Qwen.QWEN3_6_PLUS).toBe("qwen/qwen3.6-plus");
    expect(Models.Moonshot.KIMI_K2_6).toBe("moonshotai/kimi-k2.6");
    expect(Models.Moonshot.KIMI_K2_7_CODE).toBe("moonshotai/kimi-k2.7-code");
    expect(Models.ZAI.GLM_5_2).toBe("zai/glm-5.2");
  });
});
