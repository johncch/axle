import type { Skill, Span } from "@fifthrevision/axle";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RunTarget } from "../../src/cli/agent-config.js";
import { createCliAgentConfig, resolveTarget } from "../../src/cli/agent-config.js";
import type { Credentials } from "../../src/cli/configs/loaders.js";
import type {
  AgentRecipe,
  CliConfig,
  JobConfig,
  ServiceConfig,
} from "../../src/cli/configs/schemas.js";

type SessionTarget = Pick<RunTarget, "provider" | "model">;

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

/** The `-j` path: resolve the recipe's target, then build against it. */
async function fromRecipe(
  job: JobConfig,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  credentials: Credentials,
  trust = { trusted: true },
  skills: Skill[] = [],
) {
  const target = resolveTarget(job, cliConfig, serviceConfig);
  return createCliAgentConfig(
    target,
    job,
    cliConfig,
    serviceConfig,
    credentials,
    tracer,
    trust,
    skills,
  );
}

/** A resolved target against a recipe, as Phase B sees them. */
function fromTarget(
  target: SessionTarget,
  recipe: AgentRecipe,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig = {},
  trust = { trusted: true },
  skills: Skill[] = [],
) {
  return createCliAgentConfig(
    target,
    recipe,
    cliConfig,
    serviceConfig,
    process.env,
    tracer,
    trust,
    skills,
  );
}

describe("createCliAgentConfig", () => {
  test("creates an agent config from a CLI job config", async () => {
    const { agentConfig, mcps } = await fromRecipe(
      {
        provider: { protocol: "chatCompletions", baseUrl: "https://example.test/v1" },
        model: "test-model",
        task: "Read something",
        tools: ["read-file"],
      },
      {},
      {},
      process.env,
    );

    expect(agentConfig.provider.protocol).toBe("chatCompletions");
    expect(agentConfig.model).toBe("test-model");
    expect(agentConfig.tools?.map((tool) => tool.name)).toEqual(["read-file"]);
    expect(agentConfig).not.toHaveProperty("memory");
    expect(mcps).toEqual([]);
  });

  test("resolves provider api keys from job env references", async () => {
    vi.stubEnv("AXLE_TEST_OPENAI_KEY", "openai-key");

    const { agentConfig } = await fromRecipe(
      {
        provider: {
          protocol: "responses",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyEnv: "AXLE_TEST_OPENAI_KEY",
        },
        model: "openai/gpt-test",
        task: "Run",
      },
      {},
      {},
      process.env,
    );

    expect(agentConfig.provider.protocol).toBe("responses");
    expect(agentConfig.model).toBe("openai/gpt-test");
  });

  test("rejects jobs with no provider and no configured default", async () => {
    await expect(
      fromRecipe({ model: "anthropic/claude-sonnet-5", task: "Run" }, {}, {}, process.env),
    ).rejects.toThrow(/No provider specified and no default provider configured/);
  });

  test("a model-only job runs on the default provider", async () => {
    const { agentConfig } = await fromRecipe(
      { model: "anthropic/claude-sonnet-5", task: "Run" },
      { defaults: { provider: "anthropic" } },
      { anthropic: { apiKey: "key" } },
      process.env,
    );

    expect(agentConfig.provider.protocol).toBe("messages");
    expect(agentConfig.model).toBe("anthropic/claude-sonnet-5");
  });

  test("a job can name a provider profile from cli.yaml", async () => {
    vi.stubEnv("GW_KEY", "gateway-key");

    const { agentConfig } = await fromRecipe(
      { provider: { name: "gw" }, model: "some/model", task: "Run" },
      {
        providers: {
          gw: {
            protocol: "chatCompletions",
            baseUrl: "https://gw.example.test/v1",
            apiKeyEnv: "GW_KEY",
          },
        },
      },
      {},
      process.env,
    );

    expect(agentConfig.provider.protocol).toBe("chatCompletions");
    expect(agentConfig.model).toBe("some/model");
  });

  test("chatcompletions is not a provider name", async () => {
    await expect(
      fromRecipe(
        { provider: { name: "chatcompletions" }, model: "some/model", task: "Run" },
        {},
        {},
        {},
      ),
    ).rejects.toThrow(
      'Provider "chatcompletions" is not a preset (anthropic, openai, gemini, openrouter, together, bedrock) or a provider profile in cli.yaml.',
    );
  });

  test("a generic profile with no model names no model variable", async () => {
    await expect(
      fromRecipe(
        { provider: { name: "gw" }, task: "Run" },
        {
          providers: { gw: { protocol: "chatCompletions", baseUrl: "https://gw.example.test/v1" } },
        },
        {},
        {},
      ),
    ).rejects.toThrow(
      "No model resolved for provider gw. Add model: to the job, or set defaults.models in ~/.axle/cli.yaml.",
    );
  });

  test("rejects a provider name that is neither profile nor preset", async () => {
    await expect(
      fromRecipe({ provider: { name: "mystery" }, task: "Run" }, {}, {}, process.env),
    ).rejects.toThrow(/"mystery" is not a preset .* or a provider profile/);
  });

  test("bedrock needs a profile for its protocol and region", async () => {
    await expect(
      fromRecipe({ provider: { name: "bedrock" }, task: "Run" }, {}, {}, process.env),
    ).rejects.toThrow("bedrock needs a protocol and a region.");
  });

  test("a preset profile extends the preset of its name", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "anthropic" }, model: "claude-x", task: "Run" },
      { providers: { anthropic: { apiKeyEnv: "AXLE_TEST_WORK_KEY" } } },
      {},
      { AXLE_TEST_WORK_KEY: "work-key" },
    );

    expect(agentConfig.provider).toMatchObject({ protocol: "messages", id: "anthropic" });
  });

  test("a bedrock profile builds the protocol it names", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "bedrock" }, model: "openai.gpt-oss-20b", task: "Run" },
      { providers: { bedrock: { protocol: "responses", region: "us-east-1" } } },
      { bedrock: { apiKey: "key" } },
      {},
    );

    expect(agentConfig.provider).toMatchObject({ protocol: "responses", id: "amazon-bedrock" });
  });

  test("openrouter and together are presets with no profile", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "together" }, model: "m", task: "Run" },
      {},
      { together: { apiKey: "key" } },
      {},
    );

    expect(agentConfig.provider).toMatchObject({ protocol: "chatCompletions", id: "togetherai" });
  });

  test("a generic profile infers its id from the hostname", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "eu" }, model: "m", task: "Run" },
      {
        providers: {
          eu: { protocol: "chatCompletions", baseUrl: "https://eu.openrouter.ai/api/v1" },
        },
      },
      {},
      {},
    );

    expect(agentConfig.provider.id).toBe("openrouter");
  });

  test("a generic profile on an SDK protocol needs a key, so the SDK reads none from the environment", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "must-not-reach-the-proxy");

    await expect(
      fromRecipe(
        { provider: { name: "proxy" }, model: "m", task: "Run" },
        { providers: { proxy: { protocol: "messages", baseUrl: "https://proxy.test" } } },
        {},
        {},
      ),
    ).rejects.toThrow("No API key for proxy. Set apiKeyEnv on the provider.");
  });

  test("defaults.models resolves by provider name, profiles included", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "gw" }, task: "Run" },
      {
        providers: {
          gw: { protocol: "chatCompletions", baseUrl: "https://gw.example.test/v1" },
        },
        defaults: { models: { gw: "vendor/model-a" } },
      },
      {},
      process.env,
    );

    expect(agentConfig.model).toBe("vendor/model-a");
  });

  test("model falls back to the service config (*_MODEL) after defaults.models", async () => {
    const { agentConfig } = await fromRecipe(
      { provider: { name: "anthropic" }, task: "Run" },
      { defaults: { models: { anthropic: "anthropic/from-defaults" } } },
      { anthropic: { apiKey: "key", model: "anthropic/from-env" } },
      process.env,
    );

    expect(agentConfig.model).toBe("anthropic/from-defaults");
  });

  test("no hardcoded model defaults: an unresolvable model is an error", async () => {
    await expect(
      fromRecipe(
        { provider: { name: "anthropic" }, task: "Run" },
        {},
        { anthropic: { apiKey: "key" } },
        process.env,
      ),
    ).rejects.toThrow(/No model resolved for provider anthropic/);
  });

  test("a missing api key names the variable to set", async () => {
    await expect(
      fromRecipe(
        { provider: { name: "anthropic" }, model: "anthropic/claude-sonnet-5", task: "Run" },
        {},
        {},
        process.env,
      ),
    ).rejects.toThrow(
      "No API key for anthropic. Set ANTHROPIC_API_KEY in the environment or ~/.axle/credentials, or apiKeyEnv on the provider.",
    );
  });

  test("apiKeyEnv is resolved from the credentials it is given, not the process environment", async () => {
    const { agentConfig } = await fromRecipe(
      {
        provider: {
          protocol: "responses",
          baseUrl: "https://gateway.example.test/v1",
          apiKeyEnv: "AXLE_TEST_FILE_ONLY_KEY",
        },
        model: "openai/gpt-test",
        task: "Run",
      },
      {},
      {},
      { AXLE_TEST_FILE_ONLY_KEY: "from-credentials-file" },
    );

    expect(agentConfig.provider.protocol).toBe("responses");
  });

  test("a generic profile whose apiKeyEnv is unset fails by name", async () => {
    await expect(
      fromRecipe(
        { provider: { name: "router" }, model: "some/model", task: "Run" },
        {
          providers: {
            router: {
              protocol: "chatCompletions",
              baseUrl: "https://router.example.test/v1",
              apiKeyEnv: "AXLE_TEST_MISSING_KEY",
            },
          },
        },
        {},
        {},
      ),
    ).rejects.toThrow(
      "No API key for router: apiKeyEnv names AXLE_TEST_MISSING_KEY, which is not set.",
    );
  });

  test("a chatcompletions endpoint with no key configured runs keyless", async () => {
    const { agentConfig } = await fromRecipe(
      {
        provider: { protocol: "chatCompletions", baseUrl: "http://localhost:11434/v1" },
        model: "local/model",
        task: "Run",
      },
      {},
      {},
      {},
    );

    expect(agentConfig.provider.protocol).toBe("chatCompletions");
  });

  test("an unset apiKeyEnv variable is named", async () => {
    await expect(
      fromRecipe(
        {
          provider: {
            protocol: "responses",
            baseUrl: "https://gateway.example.test/v1",
            apiKeyEnv: "AXLE_TEST_MISSING_KEY",
          },
          model: "openai/gpt-test",
          task: "Run",
        },
        {},
        {},
        process.env,
      ),
    ).rejects.toThrow(
      "No API key for responses: apiKeyEnv names AXLE_TEST_MISSING_KEY, which is not set.",
    );
  });

  test("top-level model wins over the service config model", async () => {
    const { agentConfig } = await fromRecipe(
      {
        provider: { name: "anthropic" },
        model: "anthropic/claude-sonnet-5",
        task: "Run",
      },
      {},
      { anthropic: { apiKey: "key", model: "anthropic/claude-haiku-4-5" } },
      process.env,
    );

    expect(agentConfig.model).toBe("anthropic/claude-sonnet-5");
  });

  test("passes system and request options through to the agent config", async () => {
    const { agentConfig } = await fromRecipe(
      {
        provider: { name: "anthropic" },
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
    );

    expect(agentConfig.system).toBe("You are terse.");
    expect(agentConfig.reasoning).toEqual({ effort: "low" });
    expect(agentConfig.parallelToolCalls).toBe(false);
    expect(agentConfig.maxOutputTokens).toBe(2048);
  });
});

describe("default tools", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const allTools = ["axle-help", "exec", "patch-file", "read-file", "write-file"];
  const target: SessionTarget = { provider: { name: "anthropic" }, model: "anthropic/m" };
  const resolvedTools = async (recipe: AgentRecipe, config = cliConfig) => {
    const { agentConfig } = await fromTarget(target, recipe, config, serviceConfig);
    return agentConfig.tools?.map((tool) => tool.name);
  };

  test("chat gets every built-in tool", async () => {
    expect(await resolvedTools({})).toEqual(allTools);
  });

  test("a recipe without tools inherits the defaults", async () => {
    expect(await resolvedTools({})).toEqual(allTools);
  });

  test("a recipe's tools replace the defaults", async () => {
    expect(await resolvedTools({ tools: ["exec"] })).toEqual(["exec"]);
  });

  test("an empty tools list opts out", async () => {
    expect(await resolvedTools({ tools: [] })).toBeUndefined();
  });

  test("defaults.tools applies at run time, so a resumed chat follows a later change", async () => {
    const configured = { defaults: { provider: "anthropic", tools: ["read-file"] } };
    expect(await resolvedTools({}, configured)).toEqual(["read-file"]);
  });

  test("an unknown recipe tool fails with the available names", async () => {
    await expect(resolvedTools({ tools: ["foobar"] })).rejects.toThrow(
      "Unknown tool: foobar. Available: axle-help, exec, patch-file, read-file, write-file",
    );
  });

  test("an unknown defaults.tools entry fails at run time", async () => {
    const configured = { defaults: { provider: "anthropic", tools: ["read-files"] } };
    await expect(resolvedTools({}, configured)).rejects.toThrow("Unknown tool: read-files.");
  });
});

describe("a named provider against the current configuration", () => {
  const target: SessionTarget = { provider: { name: "gw" }, model: "m" };

  test("a named provider follows the current cli.yaml profile", async () => {
    const asChatCompletions = await fromTarget(
      target,
      {},
      {
        providers: { gw: { protocol: "chatCompletions", baseUrl: "https://gw.example.test/v1" } },
      },
    );
    const asAnthropic = await fromTarget(
      target,
      {},
      {
        providers: { gw: { protocol: "messages", baseUrl: "https://gw.test", apiKey: "key" } },
      },
    );

    expect(asChatCompletions.agentConfig.provider.protocol).toBe("chatCompletions");
    expect(asAnthropic.agentConfig.provider.protocol).toBe("messages");
  });

  test("a named provider whose profile is gone fails by name", async () => {
    await expect(fromTarget(target, {}, {})).rejects.toThrow(
      /"gw" is not a preset .* or a provider profile/,
    );
  });

  test("an inline endpoint resolves without cli.yaml", async () => {
    const { agentConfig } = await fromTarget(
      {
        provider: { protocol: "chatCompletions", baseUrl: "https://old.example.test/v1" },
        model: "m",
      },
      {},
      {},
    );

    expect(agentConfig.provider.protocol).toBe("chatCompletions");
  });
});

describe("resolveTarget", () => {
  test("a named profile stays a name, for the session and the defaults.models lookup", () => {
    const target = resolveTarget(
      { provider: { name: "work" } },
      { providers: { work: { protocol: "messages", baseUrl: "https://work.test" } } },
      {},
    );

    expect(target.providerName).toBe("work");
    expect(target.provider).toEqual({ name: "work" });
  });

  test("an inline endpoint is carried as written; its protocol doubles as its name", () => {
    const target = resolveTarget(
      { provider: { protocol: "chatCompletions", baseUrl: "http://localhost:1/v1" } },
      {},
      {},
    );

    expect(target.providerName).toBe("chatCompletions");
    expect(target.provider).toEqual({
      protocol: "chatCompletions",
      baseUrl: "http://localhost:1/v1",
    });
  });

  test("chat takes the default provider and its default model", () => {
    const target = resolveTarget(
      undefined,
      {
        providers: { gw: { protocol: "chatCompletions", baseUrl: "https://gw.example.test/v1" } },
        defaults: { provider: "gw", models: { gw: "vendor/model-a" } },
      },
      {},
    );

    expect(target.provider).toEqual({ name: "gw" });
    expect(target.model).toBe("vendor/model-a");
  });

  test("errors without a default provider", () => {
    expect(() => resolveTarget(undefined, {}, {})).toThrow(
      /No provider specified and no default provider configured/,
    );
  });
});

describe("skills", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const pdf: Skill = { name: "pdf", description: "PDFs.", instructions: "Use pdf." };

  test("every discovered skill loads, and none means no skills", async () => {
    const target = resolveTarget(undefined, cliConfig, serviceConfig);
    const resolve = (skills: Skill[]) =>
      fromTarget(target, {}, cliConfig, serviceConfig, { trusted: true }, skills);

    expect((await resolve([pdf])).agentConfig.skills).toEqual([pdf]);
    expect((await resolve([])).agentConfig.skills).toBeUndefined();
  });
});

describe("folder trust", () => {
  const cliConfig = { defaults: { provider: "anthropic" } };
  const serviceConfig: ServiceConfig = { anthropic: { apiKey: "key", model: "anthropic/m" } };
  const target: SessionTarget = { provider: { name: "anthropic" }, model: "anthropic/m" };
  const untrusted = (recipe: AgentRecipe, config = cliConfig) =>
    fromTarget(target, recipe, config, serviceConfig, { trusted: false });
  const toolNames = (agentConfig: { tools?: { name: string }[] }) =>
    agentConfig.tools?.map((tool) => tool.name);

  test("an untrusted folder keeps only the tools that cannot act on it", async () => {
    const { agentConfig, droppedTools } = await untrusted({});

    expect(toolNames(agentConfig)).toEqual(["axle-help", "read-file"]);
    expect(droppedTools).toEqual(["exec", "patch-file", "write-file"]);
  });

  test("a recipe's own tools are gated the same way", async () => {
    const { agentConfig, droppedTools } = await untrusted({ tools: ["exec", "read-file"] });

    expect(toolNames(agentConfig)).toEqual(["read-file"]);
    expect(droppedTools).toEqual(["exec"]);
  });

  test("defaults.tools from cli.yaml is gated the same way", async () => {
    const configured = { defaults: { provider: "anthropic", tools: ["write-file"] } };

    const { agentConfig, droppedTools } = await untrusted({}, configured);

    expect(agentConfig.tools).toBeUndefined();
    expect(droppedTools).toEqual(["write-file"]);
  });

  test("a trusted folder drops nothing", async () => {
    const { agentConfig, droppedTools } = await fromTarget(target, {}, cliConfig, serviceConfig);

    expect(toolNames(agentConfig)).toHaveLength(5);
    expect(droppedTools).toEqual([]);
  });
});
