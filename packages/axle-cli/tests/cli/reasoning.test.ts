import { ModelCatalog, type CatalogReasoningOption } from "@fifthrevision/axle";
import { describe, expect, it } from "vitest";
import type { Endpoint } from "../../src/cli/agent-config.js";
import { describeOnEffort, resolveRecipeReasoning } from "../../src/cli/reasoning.js";

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
  it("sends every setting but on as the recipe wrote it", () => {
    const catalog = catalogWith(levels("low", "high", "max"));

    for (const setting of [undefined, "default", "off", "medium", { effort: "xhigh" }] as const) {
      expect(resolveRecipeReasoning(anthropic, "claude-x", setting, catalog)).toEqual({ setting });
    }
  });

  it("turns on into the level the catalog suggests for the model", () => {
    expect(
      resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith(levels("low", "high"))),
    ).toEqual({
      setting: "high",
      on: { effort: "high", source: { kind: "catalog", id: "anthropic/claude-x" } },
    });
    expect(
      resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith(levels("low", "medium")))
        .setting,
    ).toBe("medium");
  });

  it("keeps on for a model whose thinking only switches", () => {
    const resolved = resolveRecipeReasoning(
      anthropic,
      "claude-x",
      "on",
      catalogWith([{ type: "toggle" }]),
    );

    expect(resolved.setting).toBe("on");
  });

  it("keeps the recipe's display when on is inside an object", () => {
    const resolved = resolveRecipeReasoning(
      anthropic,
      "claude-x",
      { effort: "on", display: "hidden" },
      catalogWith(levels("low", "high")),
    );

    expect(resolved.setting).toEqual({ effort: "high", display: "hidden" });
  });

  it("assumes medium when the catalog cannot suggest a level", () => {
    const assumed = { setting: "medium", on: { effort: "medium", source: { kind: "assumed" } } };

    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", undefined)).toEqual(assumed);
    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith(undefined))).toEqual(
      assumed,
    );
    expect(resolveRecipeReasoning(anthropic, "claude-x", "on", catalogWith([]))).toEqual(assumed);
    expect(
      resolveRecipeReasoning(anthropic, "unlisted", "on", catalogWith(levels("high"))),
    ).toEqual(assumed);
  });
});

describe("describeOnEffort", () => {
  it("names the level and where it came from", () => {
    expect(
      describeOnEffort({ effort: "high", source: { kind: "catalog", id: "anthropic/claude-x" } }),
    ).toBe("Reasoning: on is high (models.dev (anthropic/claude-x))");
    expect(describeOnEffort({ effort: "medium", source: { kind: "assumed" } })).toBe(
      "Reasoning: on is medium (assumed)",
    );
  });
});
