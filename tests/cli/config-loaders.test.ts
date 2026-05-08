import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJobConfig, getServiceConfig } from "../../src/cli/configs/loaders.js";

const TEST_DIR = join(import.meta.dirname, "__config_loader_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
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

  it("loads JSON service config", async () => {
    const path = join(TEST_DIR, "axle.config.json");
    await writeFile(path, JSON.stringify({ brave: { "api-key": "abc", rateLimit: 2 } }));

    const config = await getServiceConfig(path, {});

    expect(config.brave).toEqual({ "api-key": "abc", rateLimit: 2 });
  });

  it("reports validation errors with paths", async () => {
    const path = join(TEST_DIR, "bad.yml");
    await writeFile(path, "provider:\n  type: nope\ntask: test\n");

    await expect(getJobConfig(path, {})).rejects.toThrow(/provider\.type/);
  });
});
