import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateCliDefaults, upsertCredentials } from "../../src/cli/configs/writers.js";

const TEST_DIR = join(import.meta.dirname, "__writers_tmp__");
const HOME = join(TEST_DIR, "home");
const CREDENTIALS = join(HOME, ".axle", "credentials");
const CLI_YAML = join(HOME, ".axle", "cli.yaml");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("upsertCredentials", () => {
  it("creates the file with mode 600", async () => {
    const path = await upsertCredentials({ ANTHROPIC_API_KEY: "sk-test" }, HOME);

    expect(path).toBe(CREDENTIALS);
    expect(await readFile(CREDENTIALS, "utf-8")).toBe("ANTHROPIC_API_KEY=sk-test\n");
    const mode = (await stat(CREDENTIALS)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("preserves other tools' lines and comments, replaces in place, appends new", async () => {
    await mkdir(join(HOME, ".axle"), { recursive: true });
    await writeFile(
      CREDENTIALS,
      [
        "# written by axle-code",
        "AXLE_CODE_TOKEN=keep-me",
        "ANTHROPIC_API_KEY=old-key",
        "",
        "OPENROUTER_API_KEY=also-keep",
      ].join("\n") + "\n",
    );

    await upsertCredentials({ ANTHROPIC_API_KEY: "new-key", OPENAI_API_KEY: "added" }, HOME);

    expect(await readFile(CREDENTIALS, "utf-8")).toBe(
      [
        "# written by axle-code",
        "AXLE_CODE_TOKEN=keep-me",
        "ANTHROPIC_API_KEY=new-key",
        "",
        "OPENROUTER_API_KEY=also-keep",
        "OPENAI_API_KEY=added",
      ].join("\n") + "\n",
    );
  });
});

describe("updateCliDefaults", () => {
  it("creates the file with defaults", async () => {
    const path = await updateCliDefaults(
      { provider: "anthropic", models: { anthropic: "anthropic/claude-sonnet-5" } },
      HOME,
    );

    expect(path).toBe(CLI_YAML);
    const content = await readFile(CLI_YAML, "utf-8");
    expect(content).toContain("provider: anthropic");
    expect(content).toContain("anthropic: anthropic/claude-sonnet-5");
  });

  it("preserves comments and unrelated keys", async () => {
    await mkdir(join(HOME, ".axle"), { recursive: true });
    await writeFile(
      CLI_YAML,
      [
        "# my hand-written config",
        "providers:",
        "  gw:",
        "    type: chatcompletions",
        "    baseUrl: https://gw.example.test/v1 # gateway",
        "defaults:",
        "  provider: gw",
        "  models:",
        "    gw: old/model",
      ].join("\n") + "\n",
    );

    await updateCliDefaults({ provider: "anthropic", models: { anthropic: "anthropic/x" } }, HOME);

    const content = await readFile(CLI_YAML, "utf-8");
    expect(content).toContain("# my hand-written config");
    expect(content).toContain("# gateway");
    expect(content).toContain("gw: old/model");
    expect(content).toContain("provider: anthropic");
    expect(content).toContain("anthropic: anthropic/x");
  });
});
