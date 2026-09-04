import { describe, expect, it } from "vitest";
import type { CliConfig, JobConfig } from "../../src/cli/configs/schemas.js";
import { needsSetupWizard } from "../../src/cli/setup.js";

describe("needsSetupWizard", () => {
  it("wants the wizard when nothing is configured anywhere", () => {
    expect(needsSetupWizard({}, {}, undefined)).toBe(true);
  });

  it("skips when a built-in credential exists", () => {
    expect(needsSetupWizard({ anthropic: { apiKey: "sk-x" } }, {}, undefined)).toBe(false);
  });

  it("skips when a chatcompletions base URL exists (keyless local endpoint)", () => {
    expect(
      needsSetupWizard(
        { chatcompletions: { baseUrl: "http://localhost:11434/v1" } },
        {},
        undefined,
      ),
    ).toBe(false);
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
