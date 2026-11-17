import { ModelCatalog, type CatalogReasoningOption } from "@fifthrevision/axle";
import { describe, expect, it } from "vitest";
import type { Endpoint } from "../../src/cli/agent-config.js";
import { describeOn, resolveRecipeReasoning } from "../../src/cli/reasoning.js";

const anthropic: Endpoint = { kind: "preset", preset: "anthropic", config: {} };

function catalogWith(reasoningOptions: CatalogReasoningOption[] | undefined): ModelCatalog {
  return new ModelCatalog({
    version: 5,
    fetchedAt: "2026-11-17T00:00:00.000Z",
    etags: {},
    coverage: "all",
    models: {
      "anthropic/claude-x": {
        name: "Claude X",
        limit: { context: 1_000_000 },
        reasoning: true,
        toolCall: true,
        attachment: false,
        modalities: { input: ["text"], output: ["text"] },
      },
    },
    providers: {
      anthropic: { "claude-x": { canonical: "anthropic/claude-x", reasoningOptions } },
    },
  });
}

const levels = (...values: string[]): CatalogReasoningOption[] => [{ type: "effort", values }];

describe("resolveRecipeReasoning", () => {
  const catalog = catalogWith(levels("low", "high", "max"));

  it("turns the recipe's words into the settings they name", () => {
    const settingOf = (word: "default" | "off" | "medium" | "xhigh" | undefined) =>
      resolveRecipeReasoning(anthropic, "claude-x", word, catalog);

    expect(settingOf(undefined)).toEqual({ setting: undefined });
    expect(settingOf("default")).toEqual({ setting: "default" });
    expect(settingOf("off")).toEqual({ setting: { enabled: false } });
    expect(settingOf("medium")).toEqual({ setting: { effort: "medium" } });
    expect(settingOf("xhigh")).toEqual({ setting: { effort: "xhigh" } });
  });

  it("sends the object form as the recipe wrote it", () => {
    for (const setting of [
      { effort: "medium", display: "hidden" },
      { enabled: true },
      { enabled: false },
    ] as const) {
      expect(resolveRecipeReasoning(anthropic, "claude-x", setting, catalog)).toEqual({ setting });
    }
  });

  it("turns on into the effort the catalog suggests for the model", () => {
    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", catalog)).toEqual({
      setting: { effort: "high" },
      on: { setting: { effort: "high" }, source: { kind: "catalog", id: "anthropic/claude-x" } },
    });
    expect(
      resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith(levels("low", "medium")))
        .setting,
    ).toEqual({ effort: "medium" });
  });

  it("turns on into the switch for a model whose thinking only switches", () => {
    const resolved = resolveRecipeReasoning(
      anthropic,
      "claude-x",
      "on",
      catalogWith([{ type: "toggle" }]),
    );

    expect(resolved.setting).toEqual({ enabled: true });
  });

  it("assumes medium when the catalog cannot suggest a setting", () => {
    const assumed = {
      setting: { effort: "medium" },
      on: { setting: { effort: "medium" }, source: { kind: "assumed" } },
    };

    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", undefined)).toEqual(assumed);
    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith(undefined))).toEqual(
      assumed,
    );
    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith([]))).toEqual(assumed);
    expect(resolveRecipeReasoning(anthropic, "unlisted", "on", catalog)).toEqual(assumed);
  });
});

describe("describeOn", () => {
  it("names the pick and where it came from", () => {
    expect(
      describeOn({
        setting: { effort: "high" },
        source: { kind: "catalog", id: "anthropic/claude-x" },
      }),
    ).toBe("Reasoning: on is high (models.dev (anthropic/claude-x))");
    expect(
      describeOn({
        setting: { enabled: true },
        source: { kind: "catalog", id: "togetherai/zai-org/GLM-5.1" },
      }),
    ).toBe("Reasoning: on is the model's switch (models.dev (togetherai/zai-org/GLM-5.1))");
    expect(describeOn({ setting: { effort: "medium" }, source: { kind: "assumed" } })).toBe(
      "Reasoning: on is medium (assumed)",
    );
  });
});
