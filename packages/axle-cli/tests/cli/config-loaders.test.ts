import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCliConfig,
  getCliConfigSources,
  getCredentialSources,
  getJobConfig,
  getServiceConfig,
} from "../../src/cli/configs/loaders.js";
import { listProjectInputs } from "../../src/cli/configs/paths.js";

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
        "provider:",
        "  type: openai",
        "task: Summarize {{file}}",
        "mcps:",
        "  - transport: http",
        "    url: http://localhost:3000/mcp",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.name).toBeUndefined();
    expect(config.provider).toEqual({ type: "openai" });
    expect(config.mcps?.[0]).toMatchObject({ transport: "http" });
  });

  it("accepts explicit provider environment references", async () => {
    const path = join(TEST_DIR, "env-ref.yml");
    await writeFile(
      path,
      [
        "provider:",
        "  type: openai",
        "  apiKeyEnv: CUSTOM_OPENAI_KEY",
        "model: openai/gpt-test",
        "task: Run",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({
      type: "openai",
      apiKeyEnv: "CUSTOM_OPENAI_KEY",
    });
    expect(config.model).toBe("openai/gpt-test");
  });

  it("accepts a ChatCompletions vendor override", async () => {
    const path = join(TEST_DIR, "openrouter.yml");
    await writeFile(
      path,
      [
        "provider:",
        "  type: chatcompletions",
        "  baseUrl: https://gateway.example.test/v1",
        "  vendor: openrouter",
        "model: test-model",
        "task: Run",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.provider).toMatchObject({
      type: "chatcompletions",
      baseUrl: "https://gateway.example.test/v1",
      vendor: "openrouter",
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
      ["provider:", "  type: openai", "  apiKey: sk-secret", "task: Run"].join("\n"),
    );

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider: Unrecognized key: "apiKey"/);
  });

  it("rejects non-YAML job files", async () => {
    const path = join(TEST_DIR, "summarize.json");
    await writeFile(path, JSON.stringify({ provider: { type: "openai" }, task: "test" }));

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
        "    type: anthropic",
        "  local:",
        "    type: chatcompletions",
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
        "    type: openai",
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
        "    type: chatcompletions",
        "    baseUrl: https://openrouter.ai/api/v1",
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
      openrouter: {
        type: "chatcompletions",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
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
        "    type: chatcompletions",
        "    baseUrl: https://gw.example.test/v1",
        "    apiKeyEnv: GW_KEY",
      ].join("\n"),
    );
    await writeFile(
      join(cwd, ".axle", "cli.yaml"),
      ["providers:", "  gw:", "    type: anthropic"].join("\n"),
    );

    const config = await getCliConfig({ trusted: true, cwd, home });

    expect(config.providers?.gw).toEqual({ type: "anthropic" });
  });

  it("provides a chatcompletions service config from baseUrl alone", async () => {
    process.chdir(TEST_DIR);
    vi.stubEnv("CHATCOMPLETIONS_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("CHATCOMPLETIONS_MODEL", "");
    vi.stubEnv("CHATCOMPLETIONS_API_KEY", "");

    const config = await getServiceConfig({
      trusted: true,
      cwd: join(TEST_DIR, "proj"),
      home: join(TEST_DIR, "home"),
    });

    expect(config.chatcompletions).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: undefined,
      apiKey: undefined,
    });
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
      ["providers:", "  mine:", "    type: anthropic", "    model: anthropic/claude-sonnet-5"].join(
        "\n",
      ),
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
    await writeFile(path, "provider:\n  type: nope\ntask: test\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider\.type/);
  });

  it("rejects unknown provider fields", async () => {
    const path = join(TEST_DIR, "unknown-field.yml");
    await writeFile(path, "provider:\n  type: openai\n  unknown: nope\ntask: test\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider/);
  });
});

describe("schedule block", () => {
  async function loadWith(block: string[]): Promise<Awaited<ReturnType<typeof getJobConfig>>> {
    const path = join(TEST_DIR, "scheduled.yml");
    await writeFile(path, ["provider:", "  type: openai", "task: Check", ...block].join("\n"));
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
