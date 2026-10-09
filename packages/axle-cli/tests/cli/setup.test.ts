import { beforeEach, describe, expect, it, vi } from "vitest";
import { readConfigHome } from "../../src/cli/configs/loaders.js";
import type { CliConfig, JobConfig } from "../../src/cli/configs/schemas.js";
import {
  updateCliDefaults,
  upsertCliProvider,
  upsertCredentials,
} from "../../src/cli/configs/writers.js";
import { needsSetupWizard, runSetupWizard } from "../../src/cli/setup.js";
import { isFolderTrusted, trustFolder } from "../../src/cli/trust.js";
import * as ask from "../../src/ui/ask.js";

vi.mock("../../src/cli/configs/loaders.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/cli/configs/loaders.js")>()),
  readConfigHome: vi.fn(),
}));

vi.mock("../../src/cli/trust.js", () => ({
  isFolderTrusted: vi.fn(),
  trustFolder: vi.fn(),
}));

vi.mock("../../src/cli/configs/writers.js", () => ({
  updateCliDefaults: vi.fn(async () => "cli.yaml"),
  upsertCliProvider: vi.fn(async () => "cli.yaml"),
  upsertCredentials: vi.fn(async () => "credentials"),
}));

vi.mock("../../src/ui/ask.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/ui/ask.js")>()),
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: { success: vi.fn(), warn: vi.fn() },
}));

describe("needsSetupWizard", () => {
  it("wants the wizard when nothing is configured anywhere", () => {
    expect(needsSetupWizard({}, {}, undefined)).toBe(true);
  });

  it("skips when a built-in credential exists", () => {
    expect(needsSetupWizard({ anthropic: { apiKey: "sk-x" } }, {}, undefined)).toBe(false);
  });

  it("skips when cli.yaml has a provider profile", () => {
    const cliConfig: CliConfig = {
      providers: { work: { type: "anthropic", apiKeyEnv: "WORK_KEY" } },
    };
    expect(needsSetupWizard({}, cliConfig, undefined)).toBe(false);
  });

  it("skips when cli.yaml has a default provider", () => {
    expect(needsSetupWizard({}, { defaults: { provider: "anthropic" } }, undefined)).toBe(false);
  });

  it("skips when the recipe carries inline provider configuration", () => {
    const jobConfig = {
      task: "x",
      provider: { type: "chatcompletions", baseUrl: "http://localhost:1/v1" },
    } as JobConfig;
    expect(needsSetupWizard({}, {}, jobConfig)).toBe(false);
  });

  it("still wants the wizard for a bare provider name with no credentials", () => {
    const jobConfig = { task: "x", provider: { name: "anthropic" } } as JobConfig;
    expect(needsSetupWizard({}, {}, jobConfig)).toBe(true);
  });
});

describe("runSetupWizard", () => {
  const USER = { scope: "user" };
  const PROJECT = { scope: "project" };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.mocked(readConfigHome).mockResolvedValue({ credentials: {}, cliConfig: {} });
    vi.mocked(updateCliDefaults).mockResolvedValue("cli.yaml");
    vi.mocked(upsertCliProvider).mockResolvedValue("cli.yaml");
    vi.mocked(upsertCredentials).mockResolvedValue("credentials");
  });

  it("saves an OpenAI-compatible endpoint as a named profile with its own key variable", async () => {
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("endpoint");
    vi.mocked(ask.text)
      .mockResolvedValueOnce("https://openrouter.ai/api/v1")
      .mockResolvedValueOnce("openrouter")
      .mockResolvedValueOnce("z-ai/glm-4.6");
    vi.mocked(ask.password).mockResolvedValue("sk-or");

    await runSetupWizard();

    expect(vi.mocked(ask.text).mock.calls[1][0].initialValue).toBe("openrouter");
    expect(upsertCredentials).toHaveBeenCalledWith({ OPENROUTER_API_KEY: "sk-or" }, USER);
    expect(upsertCliProvider).toHaveBeenCalledWith(
      "openrouter",
      {
        type: "chatcompletions",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKeyEnv: "OPENROUTER_API_KEY",
      },
      USER,
    );
    expect(updateCliDefaults).toHaveBeenCalledWith(
      { provider: "openrouter", models: { openrouter: "z-ai/glm-4.6" } },
      USER,
    );
  });

  it("writes a keyless profile when no key is given", async () => {
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("endpoint");
    vi.mocked(ask.text)
      .mockResolvedValueOnce("http://localhost:11434/v1")
      .mockResolvedValueOnce("my-ollama")
      .mockResolvedValueOnce("gemma3");
    vi.mocked(ask.password).mockResolvedValue("");

    await runSetupWizard();

    expect(upsertCredentials).not.toHaveBeenCalled();
    expect(upsertCliProvider).toHaveBeenCalledWith(
      "my-ollama",
      { type: "chatcompletions", baseUrl: "http://localhost:11434/v1" },
      USER,
    );
  });

  it("offers the Ollama URL and name as defaults", async () => {
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("endpoint");
    vi.mocked(ask.text)
      .mockResolvedValueOnce("http://localhost:11434/v1")
      .mockResolvedValueOnce("ollama")
      .mockResolvedValueOnce("gemma3");
    vi.mocked(ask.password).mockResolvedValue("");

    await runSetupWizard();

    const [url, name] = vi.mocked(ask.text).mock.calls.map(([options]) => options);
    expect(url.defaultValue).toBe("http://localhost:11434/v1");
    expect(name.defaultValue).toBe("ollama");
  });

  it("offers no default name for any other endpoint", async () => {
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("endpoint");
    vi.mocked(ask.text)
      .mockResolvedValueOnce("http://localhost:1234/v1")
      .mockResolvedValueOnce("lmstudio")
      .mockResolvedValueOnce("gemma3");
    vi.mocked(ask.password).mockResolvedValue("");

    await runSetupWizard();

    const name = vi.mocked(ask.text).mock.calls[1][0];
    expect(name.defaultValue).toBeUndefined();
  });

  it("asks for another name when an existing profile is not to be replaced", async () => {
    vi.mocked(readConfigHome).mockResolvedValue({
      credentials: {},
      cliConfig: {
        providers: { local: { type: "chatcompletions", baseUrl: "http://old.test/v1" } },
      },
    });
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("endpoint");
    vi.mocked(ask.text)
      .mockResolvedValueOnce("http://localhost:11434/v1")
      .mockResolvedValueOnce("local")
      .mockResolvedValueOnce("local2")
      .mockResolvedValueOnce("gemma3");
    vi.mocked(ask.confirm).mockResolvedValue(false);
    vi.mocked(ask.password).mockResolvedValue("");

    await runSetupWizard();

    expect(upsertCliProvider).toHaveBeenCalledWith("local2", expect.anything(), USER);
  });

  it("writes a built-in provider's key and defaults, and no profile", async () => {
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("anthropic");
    vi.mocked(ask.password).mockResolvedValue("sk-ant");
    vi.mocked(ask.text).mockResolvedValueOnce("anthropic/claude-sonnet-5");

    await runSetupWizard();

    expect(isFolderTrusted).not.toHaveBeenCalled();
    expect(upsertCredentials).toHaveBeenCalledWith({ ANTHROPIC_API_KEY: "sk-ant" }, USER);
    expect(upsertCliProvider).not.toHaveBeenCalled();
    expect(updateCliDefaults).toHaveBeenCalledWith(
      { provider: "anthropic", models: { anthropic: "anthropic/claude-sonnet-5" } },
      USER,
    );
  });

  it("writes everything to the folder when the folder is chosen", async () => {
    vi.mocked(isFolderTrusted).mockResolvedValue(true);
    vi.mocked(ask.select).mockResolvedValueOnce("project").mockResolvedValueOnce("anthropic");
    vi.mocked(ask.password).mockResolvedValue("sk-folder");
    vi.mocked(ask.text).mockResolvedValueOnce("anthropic/claude-sonnet-5");

    await runSetupWizard();

    expect(ask.confirm).not.toHaveBeenCalled();
    expect(readConfigHome).toHaveBeenCalledWith(PROJECT);
    expect(upsertCredentials).toHaveBeenCalledWith({ ANTHROPIC_API_KEY: "sk-folder" }, PROJECT);
    expect(updateCliDefaults).toHaveBeenCalledWith(expect.anything(), PROJECT);
    expect(ask.log.warn).toHaveBeenCalledWith("Keep .axle/credentials out of version control.");
  });

  it("asks about a key only when the chosen home already holds one", async () => {
    vi.mocked(readConfigHome).mockResolvedValue({
      credentials: { ANTHROPIC_API_KEY: "sk-existing" },
      cliConfig: {},
    });
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("anthropic");
    vi.mocked(ask.confirm).mockResolvedValue(false);
    vi.mocked(ask.text).mockResolvedValueOnce("anthropic/claude-sonnet-5");

    await runSetupWizard();

    expect(ask.password).not.toHaveBeenCalled();
    expect(upsertCredentials).not.toHaveBeenCalled();
  });

  it("warns when the environment already sets the key being written", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-env");
    vi.mocked(ask.select).mockResolvedValueOnce("user").mockResolvedValueOnce("anthropic");
    vi.mocked(ask.password).mockResolvedValue("sk-ant");
    vi.mocked(ask.text).mockResolvedValueOnce("anthropic/claude-sonnet-5");

    await runSetupWizard();

    expect(ask.log.warn).toHaveBeenCalledWith(
      "ANTHROPIC_API_KEY is also set in the environment, which wins over this file.",
    );
  });

  it("trusts an untrusted folder on a yes, then sets it up", async () => {
    vi.mocked(isFolderTrusted).mockResolvedValue(false);
    vi.mocked(ask.select).mockResolvedValueOnce("project").mockResolvedValueOnce("anthropic");
    vi.mocked(ask.confirm).mockResolvedValue(true);
    vi.mocked(ask.password).mockResolvedValue("sk-folder");
    vi.mocked(ask.text).mockResolvedValueOnce("anthropic/claude-sonnet-5");

    await runSetupWizard();

    expect(trustFolder).toHaveBeenCalledWith(process.cwd());
    expect(upsertCredentials).toHaveBeenCalledWith({ ANTHROPIC_API_KEY: "sk-folder" }, PROJECT);
  });

  it("cancels without writing when trust is declined", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    vi.mocked(isFolderTrusted).mockResolvedValue(false);
    vi.mocked(ask.select).mockResolvedValueOnce("project");
    vi.mocked(ask.confirm).mockResolvedValue(false);

    await expect(runSetupWizard()).rejects.toThrow("exit");

    expect(exit).toHaveBeenCalledWith(1);
    expect(ask.cancel).toHaveBeenCalledWith(
      "Setup cancelled: a folder's .axle/ is only read once the folder is trusted.",
    );
    expect(trustFolder).not.toHaveBeenCalled();
    expect(upsertCredentials).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
