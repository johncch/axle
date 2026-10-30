import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCliConfig,
  getCliConfigSources,
  getCredentials,
  getCredentialSources,
  getJobConfig,
  getServiceConfig,
  readConfigHome,
} from "../../src/cli/configs/loaders.js";
import { listProjectInputs } from "../../src/cli/configs/paths.js";
import type { CliConfig } from "../../src/cli/configs/schemas.js";

const TEST_DIR = join(import.meta.dirname, "__config_loader_tmp__");
const ORIGINAL_CWD = process.cwd();

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  vi.unstubAllEnvs();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("config loaders", () => {
  it("loads YAML job config without inventing a name", async () => {
    const path = join(TEST_DIR, "summarize.yml");
    await writeFile(
      path,
      [
        "provider: openai",
        "task: Summarize {{file}}",
        "mcps:",
        "  - transport: http",
        "    url: http://localhost:3000/mcp",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.name).toBeUndefined();
    expect(config.provider).toEqual({ name: "openai" });
    expect(config.mcps?.[0]).toMatchObject({ transport: "http" });
  });

  it("accepts explicit provider environment references", async () => {
    const path = join(TEST_DIR, "env-ref.yml");
    await writeFile(
      path,
      [
        "provider:",
        "  protocol: responses",
        "  baseUrl: https://gateway.example.test/v1",
        "  apiKeyEnv: CUSTOM_OPENAI_KEY",
        "model: openai/gpt-test",
        "task: Run",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({
      protocol: "responses",
      baseUrl: "https://gateway.example.test/v1",
      apiKeyEnv: "CUSTOM_OPENAI_KEY",
    });
    expect(config.model).toBe("openai/gpt-test");
  });

  it("accepts an id and dialect on an inline provider", async () => {
    const path = join(TEST_DIR, "openrouter.yml");
    await writeFile(
      path,
      [
        "provider:",
        "  protocol: chatCompletions",
        "  baseUrl: https://gateway.example.test/v1",
        "  id: openrouter",
        "  dialect: openrouter",
        "model: test-model",
        "task: Run",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.provider).toMatchObject({
      protocol: "chatCompletions",
      baseUrl: "https://gateway.example.test/v1",
      id: "openrouter",
      dialect: "openrouter",
    });
    expect(config.model).toBe("test-model");
  });

  it("accepts a provider string shorthand as a name reference", async () => {
    const path = join(TEST_DIR, "shorthand.yml");
    await writeFile(path, "provider: anthropic\ntask: Run\n");

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({ name: "anthropic" });
  });

  it("accepts a job with no provider", async () => {
    const path = join(TEST_DIR, "no-provider.yml");
    await writeFile(path, "model: anthropic/claude-sonnet-5\ntask: Run\n");

    const config = await getJobConfig(path, {});

    expect(config.provider).toBeUndefined();
    expect(config.model).toBe("anthropic/claude-sonnet-5");
  });

  it("accepts any provider name at the schema level (validated at resolution)", async () => {
    const path = join(TEST_DIR, "named-provider.yml");
    await writeFile(path, "provider: openrouter\ntask: Run\n");

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({ name: "openrouter" });
  });

  it("rejects an api key literal in a recipe provider", async () => {
    const path = join(TEST_DIR, "inline-key.yml");
    await writeFile(
      path,
      [
        "provider:",
        "  protocol: responses",
        "  baseUrl: https://gateway.example.test/v1",
        "  apiKey: sk-secret",
        "task: Run",
      ].join("\n"),
    );

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider: Unrecognized key: "apiKey"/);
  });

  it("rejects non-YAML job files", async () => {
    const path = join(TEST_DIR, "summarize.json");
    await writeFile(path, JSON.stringify({ provider: "openai", task: "test" }));

    await expect(getJobConfig(path, {})).rejects.toThrow(
      "Invalid job file format. Expected .yaml or .yml",
    );
  });

  it("uses environment variables for service config", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");

    const config = await getServiceConfig({ trusted: true });

    expect(config.openai).toEqual({ apiKey: "openai-key", model: "gpt-test" });
  });

  it("reads credentials from the user home", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(
      join(home, ".axle", "credentials"),
      "ANTHROPIC_API_KEY=user-key\nANTHROPIC_MODEL=user-model\n",
    );

    const config = await getServiceConfig({ trusted: true, cwd, home });

    expect(config.anthropic).toEqual({ apiKey: "user-key", model: "user-model" });
  });

  it("resolves any credential variable, env over project over user, and skips an untrusted project", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("ROUTER_KEY", "");
    vi.stubEnv("SHARED_KEY", "env-shared");
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "credentials"),
      "ROUTER_KEY=user-router\nSHARED_KEY=user-shared\n",
    );
    await writeFile(join(cwd, ".axle", "credentials"), "ROUTER_KEY=project-router\n");

    const trusted = await getCredentials({ trusted: true, cwd, home });
    const untrusted = await getCredentials({ trusted: false, cwd, home });

    expect(trusted.ROUTER_KEY).toBe("project-router");
    expect(trusted.SHARED_KEY).toBe("env-shared");
    expect(untrusted.ROUTER_KEY).toBe("user-router");
  });

  it("layers credentials per key: env over project over user", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_MODEL", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "env-openai");
    vi.stubEnv("OPENAI_MODEL", "");
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "credentials"),
      "ANTHROPIC_API_KEY=user-key\nANTHROPIC_MODEL=user-model\nGEMINI_API_KEY=user-gemini\n",
    );
    await writeFile(
      join(cwd, ".axle", "credentials"),
      "ANTHROPIC_API_KEY=project-key\nOPENAI_API_KEY=project-openai\n",
    );

    const config = await getServiceConfig({ trusted: true, cwd, home });

    expect(config.anthropic).toEqual({ apiKey: "project-key", model: "user-model" });
    expect(config.openai).toEqual({ apiKey: "env-openai", model: undefined });
    expect(config.gemini).toEqual({ apiKey: "user-gemini", model: undefined });
  });

  it("names the layer each credential comes from", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "shell-openai");
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "credentials"),
      "ANTHROPIC_API_KEY=user-key\nGEMINI_API_KEY=user-gemini\n",
    );
    await writeFile(
      join(cwd, ".axle", "credentials"),
      "ANTHROPIC_API_KEY=project-key\nOPENAI_API_KEY=project-openai\n",
    );

    const sources = await getCredentialSources({ trusted: true, cwd, home });

    expect(sources.OPENAI_API_KEY).toBe("environment");
    expect(sources.ANTHROPIC_API_KEY).toBe(join(cwd, ".axle", "credentials"));
    expect(sources.GEMINI_API_KEY).toBe(join(home, ".axle", "credentials"));
  });

  it("names the cli.yaml that supplies each merged value", async () => {
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    const userFile = join(home, ".axle", "cli.yaml");
    const projectFile = join(cwd, ".axle", "cli.yaml");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      userFile,
      [
        "providers:",
        "  work:",
        "    protocol: messages",
        "    baseUrl: https://anthropic.test",
        "  local:",
        "    protocol: chatCompletions",
        "    baseUrl: http://localhost:11434/v1",
        "defaults:",
        "  provider: work",
        "  tools: [exec]",
        "  models:",
        "    work: user-model",
        "    local: local-model",
      ].join("\n"),
    );
    await writeFile(
      projectFile,
      [
        "providers:",
        "  work:",
        "    protocol: responses",
        "    baseUrl: https://openai.test/v1",
        "defaults:",
        "  provider: local",
        "  models:",
        "    work: project-model",
      ].join("\n"),
    );

    expect(await getCliConfigSources({ trusted: true, cwd, home })).toEqual({
      providers: { work: projectFile, local: userFile },
      defaultProvider: projectFile,
      defaultTools: userFile,
      defaultModels: { work: projectFile, local: userFile },
    });
  });

  it("merges cli.yaml with project winning over user", async () => {
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "cli.yaml"),
      [
        "providers:",
        "  openrouter:",
        "    apiKeyEnv: OPENROUTER_API_KEY",
        "defaults:",
        "  provider: anthropic",
        "  models:",
        "    openai: openai/user-model",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".axle", "cli.yaml"),
      ["defaults:", "  provider: openrouter", "  models:", "    openai: openai/project-model"].join(
        "\n",
      ),
    );

    const config = await getCliConfig({ trusted: true, cwd, home });

    expect(config.providers).toEqual({
      openrouter: { apiKeyEnv: "OPENROUTER_API_KEY" },
    });
    expect(config.defaults).toEqual({
      provider: "openrouter",
      models: { openai: "openai/project-model" },
    });
  });

  it("tolerates an empty cli.yaml", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(join(home, ".axle", "cli.yaml"), "# just a comment\n");

    const config = await getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home });

    expect(config).toEqual({});
  });

  it("replaces same-named provider profiles wholesale across layers", async () => {
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "cli.yaml"),
      [
        "providers:",
        "  gw:",
        "    protocol: chatCompletions",
        "    baseUrl: https://gw.example.test/v1",
        "    apiKeyEnv: GW_KEY",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".axle", "cli.yaml"),
      ["providers:", "  gw:", "    protocol: messages", "    baseUrl: https://gw.test"].join("\n"),
    );

    const config = await getCliConfig({ trusted: true, cwd, home });

    expect(config.providers?.gw).toEqual({ protocol: "messages", baseUrl: "https://gw.test" });
  });

  describe("provider profile names", () => {
    async function loadProviders(lines: string[]): Promise<CliConfig> {
      const home = join(TEST_DIR, "home");
      await mkdir(join(home, ".axle"), { recursive: true });
      await writeFile(join(home, ".axle", "cli.yaml"), ["providers:", ...lines].join("\n"));
      return getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home });
    }

    it("a preset's name takes the preset's options", async () => {
      const config = await loadProviders([
        "  anthropic:",
        "    apiKeyEnv: WORK_KEY",
        "  bedrock:",
        "    protocol: messages",
        "    region: us-east-1",
        "  openrouter:",
        "    baseUrl: https://eu.openrouter.ai/api/v1",
      ]);

      expect(config.providers).toEqual({
        anthropic: { apiKeyEnv: "WORK_KEY" },
        bedrock: { protocol: "messages", region: "us-east-1" },
        openrouter: { baseUrl: "https://eu.openrouter.ai/api/v1" },
      });
    });

    it("rejects a baseUrl on a preset that takes none, and says what to do", async () => {
      await expect(
        loadProviders(["  anthropic:", "    baseUrl: https://proxy.test"]),
      ).rejects.toThrow(
        'providers.anthropic: "anthropic" is a preset and takes no baseUrl. Remove it, or rename this profile to use your own URL.',
      );
    });

    it("rejects the old keys on a preset", async () => {
      await expect(
        loadProviders(["  openrouter:", "    type: chatcompletions", "    vendor: openrouter"]),
      ).rejects.toThrow(
        'providers.openrouter: "openrouter" is a preset and takes no type or vendor. Remove them.',
      );
    });

    it("says what replaced the old keys on a generic profile", async () => {
      await expect(
        loadProviders([
          "  local:",
          "    type: chatcompletions",
          "    baseUrl: http://localhost:1/v1",
          "    vendor: openrouter",
        ]),
      ).rejects.toThrow("providers.local: type is now protocol; vendor is now id and dialect.");
    });

    it("rejects a dialect outside chatCompletions", async () => {
      await expect(
        loadProviders([
          "  proxy:",
          "    protocol: messages",
          "    baseUrl: https://proxy.test",
          "    dialect: openrouter",
        ]),
      ).rejects.toThrow("providers.proxy.dialect: dialect applies only");
    });

    it("says a missing key is required, not invalid", async () => {
      await expect(loadProviders(["  local:", "    apiKeyEnv: KEY"])).rejects.toThrow(
        "providers.local.protocol: protocol is required: messages, responses, generateContent or chatCompletions.",
      );
      await expect(loadProviders(["  local:", "    protocol: responses"])).rejects.toThrow(
        "providers.local.baseUrl: baseUrl is required.",
      );
      await expect(loadProviders(["  bedrock:", "    protocol: messages"])).rejects.toThrow(
        "providers.bedrock.region: region is required, e.g. us-east-1.",
      );
    });

    it("still rejects a wrong protocol as a wrong value", async () => {
      await expect(
        loadProviders(["  local:", "    protocol: nope", "    baseUrl: http://x/v1"]),
      ).rejects.toThrow(/providers\.local\.protocol: Invalid option/);
    });

    it("reports every invalid file, not only the first", async () => {
      const home = join(TEST_DIR, "home");
      const cwd = join(TEST_DIR, "proj");
      await mkdir(join(home, ".axle"), { recursive: true });
      await mkdir(join(cwd, ".axle"), { recursive: true });
      await writeFile(
        join(home, ".axle", "cli.yaml"),
        ["providers:", "  anthropic:", "    type: anthropic"].join("\n"),
      );
      await writeFile(
        join(cwd, ".axle", "cli.yaml"),
        ["providers:", "  gemini:", "    type: gemini"].join("\n"),
      );

      const load = getCliConfig({ trusted: true, cwd, home });

      await expect(load).rejects.toThrow(/home\/\.axle\/cli\.yaml:\n.*providers\.anthropic/);
      await expect(load).rejects.toThrow(/proj\/\.axle\/cli\.yaml:\n.*providers\.gemini/);
    });
  });

  it("rejects a generic profile with no baseUrl", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "cli.yaml"),
      ["providers:", "  local:", "    protocol: chatCompletions"].join("\n"),
    );

    await expect(
      getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home }),
    ).rejects.toThrow(/baseUrl/);
  });

  it("reads one home on its own, without layering", async () => {
    const home = join(TEST_DIR, "home");
    const cwd = join(TEST_DIR, "proj");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(join(home, ".axle", "credentials"), "ANTHROPIC_API_KEY=user-key\n");
    await writeFile(join(home, ".axle", "cli.yaml"), "defaults:\n  provider: anthropic\n");
    await writeFile(join(cwd, ".axle", "credentials"), "OPENAI_API_KEY=folder-key\n");

    expect(await readConfigHome({ scope: "project", cwd, home })).toEqual({
      credentials: { OPENAI_API_KEY: "folder-key" },
      cliConfig: {},
    });
    expect(await readConfigHome({ cwd, home })).toEqual({
      credentials: { ANTHROPIC_API_KEY: "user-key" },
      cliConfig: { defaults: { provider: "anthropic" } },
    });
  });

  it("does not read the CHATCOMPLETIONS_* variables", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("CHATCOMPLETIONS_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("CHATCOMPLETIONS_MODEL", "llama3");
    vi.stubEnv("CHATCOMPLETIONS_API_KEY", "generic-key");

    const config = await getServiceConfig({
      trusted: true,
      cwd: join(TEST_DIR, "proj"),
      home: join(TEST_DIR, "home"),
    });

    expect(config).not.toHaveProperty("chatcompletions");
  });

  it("rejects unknown top-level job keys", async () => {
    const path = join(TEST_DIR, "old-key.yml");
    await writeFile(path, "provider: anthropic\nprovider_tools: [web_search]\ntask: Run\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider_tools/);
  });

  it("rejects a provider profile carrying a model", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "cli.yaml"),
      [
        "providers:",
        "  mine:",
        "    protocol: messages",
        "    baseUrl: https://anthropic.test",
        "    model: anthropic/claude-sonnet-5",
      ].join("\n"),
    );

    await expect(
      getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home }),
    ).rejects.toThrow(/providers\.mine/);
  });

  it("returns an empty config when no cli.yaml exists", async () => {
    const config = await getCliConfig({
      trusted: true,
      cwd: join(TEST_DIR, "nowhere"),
      home: join(TEST_DIR, "nowhere-else"),
    });

    expect(config).toEqual({});
  });

  it("rejects an invalid cli.yaml with its path", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(join(home, ".axle", "cli.yaml"), "defaults:\n  provider: [not, a, string]\n");

    await expect(
      getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home }),
    ).rejects.toThrow(/Invalid config file at .*\/cli\.yaml/);
  });

  it("rejects a misspelled key in an mcps entry instead of dropping it", async () => {
    const jobPath = join(TEST_DIR, "job.yaml");
    await writeFile(
      jobPath,
      "task: hi\nmcps:\n  - transport: stdio\n    command: npx\n    arg: [tsx]\n",
    );
    await expect(getJobConfig(jobPath, {})).rejects.toThrow(/arg/);

    await writeFile(
      jobPath,
      "task: hi\nmcps:\n  - transport: http\n    url: http://x\n    header: {}\n",
    );
    await expect(getJobConfig(jobPath, {})).rejects.toThrow(/header/);
  });

  it("rejects a misspelled cli.yaml key instead of dropping it", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });

    await writeFile(join(home, ".axle", "cli.yaml"), "default:\n  provider: anthropic\n");
    await expect(
      getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home }),
    ).rejects.toThrow(/default/);

    await writeFile(join(home, ".axle", "cli.yaml"), "defaults:\n  model: anthropic/x\n");
    await expect(
      getCliConfig({ trusted: true, cwd: join(TEST_DIR, "proj"), home }),
    ).rejects.toThrow(/model/);
  });

  it("reports validation errors with paths", async () => {
    const path = join(TEST_DIR, "bad.yml");
    await writeFile(path, "provider:\n  protocol: nope\ntask: test\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider\.protocol/);
  });

  it("rejects unknown provider fields", async () => {
    const path = join(TEST_DIR, "unknown-field.yml");
    await writeFile(
      path,
      "provider:\n  protocol: responses\n  baseUrl: https://a.test/v1\n  unknown: nope\ntask: test\n",
    );

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider/);
  });
});

describe("schedule block", () => {
  async function loadWith(block: string[]): Promise<Awaited<ReturnType<typeof getJobConfig>>> {
    const path = join(TEST_DIR, "scheduled.yml");
    await writeFile(path, ["provider: openai", "task: Check", ...block].join("\n"));
    return getJobConfig(path, {});
  }

  it("accepts a fixed interval", async () => {
    const config = await loadWith(["schedule:", "  every: 1h"]);
    expect(config.schedule).toEqual({ every: "1h" });
  });

  it("accepts clock times with optional weekdays", async () => {
    expect((await loadWith(["schedule:", "  at: '09:00'"])).schedule).toEqual({ at: "09:00" });
    expect(
      (await loadWith(["schedule:", "  at: ['09:00', '17:30']", "  on: [mon, fri]"])).schedule,
    ).toEqual({ at: ["09:00", "17:30"], on: ["mon", "fri"] });
  });

  it("leaves schedule undefined when absent", async () => {
    expect((await loadWith([])).schedule).toBeUndefined();
  });

  it.each([
    ["schedule:", "  every: 90 minutes"],
    ["schedule:", "  every: 30s"],
    ["schedule:", "  every: 1h", "  overlap: skip"],
    ["schedule:", "  at: '9:00'"],
    ["schedule:", "  at: '09:00'", "  every: 1h"],
    ["schedule:", "  on: [mon]"],
    ["schedule:", "  at: '09:00'", "  on: [monday]"],
    ["schedule:", "  at: []"],
    ["schedule: hourly"],
  ])("rejects malformed block %j", async (...block) => {
    await expect(loadWith(block)).rejects.toThrow(/The job file is not valid/);
  });
});

describe("folder trust", () => {
  const home = join(TEST_DIR, "home");
  const cwd = join(TEST_DIR, "proj");

  beforeEach(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await mkdir(join(home, ".axle"), { recursive: true });
    await mkdir(join(cwd, ".axle"), { recursive: true });
    await writeFile(join(home, ".axle", "cli.yaml"), "defaults:\n  provider: anthropic\n");
    await writeFile(
      join(cwd, ".axle", "cli.yaml"),
      "defaults:\n  provider: openai\n  tools: [exec]\n",
    );
    await writeFile(join(home, ".axle", "credentials"), "ANTHROPIC_API_KEY=user-key\n");
    await writeFile(join(cwd, ".axle", "credentials"), "ANTHROPIC_API_KEY=project-key\n");
  });

  it("an untrusted folder's cli.yaml is never read", async () => {
    expect(await getCliConfig({ trusted: false, cwd, home })).toEqual({
      defaults: { provider: "anthropic" },
    });
    expect((await getCliConfigSources({ trusted: false, cwd, home })).defaultProvider).toBe(
      join(home, ".axle", "cli.yaml"),
    );
  });

  it("an untrusted folder's credentials are never read", async () => {
    const config = await getServiceConfig({ trusted: false, cwd, home });

    expect(config.anthropic?.apiKey).toBe("user-key");
    expect((await getCredentialSources({ trusted: false, cwd, home })).ANTHROPIC_API_KEY).toBe(
      join(home, ".axle", "credentials"),
    );
  });

  it("a trusted folder's layer wins as before", async () => {
    const config = await getCliConfig({ trusted: true, cwd, home });

    expect(config.defaults).toEqual({ provider: "openai", tools: ["exec"] });
    expect((await getServiceConfig({ trusted: true, cwd, home })).anthropic?.apiKey).toBe(
      "project-key",
    );
  });

  it("lists the project inputs a run would read", async () => {
    expect(await listProjectInputs(cwd)).toEqual([".axle/cli.yaml", ".axle/credentials"]);
    expect(await listProjectInputs(join(TEST_DIR, "empty"))).toEqual([]);
  });
});
