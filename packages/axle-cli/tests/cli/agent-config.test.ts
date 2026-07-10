import type { Span } from "@fifthrevision/axle";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCliAgentConfig } from "../../src/cli/agent-config.js";
import type { ServiceConfig } from "../../src/cli/configs/schemas.js";
import { ProceduralMemory } from "../../src/memory/ProceduralMemory.js";

const tracer = {
  startSpan: vi.fn(),
  end: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setResult: vi.fn(),
} as unknown as Span;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCliAgentConfig", () => {
  test("creates an agent config from a CLI job config", async () => {
    const serviceConfig: ServiceConfig = {
      chatcompletions: {
        "base-url": "https://example.test/v1",
        model: "test-model",
      },
    };

    const { agentConfig, mcps } = await createCliAgentConfig(
      {
        provider: { type: "chatcompletions" },
        task: "Calculate something",
        tools: ["calculator"],
      },
      serviceConfig,
      tracer,
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
    expect(agentConfig.model).toBe("test-model");
    expect(agentConfig.tools?.map((tool) => tool.name)).toEqual(["calculator"]);
    expect(agentConfig.memory).toBeInstanceOf(ProceduralMemory);
    expect(mcps).toEqual([]);
  });

  test("resolves provider api keys from job env references", async () => {
    vi.stubEnv("AXLE_TEST_OPENAI_KEY", "openai-key");

    const { agentConfig } = await createCliAgentConfig(
      {
        provider: {
          type: "openai",
          apiKeyEnv: "AXLE_TEST_OPENAI_KEY",
          model: "openai/gpt-test",
        },
        task: "Run",
      },
      {},
      tracer,
    );

    expect(agentConfig.provider.name).toBe("OpenAI");
    expect(agentConfig.model).toBe("openai/gpt-test");
  });

  test("uses the CLI default model for first-party providers", async () => {
    const defaults = [
      [{ type: "openai", "api-key": "openai-key" }, "openai/gpt-5.4-mini"],
      [{ type: "anthropic", "api-key": "anthropic-key" }, "anthropic/claude-haiku-4-5"],
      [{ type: "gemini", "api-key": "gemini-key" }, "google/gemini-3.5-flash"],
    ] as const;

    for (const [provider, model] of defaults) {
      const { agentConfig } = await createCliAgentConfig(
        { provider, task: "Run" },
        {},
        tracer,
      );

      expect(agentConfig.model).toBe(model);
    }
  });
});
