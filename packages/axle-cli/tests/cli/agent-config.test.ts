import type { Span } from "@fifthrevision/axle";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCliAgentConfig } from "../../src/cli/agent-config.js";
import type { ServiceConfig } from "../../src/cli/configs/schemas.js";

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
        baseUrl: "https://example.test/v1",
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
    expect(agentConfig).not.toHaveProperty("memory");
    expect(mcps).toEqual([]);
  });

  test("resolves provider api keys from job env references", async () => {
    vi.stubEnv("AXLE_TEST_OPENAI_KEY", "openai-key");

    const { agentConfig } = await createCliAgentConfig(
      {
        provider: {
          type: "openai",
          apiKeyEnv: "AXLE_TEST_OPENAI_KEY",
        },
        model: "openai/gpt-test",
        task: "Run",
      },
      {},
      tracer,
    );

    expect(agentConfig.provider.name).toBe("OpenAI");
    expect(agentConfig.model).toBe("openai/gpt-test");
  });

  test("rejects jobs with no provider", async () => {
    await expect(
      createCliAgentConfig({ model: "anthropic/claude-sonnet-5", task: "Run" }, {}, tracer),
    ).rejects.toThrow(/does not specify a provider/);
  });

  test("top-level model wins over the service config model", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "anthropic", apiKey: "anthropic-key" },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      { anthropic: { apiKey: "ignored", model: "anthropic/claude-haiku-4-5" } },
      tracer,
    );

    expect(agentConfig.model).toBe("anthropic/claude-sonnet-5");
  });

  test("passes system and request options through to the agent config", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "anthropic", apiKey: "anthropic-key" },
        system: "You are terse.",
        request: {
          reasoning: true,
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
        task: "Run",
      },
      {},
      tracer,
    );

    expect(agentConfig.system).toBe("You are terse.");
    expect(agentConfig.reasoning).toBe(true);
    expect(agentConfig.temperature).toBe(0.2);
    expect(agentConfig.maxOutputTokens).toBe(2048);
  });

  test("uses the CLI default model for first-party providers", async () => {
    const defaults = [
      [{ type: "openai", apiKey: "openai-key" }, "openai/gpt-5.4-mini"],
      [{ type: "anthropic", apiKey: "anthropic-key" }, "anthropic/claude-haiku-4-5"],
      [{ type: "gemini", apiKey: "gemini-key" }, "google/gemini-3.5-flash"],
    ] as const;

    for (const [provider, model] of defaults) {
      const { agentConfig } = await createCliAgentConfig({ provider, task: "Run" }, {}, tracer);

      expect(agentConfig.model).toBe(model);
    }
  });
});
