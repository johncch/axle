import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import type { ConfigTarget } from "../../src/cli/configs/paths.js";
import {
  updateCliDefaults,
  upsertCliProvider,
  upsertCredentials,
} from "../../src/cli/configs/writers.js";

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
    const path = await upsertCredentials({ ANTHROPIC_API_KEY: "sk-test" }, { home: HOME });

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

    await upsertCredentials(
      { ANTHROPIC_API_KEY: "new-key", OPENAI_API_KEY: "added" },
      { home: HOME },
    );

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

  it("drops later duplicates of an upserted key so the new value is not shadowed", async () => {
    await mkdir(join(HOME, ".axle"), { recursive: true });
    await writeFile(
      CREDENTIALS,
      [
        "ANTHROPIC_API_KEY=old-key",
        "AXLE_CODE_TOKEN=keep-me",
        "ANTHROPIC_API_KEY=stale-duplicate",
        "OPENROUTER_API_KEY=dup-not-managed",
        "OPENROUTER_API_KEY=dup-not-managed-2",
      ].join("\n") + "\n",
    );

    await upsertCredentials({ ANTHROPIC_API_KEY: "new-key" }, { home: HOME });

    expect(await readFile(CREDENTIALS, "utf-8")).toBe(
      [
        "ANTHROPIC_API_KEY=new-key",
        "AXLE_CODE_TOKEN=keep-me",
        "OPENROUTER_API_KEY=dup-not-managed",
        "OPENROUTER_API_KEY=dup-not-managed-2",
      ].join("\n") + "\n",
    );
  });
});

describe("updateCliDefaults", () => {
  it("creates the file with defaults", async () => {
    const path = await updateCliDefaults(
      { provider: "anthropic", models: { anthropic: "anthropic/claude-sonnet-5" } },
      { home: HOME },
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

    await updateCliDefaults(
      { provider: "anthropic", models: { anthropic: "anthropic/x" } },
      { home: HOME },
    );

    const content = await readFile(CLI_YAML, "utf-8");
    expect(content).toContain("# my hand-written config");
    expect(content).toContain("# gateway");
    expect(content).toContain("gw: old/model");
    expect(content).toContain("provider: anthropic");
    expect(content).toContain("anthropic: anthropic/x");
  });
});

describe("upsertCliProvider", () => {
  it("adds a profile and keeps the rest of the file", async () => {
    await mkdir(join(HOME, ".axle"), { recursive: true });
    await writeFile(
      CLI_YAML,
      ["# my hand-written config", "defaults:", "  provider: anthropic"].join("\n") + "\n",
    );

    const path = await upsertCliProvider(
      "openrouter",
      {
        type: "chatcompletions",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      { home: HOME },
    );

    expect(path).toBe(CLI_YAML);
    const content = await readFile(CLI_YAML, "utf-8");
    expect(content).toContain("# my hand-written config");
    expect(content).toContain("provider: anthropic");
    expect(YAML.parse(content).providers).toEqual({
      openrouter: {
        type: "chatcompletions",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
    });
  });

  it("replaces a profile of the same name", async () => {
    await upsertCliProvider(
      "local",
      { type: "chatcompletions", baseUrl: "http://old.test/v1", apiKeyEnv: "LOCAL_API_KEY" },
      { home: HOME },
    );
    await upsertCliProvider(
      "local",
      { type: "chatcompletions", baseUrl: "http://new.test/v1" },
      { home: HOME },
    );

    expect(YAML.parse(await readFile(CLI_YAML, "utf-8")).providers).toEqual({
      local: { type: "chatcompletions", baseUrl: "http://new.test/v1" },
    });
  });
});

describe("writing to the project home", () => {
  it("puts credentials and cli.yaml under the folder's .axle", async () => {
    const cwd = join(TEST_DIR, "proj");
    const target: ConfigTarget = { scope: "project", cwd, home: HOME };

    const credentialsPath = await upsertCredentials({ ANTHROPIC_API_KEY: "folder-key" }, target);
    const configPath = await updateCliDefaults({ provider: "anthropic" }, target);

    expect(credentialsPath).toBe(join(cwd, ".axle", "credentials"));
    expect(configPath).toBe(join(cwd, ".axle", "cli.yaml"));
    expect(await readFile(credentialsPath, "utf-8")).toBe("ANTHROPIC_API_KEY=folder-key\n");
    expect((await stat(credentialsPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(configPath, "utf-8")).toContain("provider: anthropic");
  });
});
