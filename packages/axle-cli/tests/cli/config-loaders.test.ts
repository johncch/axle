import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCliConfig, getJobConfig, getServiceConfig } from "../../src/cli/configs/loaders.js";

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
  it("loads YAML job config and defaults name from filename", async () => {
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

    expect(config.name).toBe("summarize");
    expect(config.provider.type).toBe("openai");
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

  it("accepts a provider string shorthand", async () => {
    const path = join(TEST_DIR, "shorthand.yml");
    await writeFile(path, "provider: anthropic\ntask: Run\n");

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({ type: "anthropic" });
  });

  it("accepts a job with no provider", async () => {
    const path = join(TEST_DIR, "no-provider.yml");
    await writeFile(path, "model: anthropic/claude-sonnet-5\ntask: Run\n");

    const config = await getJobConfig(path, {});

    expect(config.provider).toBeUndefined();
    expect(config.model).toBe("anthropic/claude-sonnet-5");
  });

  it("rejects an unknown provider shorthand", async () => {
    const path = join(TEST_DIR, "bad-shorthand.yml");
    await writeFile(path, "provider: bedrock\ntask: Run\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider/);
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

    const config = await getServiceConfig({});

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

    const config = await getServiceConfig({ cwd, home });

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

    const config = await getServiceConfig({ cwd, home });

    expect(config.anthropic).toEqual({ apiKey: "project-key", model: "user-model" });
    expect(config.openai).toEqual({ apiKey: "env-openai", model: undefined });
    expect(config.gemini).toEqual({ apiKey: "user-gemini", model: undefined });
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

    const config = await getCliConfig({ cwd, home });

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

  it("rejects a provider profile carrying a model", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(
      join(home, ".axle", "cli.yaml"),
      ["providers:", "  mine:", "    type: anthropic", "    model: anthropic/claude-sonnet-5"].join(
        "\n",
      ),
    );

    await expect(getCliConfig({ cwd: join(TEST_DIR, "proj"), home })).rejects.toThrow(
      /providers\.mine/,
    );
  });

  it("returns an empty config when no cli.yaml exists", async () => {
    const config = await getCliConfig({
      cwd: join(TEST_DIR, "nowhere"),
      home: join(TEST_DIR, "nowhere-else"),
    });

    expect(config).toEqual({});
  });

  it("rejects an invalid cli.yaml with its path", async () => {
    const home = join(TEST_DIR, "home");
    await mkdir(join(home, ".axle"), { recursive: true });
    await writeFile(join(home, ".axle", "cli.yaml"), "defaults:\n  provider: [not, a, string]\n");

    await expect(getCliConfig({ cwd: join(TEST_DIR, "proj"), home })).rejects.toThrow(
      /Invalid config file at .*\/cli\.yaml/,
    );
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
