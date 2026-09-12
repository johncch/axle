import type { Span } from "@fifthrevision/axle";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createCliAgentConfig,
  createDefaultAgentDefinition,
  resolveTarget,
} from "../../src/cli/agent-config.js";
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
      {},
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
      {},
      tracer,
    );

    expect(agentConfig.provider.name).toBe("OpenAI");
    expect(agentConfig.model).toBe("openai/gpt-test");
  });

  test("rejects jobs with no provider and no configured default", async () => {
    await expect(
      createCliAgentConfig({ model: "anthropic/claude-sonnet-5", task: "Run" }, {}, {}, tracer),
    ).rejects.toThrow(/No provider specified and no default provider configured/);
  });

  test("a model-only job runs on the default provider", async () => {
    const { agentConfig, definition } = await createCliAgentConfig(
      { model: "anthropic/claude-sonnet-5", task: "Run" },
      { defaults: { provider: "anthropic" } },
      { anthropic: { apiKey: "key" } },
      tracer,
    );

    expect(agentConfig.provider.name).toBe("anthropic");
    expect(agentConfig.model).toBe("anthropic/claude-sonnet-5");
    expect(definition.provider).toEqual({ type: "anthropic" });
  });

  test("a job can name a provider profile from cli.yaml", async () => {
    vi.stubEnv("GW_KEY", "gateway-key");

    const { agentConfig, definition } = await createCliAgentConfig(
      { provider: { name: "gw" }, model: "some/model", task: "Run" },
      {
        providers: {
          gw: {
            type: "chatcompletions",
            baseUrl: "https://gw.example.test/v1",
            apiKeyEnv: "GW_KEY",
          },
        },
      },
      {},
      tracer,
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
    expect(agentConfig.model).toBe("some/model");
    expect(definition.provider).toEqual({
      type: "chatcompletions",
      config: { baseUrl: "https://gw.example.test/v1", apiKeyEnv: "GW_KEY" },
    });
  });

  test("rejects a provider name that is neither profile nor built-in", async () => {
    await expect(
      createCliAgentConfig({ provider: { name: "bedrock" }, task: "Run" }, {}, {}, tracer),
    ).rejects.toThrow(/"bedrock" is not a provider profile/);
  });

  test("defaults.models resolves by provider name, profiles included", async () => {
    const { agentConfig } = await createCliAgentConfig(
      { provider: { name: "gw" }, task: "Run" },
      {
        providers: {
          gw: { type: "chatcompletions", baseUrl: "https://gw.example.test/v1" },
        },
        defaults: { models: { gw: "vendor/model-a" } },
      },
      {},
      tracer,
    );

    expect(agentConfig.model).toBe("vendor/model-a");
  });

  test("model falls back to the service config (*_MODEL) after defaults.models", async () => {
    const { agentConfig } = await createCliAgentConfig(
      { provider: { name: "anthropic" }, task: "Run" },
      { defaults: { models: { anthropic: "anthropic/from-defaults" } } },
      { anthropic: { apiKey: "key", model: "anthropic/from-env" } },
      tracer,
    );

    expect(agentConfig.model).toBe("anthropic/from-defaults");
  });

  test("no hardcoded model defaults: an unresolvable model is an error", async () => {
    await expect(
      createCliAgentConfig(
        { provider: { type: "anthropic", apiKey: "key" }, task: "Run" },
        {},
        {},
        tracer,
      ),
    ).rejects.toThrow(/No model resolved for provider anthropic/);
  });

  test("top-level model wins over the service config model", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "anthropic", apiKey: "anthropic-key" },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      {},
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
          reasoning: { effort: "low" },
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      {},
      {},
      tracer,
    );

    expect(agentConfig.system).toBe("You are terse.");
    expect(agentConfig.reasoning).toEqual({ effort: "low" });
    expect(agentConfig.temperature).toBe(0.2);
    expect(agentConfig.maxOutputTokens).toBe(2048);
  });
});

describe("createDefaultAgentDefinition", () => {
  test("builds a definition from cli.yaml defaults", () => {
    const definition = createDefaultAgentDefinition(
      {
        providers: {
          gw: { type: "chatcompletions", baseUrl: "https://gw.example.test/v1" },
        },
        defaults: { provider: "gw", models: { gw: "vendor/model-a" } },
      },
      {},
    );

    expect(definition.provider).toEqual({
      type: "chatcompletions",
      config: { baseUrl: "https://gw.example.test/v1" },
    });
    expect(definition.model).toBe("vendor/model-a");
  });

  test("errors without a default provider", () => {
    expect(() => createDefaultAgentDefinition({}, {})).toThrow(
      /No provider specified and no default provider configured/,
    );
  });
});

describe("resolveTarget provider name", () => {
  test("a named profile resolves its own name for the defaults.models lookup", () => {
    const target = resolveTarget(
      { provider: { name: "work" } },
      { providers: { work: { type: "anthropic" } } },
      {},
    );

    expect(target.providerName).toBe("work");
    expect(target.provider.type).toBe("anthropic");
  });

  test("an inline endpoint's type doubles as its name", () => {
    const target = resolveTarget(
      { provider: { type: "chatcompletions", baseUrl: "http://localhost:1/v1" } },
      {},
      {},
    );

    expect(target.providerName).toBe("chatcompletions");
  });
});
