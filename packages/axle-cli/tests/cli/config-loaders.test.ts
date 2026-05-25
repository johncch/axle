import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJobConfig, getServiceConfig } from "../../src/cli/configs/loaders.js";

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
        "  model: gpt-test",
        "task: Run",
      ].join("\n"),
    );

    const config = await getJobConfig(path, {});

    expect(config.provider).toEqual({
      type: "openai",
      apiKeyEnv: "CUSTOM_OPENAI_KEY",
      model: "gpt-test",
    });
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

    expect(config.openai).toEqual({ "api-key": "openai-key", model: "gpt-test" });
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
