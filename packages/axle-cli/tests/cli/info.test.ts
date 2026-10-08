import { ModelCatalog } from "@fifthrevision/axle";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfoInput } from "../../src/cli/info.js";
import { formatInfo } from "../../src/cli/info.js";

const emptyCatalog = await ModelCatalog.open();

const catalogEntry = {
  name: "Claude X",
  attachment: true,
  reasoning: true,
  tool_call: true,
  release_date: "2026-01-01",
  last_updated: "2026-01-01",
  modalities: { input: ["text"], output: ["text"] },
  open_weights: false,
  limit: { context: 1_000_000, output: 64_000 },
};

async function catalogWith(models: Record<string, unknown>, hosts: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.endsWith("/models.json") ? models : hosts), {
          status: 200,
        }),
      ),
    ),
  );
  try {
    const catalog = await ModelCatalog.open();
    await catalog.refresh();
    return catalog;
  } finally {
    vi.unstubAllGlobals();
  }
}

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
    trusted: true,
    cliConfig: {},
    cliConfigSources: { providers: {}, defaultModels: {} },
    serviceConfig: {},
    credentialSources: {},
    env: {},
    catalog: emptyCatalog,
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
    expect(section(lines, "Providers")).toEqual([
      "  work (default)       ./.axle/cli.yaml",
      "    type    anthropic",
      "    model   claude-x   ./.axle/cli.yaml",
      "    window  200,000    assumed (models.dev not cached)",
      "    key     $WORK_KEY  environment",
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
      "    model   gemini-x  ./.axle/credentials",
      "    window  200,000   assumed (models.dev not cached)",
      "    key     set       ~/.axle/credentials",
      "",
      "  not configured: anthropic, openai, chatcompletions",
    ]);
  });

  it("shows each provider's context window and where it came from", async () => {
    const catalog = await catalogWith(
      { "anthropic/claude-x": catalogEntry, "zhipuai/glm-x": catalogEntry },
      {
        openrouter: {
          models: {
            "z-ai/glm-x": {
              ...catalogEntry,
              limit: { context: 131_072 },
              cost: { input: 0.1, output: 0.2 },
              canonical_model_id: "zhipuai/glm-x",
            },
          },
        },
      },
    );
    const lines = info({
      catalog,
      cliConfig: {
        providers: {
          router: { type: "chatcompletions", vendor: "openrouter", baseUrl: "https://r.test/v1" },
          ollama: {
            type: "chatcompletions",
            baseUrl: "http://localhost:11434/v1",
            contextWindow: 32_768,
          },
        },
        defaults: {
          provider: "anthropic",
          models: { anthropic: "claude-x", router: "z-ai/glm-x", ollama: "gemma4:26b-mlx" },
        },
      },
      cliConfigSources: {
        providers: { router: USER_CONFIG, ollama: PROJECT_CONFIG },
        defaultModels: { anthropic: USER_CONFIG, router: USER_CONFIG, ollama: USER_CONFIG },
      },
      serviceConfig: { anthropic: { apiKey: "sk-a" } },
    });

    expect(section(lines, "Providers")).toEqual([
      "  router                       ~/.axle/cli.yaml",
      "    type    chatcompletions",
      "    url     https://r.test/v1",
      "    model   z-ai/glm-x         ~/.axle/cli.yaml",
      "    window  131,072            models.dev (zhipuai/glm-x)",
      "    key     unset              expects $CHATCOMPLETIONS_API_KEY",
      "",
      "  ollama                               ./.axle/cli.yaml",
      "    type    chatcompletions",
      "    url     http://localhost:11434/v1",
      "    model   gemma4:26b-mlx             ~/.axle/cli.yaml",
      "    window  32,768                     ./.axle/cli.yaml",
      "    key     unset                      expects $CHATCOMPLETIONS_API_KEY",
      "",
      "  anthropic (default)",
      "    model   claude-x   ~/.axle/cli.yaml",
      "    window  1,000,000  models.dev (anthropic/claude-x)",
      "    key     set",
      "",
      "  not configured: openai, gemini, chatcompletions",
    ]);
  });

  it("marks the window as assumed when the catalog has never been fetched", () => {
    const lines = info({
      cliConfig: { defaults: { provider: "anthropic", models: { anthropic: "claude-x" } } },
      serviceConfig: { anthropic: { apiKey: "sk-a" } },
    });

    expect(lines).toContain("    window  200,000   assumed (models.dev not cached)");
  });
});

describe("formatInfo folder trust", () => {
  it("marks an untrusted folder and the project files it ignores", async () => {
    await mkdir(dirs.project, { recursive: true });
    await writeFile(PROJECT_CONFIG, "");

    const lines = info({ trusted: false });

    expect(lines[1]).toMatch(/ · not trusted \(run axle trust\)$/);
    expect(section(lines, "Config files", "Defaults")).toEqual([
      "  ~/.axle/cli.yaml     missing",
      "  ~/.axle/credentials  missing",
      "  ./.axle/cli.yaml     found, ignored",
      "  ./.axle/credentials  missing",
    ]);
  });

  it("marks a trusted folder", () => {
    expect(info({})[1]).toMatch(/ · trusted$/);
  });
});
