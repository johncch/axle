import type { AgentDefinition, Skill, Span } from "@fifthrevision/axle";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createAgentDefinition,
  createCliAgentConfig,
  createDefaultAgentDefinition,
  resolveAgentDefinition,
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
        task: "Read something",
        tools: ["read-file"],
      },
      {},
      serviceConfig,
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
    expect(agentConfig.model).toBe("test-model");
    expect(agentConfig.tools?.map((tool) => tool.name)).toEqual(["read-file"]);
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
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("OpenAI");
    expect(agentConfig.model).toBe("openai/gpt-test");
  });

  test("rejects jobs with no provider and no configured default", async () => {
    await expect(
      createCliAgentConfig(
        { model: "anthropic/claude-sonnet-5", task: "Run" },
        {},
        {},
        process.env,
        tracer,
        { trusted: true },
        [],
      ),
    ).rejects.toThrow(/No provider specified and no default provider configured/);
  });

  test("a model-only job runs on the default provider", async () => {
    const { agentConfig, definition } = await createCliAgentConfig(
      { model: "anthropic/claude-sonnet-5", task: "Run" },
      { defaults: { provider: "anthropic" } },
      { anthropic: { apiKey: "key" } },
      process.env,
      tracer,
      { trusted: true },
      [],
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
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
    expect(agentConfig.model).toBe("some/model");
    expect(definition.provider).toEqual({ type: "gw" });
  });

  test("an inline provider object is carried in the definition", async () => {
    const { definition } = await createCliAgentConfig(
      {
        provider: { type: "chatcompletions", baseUrl: "https://inline.example.test/v1" },
        model: "some/model",
        task: "Run",
      },
      {},
      {},
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(definition.provider).toEqual({
      type: "chatcompletions",
      config: { baseUrl: "https://inline.example.test/v1" },
    });
  });

  test("rejects a provider name that is neither profile nor built-in", async () => {
    await expect(
      createCliAgentConfig(
        { provider: { name: "bedrock" }, task: "Run" },
        {},
        {},
        process.env,
        tracer,
        { trusted: true },
        [],
      ),
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
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.model).toBe("vendor/model-a");
  });

  test("model falls back to the service config (*_MODEL) after defaults.models", async () => {
    const { agentConfig } = await createCliAgentConfig(
      { provider: { name: "anthropic" }, task: "Run" },
      { defaults: { models: { anthropic: "anthropic/from-defaults" } } },
      { anthropic: { apiKey: "key", model: "anthropic/from-env" } },
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.model).toBe("anthropic/from-defaults");
  });

  test("no hardcoded model defaults: an unresolvable model is an error", async () => {
    await expect(
      createCliAgentConfig(
        { provider: { type: "anthropic" }, task: "Run" },
        {},
        { anthropic: { apiKey: "key" } },
        process.env,
        tracer,
        { trusted: true },
        [],
      ),
    ).rejects.toThrow(/No model resolved for provider anthropic/);
  });

  test("a missing api key names the variable to set", async () => {
    await expect(
      createCliAgentConfig(
        { provider: { type: "anthropic" }, model: "anthropic/claude-sonnet-5", task: "Run" },
        {},
        {},
        process.env,
        tracer,
        { trusted: true },
        [],
      ),
    ).rejects.toThrow(
      "No API key for anthropic. Set ANTHROPIC_API_KEY in the environment or ~/.axle/credentials, or apiKeyEnv on the provider.",
    );
  });

  test("apiKeyEnv is resolved from the credentials it is given, not the process environment", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "openai", apiKeyEnv: "AXLE_TEST_FILE_ONLY_KEY" },
        model: "openai/gpt-test",
        task: "Run",
      },
      {},
      {},
      { AXLE_TEST_FILE_ONLY_KEY: "from-credentials-file" },
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("OpenAI");
  });

  test("a chatcompletions profile whose apiKeyEnv is unset fails by name", async () => {
    await expect(
      createCliAgentConfig(
        { provider: { name: "router" }, model: "some/model", task: "Run" },
        {
          providers: {
            router: {
              type: "chatcompletions",
              baseUrl: "https://router.example.test/v1",
              apiKeyEnv: "AXLE_TEST_MISSING_KEY",
            },
          },
        },
        {},
        {},
        tracer,
        { trusted: true },
        [],
      ),
    ).rejects.toThrow(
      "No API key for chatcompletions: apiKeyEnv names AXLE_TEST_MISSING_KEY, which is not set.",
    );
  });

  test("a chatcompletions endpoint with no key configured runs keyless", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "chatcompletions", baseUrl: "http://localhost:11434/v1" },
        model: "local/model",
        task: "Run",
      },
      {},
      {},
      {},
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
  });

  test("an unset apiKeyEnv variable is named", async () => {
    await expect(
      createCliAgentConfig(
        {
          provider: { type: "openai", apiKeyEnv: "AXLE_TEST_MISSING_KEY" },
          model: "openai/gpt-test",
          task: "Run",
        },
        {},
        {},
        process.env,
        tracer,
        { trusted: true },
        [],
      ),
    ).rejects.toThrow(
      "No API key for openai: apiKeyEnv names AXLE_TEST_MISSING_KEY, which is not set.",
    );
  });

  test("top-level model wins over the service config model", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "anthropic" },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      {},
      { anthropic: { apiKey: "key", model: "anthropic/claude-haiku-4-5" } },
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.model).toBe("anthropic/claude-sonnet-5");
  });

  test("passes system and request options through to the agent config", async () => {
    const { agentConfig } = await createCliAgentConfig(
      {
        provider: { type: "anthropic" },
        system: "You are terse.",
        request: {
          reasoning: { effort: "low" },
          parallelToolCalls: false,
          maxOutputTokens: 2048,
        },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      {},
      { anthropic: { apiKey: "key" } },
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.system).toBe("You are terse.");
    expect(agentConfig.reasoning).toEqual({ effort: "low" });
    expect(agentConfig.parallelToolCalls).toBe(false);
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

    expect(definition.provider).toEqual({ type: "gw" });
    expect(definition.model).toBe("vendor/model-a");
  });

  test("errors without a default provider", () => {
    expect(() => createDefaultAgentDefinition({}, {})).toThrow(
      /No provider specified and no default provider configured/,
    );
  });
});

describe("default tools", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const allTools = ["axle-help", "exec", "patch-file", "read-file", "write-file"];
  const definitionTools = (definition: { tools?: { name: string }[] }) =>
    definition.tools?.map((tool) => tool.name);
  const resolvedTools = async (definition: AgentDefinition, config = cliConfig) => {
    const { agentConfig } = await resolveAgentDefinition(
      definition,
      config,
      serviceConfig,
      process.env,
      tracer,
      { trusted: true },
      [],
    );
    return agentConfig.tools?.map((tool) => tool.name);
  };

  test("chat saves no tool list and gets every built-in tool at run time", async () => {
    const definition = createDefaultAgentDefinition(cliConfig, serviceConfig);
    expect(definitionTools(definition)).toBeUndefined();
    expect(await resolvedTools(definition)).toEqual(allTools);
  });

  test("a recipe without tools saves none and inherits the defaults at run time", async () => {
    const definition = createAgentDefinition({ task: "t" }, cliConfig, serviceConfig);
    expect(definitionTools(definition)).toBeUndefined();
    expect(await resolvedTools(definition)).toEqual(allTools);
  });

  test("a recipe's tools are saved and replace the defaults", async () => {
    const definition = createAgentDefinition({ task: "t", tools: ["exec"] }, cliConfig, {});
    expect(definitionTools(definition)).toEqual(["exec"]);
    expect(await resolvedTools(definition)).toEqual(["exec"]);
  });

  test("an empty tools list opts out", async () => {
    const definition = createAgentDefinition({ task: "t", tools: [] }, cliConfig, {});
    expect(definitionTools(definition)).toEqual([]);
    expect(await resolvedTools(definition)).toBeUndefined();
  });

  test("defaults.tools applies at run time, so a saved session follows a later change", async () => {
    const definition = createAgentDefinition({ task: "t" }, cliConfig, serviceConfig);
    const configured = { defaults: { provider: "anthropic", tools: ["read-file"] } };
    expect(await resolvedTools(definition, configured)).toEqual(["read-file"]);
  });

  test("an unknown recipe tool fails with the available names", () => {
    expect(() => createAgentDefinition({ task: "t", tools: ["foobar"] }, cliConfig, {})).toThrow(
      "Unknown tool: foobar. Available: axle-help, exec, patch-file, read-file, write-file",
    );
  });

  test("an unknown defaults.tools entry fails at run time", async () => {
    const configured = { defaults: { provider: "anthropic", tools: ["read-files"] } };
    const definition = createDefaultAgentDefinition(configured, serviceConfig);
    await expect(resolvedTools(definition, configured)).rejects.toThrow(
      "Unknown tool: read-files.",
    );
  });
});

describe("resolveAgentDefinition", () => {
  const definition: AgentDefinition = { version: 1, provider: { type: "gw" }, model: "m" };

  test("a named provider follows the current cli.yaml profile", async () => {
    const asChatCompletions = await resolveAgentDefinition(
      definition,
      { providers: { gw: { type: "chatcompletions", baseUrl: "https://gw.example.test/v1" } } },
      {},
      process.env,
      tracer,
      { trusted: true },
      [],
    );
    const asAnthropic = await resolveAgentDefinition(
      definition,
      { providers: { gw: { type: "anthropic", apiKey: "key" } } },
      {},
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(asChatCompletions.agentConfig.provider.name).toBe("ChatCompletions");
    expect(asAnthropic.agentConfig.provider.name).toBe("anthropic");
  });

  test("a named provider whose profile is gone fails by name", async () => {
    await expect(
      resolveAgentDefinition(definition, {}, {}, process.env, tracer, { trusted: true }, []),
    ).rejects.toThrow(/"gw" is not a provider profile/);
  });

  test("a definition carrying endpoint config resolves without cli.yaml", async () => {
    const { agentConfig } = await resolveAgentDefinition(
      {
        version: 1,
        provider: { type: "chatcompletions", config: { baseUrl: "https://old.example.test/v1" } },
        model: "m",
      },
      {},
      {},
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(agentConfig.provider.name).toBe("ChatCompletions");
  });
});

describe("resolveTarget provider name", () => {
  test("a named profile keeps its name in the definition and for the defaults.models lookup", () => {
    const target = resolveTarget(
      { provider: { name: "work" } },
      { providers: { work: { type: "anthropic" } } },
      {},
    );

    expect(target.providerName).toBe("work");
    expect(target.provider).toEqual({ type: "work" });
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

describe("skills", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const pdf: Skill = { name: "pdf", description: "PDFs.", instructions: "Use pdf." };

  test("every discovered skill loads, and none means no skills", async () => {
    const definition = createDefaultAgentDefinition(cliConfig, serviceConfig);
    const resolve = (skills: Skill[]) =>
      resolveAgentDefinition(
        definition,
        cliConfig,
        serviceConfig,
        process.env,
        tracer,
        { trusted: true },
        skills,
      );

    expect((await resolve([pdf])).agentConfig.skills).toEqual([pdf]);
    expect((await resolve([])).agentConfig.skills).toBeUndefined();
  });
});

describe("folder trust", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const untrusted = (definition: AgentDefinition, config = cliConfig) =>
    resolveAgentDefinition(
      definition,
      config,
      serviceConfig,
      process.env,
      tracer,
      { trusted: false },
      [],
    );
  const toolNames = (agentConfig: { tools?: { name: string }[] }) =>
    agentConfig.tools?.map((tool) => tool.name);

  test("an untrusted folder keeps only the tools that cannot act on it", async () => {
    const { agentConfig, droppedTools } = await untrusted(
      createDefaultAgentDefinition(cliConfig, serviceConfig),
    );

    expect(toolNames(agentConfig)).toEqual(["axle-help", "read-file"]);
    expect(droppedTools).toEqual(["exec", "patch-file", "write-file"]);
  });

  test("a recipe's own tools are gated the same way", async () => {
    const definition = createAgentDefinition(
      { task: "t", tools: ["exec", "read-file"] },
      cliConfig,
      {},
    );

    const { agentConfig, droppedTools } = await untrusted(definition);

    expect(toolNames(agentConfig)).toEqual(["read-file"]);
    expect(droppedTools).toEqual(["exec"]);
  });

  test("defaults.tools from cli.yaml is gated the same way", async () => {
    const configured = { defaults: { provider: "anthropic", tools: ["write-file"] } };

    const { agentConfig, droppedTools } = await untrusted(
      createAgentDefinition({ task: "t" }, cliConfig, serviceConfig),
      configured,
    );

    expect(agentConfig.tools).toBeUndefined();
    expect(droppedTools).toEqual(["write-file"]);
  });

  test("a trusted folder drops nothing", async () => {
    const { agentConfig, droppedTools } = await resolveAgentDefinition(
      createDefaultAgentDefinition(cliConfig, serviceConfig),
      cliConfig,
      serviceConfig,
      process.env,
      tracer,
      { trusted: true },
      [],
    );

    expect(toolNames(agentConfig)).toHaveLength(5);
    expect(droppedTools).toEqual([]);
  });
});
