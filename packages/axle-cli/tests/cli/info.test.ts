import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InfoInput } from "../../src/cli/info.js";
import { formatInfo } from "../../src/cli/info.js";

const TEST_DIR = join(import.meta.dirname, "__info_tmp__");
const dirs = { user: join(TEST_DIR, "home", ".axle"), project: join(TEST_DIR, "cwd", ".axle") };
const USER_CONFIG = join(dirs.user, "cli.yaml");
const PROJECT_CONFIG = join(dirs.project, "cli.yaml");

beforeEach(async () => {
  await mkdir(dirs.user, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

function info(overrides: Partial<InfoInput>): string[] {
  return formatInfo({
    version: "1.2.3",
    dirs,
    cliConfig: {},
    cliConfigSources: { providers: {}, defaultModels: {} },
    serviceConfig: {},
    credentialSources: {},
    env: {},
    ...overrides,
  });
}

function section(lines: string[], title: string, nextTitle?: string): string[] {
  const start = lines.indexOf(title) + 1;
  const end = nextTitle === undefined ? lines.length : lines.indexOf(nextTitle) - 1;
  return lines.slice(start, end);
}

describe("formatInfo", () => {
  it("reports which config files exist, relative to home and cwd", async () => {
    await writeFile(USER_CONFIG, "");
    const lines = info({});

    expect(lines[0]).toMatch(/^axle 1\.2\.3 · node /);
    expect(section(lines, "Config files", "Defaults")).toEqual([
      "  ~/.axle/cli.yaml     found",
      "  ~/.axle/credentials  missing",
      "  ./.axle/cli.yaml     missing",
      "  ./.axle/credentials  missing",
    ]);
  });

  it("names the file that sets each default", () => {
    const lines = info({
      cliConfig: { defaults: { provider: "anthropic", tools: ["exec"] } },
      cliConfigSources: {
        providers: {},
        defaultProvider: PROJECT_CONFIG,
        defaultTools: USER_CONFIG,
        defaultModels: {},
      },
    });

    expect(section(lines, "Defaults", "Providers")).toEqual([
      "  provider  anthropic  ./.axle/cli.yaml",
      "  tools     exec       ~/.axle/cli.yaml",
    ]);
  });

  it("explains a missing default provider instead of failing", () => {
    const lines = info({});

    expect(section(lines, "Defaults", "Providers")).toEqual([
      "  provider  unset",
      "  tools     axle-help, exec, patch-file, read-file, write-file  built-in default",
      expect.stringMatching(/^  ✖ No provider specified/),
    ]);
  });

  it("names where each provider value comes from without printing a key", () => {
    const lines = info({
      cliConfig: {
        providers: {
          work: { type: "anthropic", apiKeyEnv: "WORK_KEY" },
          inline: { type: "openai", apiKey: "sk-inline" },
          router: { type: "chatcompletions", baseUrl: "https://router.test/v1", apiKeyEnv: "NOPE" },
        },
        defaults: { provider: "work", models: { work: "claude-x" } },
      },
      cliConfigSources: {
        providers: { work: PROJECT_CONFIG, inline: USER_CONFIG, router: USER_CONFIG },
        defaultProvider: USER_CONFIG,
        defaultModels: { work: PROJECT_CONFIG },
      },
      serviceConfig: { gemini: { apiKey: "sk-gemini", model: "gemini-x" } },
      credentialSources: {
        WORK_KEY: "environment",
        GEMINI_API_KEY: join(dirs.user, "credentials"),
        GEMINI_MODEL: join(dirs.project, "credentials"),
      },
      env: { WORK_KEY: "sk-work" },
    });

    expect(lines.join("\n")).not.toMatch(/sk-/);
    expect(section(lines, "Providers", "Environment")).toEqual([
      "  work (default)      ./.axle/cli.yaml",
      "    type   anthropic",
      "    model  claude-x   ./.axle/cli.yaml",
      "    key    $WORK_KEY  environment",
      "",
      "  inline           ~/.axle/cli.yaml",
      "    type   openai",
      "    model  unset",
      "    key    set     ~/.axle/cli.yaml",
      "",
      "  router                           ~/.axle/cli.yaml",
      "    type   chatcompletions",
      "    url    https://router.test/v1",
      "    model  unset",
      "    key    $NOPE                   unset",
      "",
      "  gemini",
      "    model  gemini-x  ./.axle/credentials",
      "    key    set       ~/.axle/credentials",
      "",
      "  not configured: anthropic, openai, chatcompletions",
    ]);
  });

  it("leaves development overrides out of the environment section", () => {
    const lines = info({
      env: {
        AXLE_CONTEXT_WINDOW: "3000",
        AXLE_SCHEDULE_PLATFORM: "linux",
        AXLE_LAUNCHCTL: "/tmp/fake-launchctl",
      },
    });

    expect(section(lines, "Environment")).toEqual(["  AXLE_CONTEXT_WINDOW  3000"]);
  });
});
