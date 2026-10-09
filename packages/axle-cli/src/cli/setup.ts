import { inferChatCompletionsVendor } from "@fifthrevision/axle";
import * as ask from "../ui/ask.js";
import type { ConfigHome } from "./configs/loaders.js";
import { readConfigHome } from "./configs/loaders.js";
import type { ConfigScope, ConfigTarget } from "./configs/paths.js";
import type { AIProviderUse, CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import { updateCliDefaults, upsertCliProvider, upsertCredentials } from "./configs/writers.js";
import { isFolderTrusted, trustFolder } from "./trust.js";

interface BuiltInChoice {
  value: "anthropic" | "openai" | "gemini";
  label: string;
  keyName: string;
  publisher: string;
}

const BUILT_IN_CHOICES: BuiltInChoice[] = [
  { value: "anthropic", label: "Anthropic", keyName: "ANTHROPIC_API_KEY", publisher: "anthropic/" },
  { value: "openai", label: "OpenAI", keyName: "OPENAI_API_KEY", publisher: "openai/" },
  { value: "gemini", label: "Google Gemini", keyName: "GEMINI_API_KEY", publisher: "google/" },
];

const ENDPOINT_CHOICE = "endpoint";
const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const PROFILE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function hasAnyCredentials(serviceConfig: ServiceConfig): boolean {
  return Boolean(
    serviceConfig.anthropic?.apiKey ?? serviceConfig.openai?.apiKey ?? serviceConfig.gemini?.apiKey,
  );
}

/**
 * First-run onboarding gate. The wizard is for users with no configuration
 * anywhere — a cli.yaml provider profile or default, or an inline provider
 * block in the recipe, is configuration: let resolution run and report its
 * own errors instead of demanding a built-in key first.
 */
export function needsSetupWizard(
  serviceConfig: ServiceConfig,
  cliConfig: CliConfig,
  jobConfig?: JobConfig,
): boolean {
  if (hasAnyCredentials(serviceConfig)) return false;
  if (Object.keys(cliConfig.providers ?? {}).length > 0) return false;
  if (cliConfig.defaults?.provider) return false;
  if (jobConfig?.provider && !("name" in jobConfig.provider)) return false;
  return true;
}

function ensureNotCancelled<T>(value: T | typeof ask.CANCEL_SYMBOL): T {
  if (ask.isCancel(value)) {
    ask.cancel("Setup cancelled.");
    process.exit(1);
  }
  return value;
}

/** Ask for a model id as free text. */
export async function promptForModel(providerType: string): Promise<string> {
  const publisher = BUILT_IN_CHOICES.find((c) => c.value === providerType)?.publisher;

  return ensureNotCancelled(
    await ask.text({
      message: "Model id",
      placeholder: publisher ? `${publisher}model-name` : "e.g. qwen/qwen-3-coder",
      validate: (value) =>
        (value ?? "").trim().length === 0 ? "A model id is required" : undefined,
    }),
  ).trim();
}

/** `axle batch` with no inputs anywhere: ask for a glob. */
export async function promptForInputs(): Promise<string> {
  return ensureNotCancelled(
    await ask.text({
      message: "Input files (glob or path)",
      placeholder: "data/*.md",
      validate: (value) => ((value ?? "").trim().length === 0 ? "Inputs are required" : undefined),
    }),
  ).trim();
}

/**
 * Fallback for a run that resolved a provider but no model: pick one, and
 * optionally persist it as the provider's default. `saveAs` is the provider
 * *name* the `defaults.models` lookup uses — for a cli.yaml profile it
 * differs from the endpoint type, and saving under the type would never be
 * found again.
 */
export async function promptForMissingModel(
  providerType: string,
  options?: { offerSave?: boolean; saveAs?: string },
): Promise<string> {
  const saveAs = options?.saveAs ?? providerType;
  ask.log.warn(`No model configured for provider ${saveAs}.`);
  const model = await promptForModel(providerType);
  if (options?.offerSave !== false) {
    const save = ensureNotCancelled(
      await ask.confirm({
        message: `Save ${model} as the default model for ${saveAs}?`,
        initialValue: true,
      }),
    );
    if (save) {
      const path = await updateCliDefaults({ models: { [saveAs]: model } });
      ask.log.success(`Saved to ${path}`);
    }
  }
  return model;
}

/**
 * First-run / `axle setup` wizard: pick the home to set up (this folder's
 * `.axle/` or the user's) → pick provider → paste key → write credentials
 * (append-only, chmod 600) → model picker → save defaults in that home's
 * cli.yaml. An OpenAI-compatible endpoint is saved as a named provider
 * profile. Programmatic — no LLM involved.
 */
export async function runSetupWizard(): Promise<void> {
  const target: ConfigTarget = { scope: await promptForScope() };
  const home = await readConfigHome(target);

  const options: { value: string; label: string }[] = [
    ...BUILT_IN_CHOICES.map((c) => ({ value: c.value, label: c.label })),
    { value: ENDPOINT_CHOICE, label: "OpenAI-compatible endpoint (Ollama, OpenRouter, …)" },
  ];
  const selected = ensureNotCancelled(
    await ask.select({ message: "Which provider should axle use by default?", options }),
  );
  const builtIn = BUILT_IN_CHOICES.find((c) => c.value === selected);

  const provider = builtIn
    ? await setUpBuiltIn(builtIn, home, target)
    : await setUpEndpoint(home, target);

  const model = await promptForModel(provider.type);
  const configPath = await updateCliDefaults(
    { provider: provider.name, models: { [provider.name]: model } },
    target,
  );
  ask.log.success(`Defaults saved to ${configPath}`);

  ask.outro(`Ready — run axle to chat with ${model}. Re-run anytime with: axle setup`);
}

async function promptForScope(): Promise<ConfigScope> {
  const options: { value: ConfigScope; label: string }[] = [
    { value: "user", label: "Your user config (~/.axle), for every folder" },
    { value: "project", label: "This folder (./.axle) only" },
  ];
  const scope = ensureNotCancelled(await ask.select({ message: "Set up axle for", options }));
  if (scope === "user" || (await isFolderTrusted(process.cwd()))) return scope;

  const trust = ensureNotCancelled(
    await ask.confirm({
      message: "This folder is untrusted, so its .axle/ is not read. Trust it?",
      initialValue: false,
    }),
  );
  if (!trust) {
    ask.cancel("Setup cancelled: a folder's .axle/ is only read once the folder is trusted.");
    process.exit(1);
  }
  await trustFolder(process.cwd());
  return scope;
}

async function writeKey(keyName: string, key: string, target: ConfigTarget): Promise<void> {
  const path = await upsertCredentials({ [keyName]: key }, target);
  ask.log.success(`Credentials written to ${path}`);
  if (target.scope === "project") {
    ask.log.warn("Keep .axle/credentials out of version control.");
  }
  if (process.env[keyName]) {
    ask.log.warn(`${keyName} is also set in the environment, which wins over this file.`);
  }
}

async function setUpBuiltIn(
  choice: BuiltInChoice,
  home: ConfigHome,
  target: ConfigTarget,
): Promise<{ name: string; type: AIProviderUse["type"] }> {
  let replaceKey = true;
  if (home.credentials[choice.keyName]) {
    replaceKey = ensureNotCancelled(
      await ask.confirm({
        message: `A key for ${choice.label} is already configured here — replace it?`,
        initialValue: false,
      }),
    );
  }
  if (replaceKey) {
    const key = ensureNotCancelled(
      await ask.password({
        message: `API key for ${choice.label}`,
        validate: (value) =>
          (value ?? "").trim().length === 0 ? "An API key is required" : undefined,
      }),
    ).trim();
    await writeKey(choice.keyName, key, target);
  }
  return { name: choice.value, type: choice.value };
}

async function setUpEndpoint(
  home: ConfigHome,
  target: ConfigTarget,
): Promise<{ name: string; type: AIProviderUse["type"] }> {
  const baseUrl = ensureNotCancelled(
    await ask.text({ message: "Base URL of the endpoint", defaultValue: OLLAMA_BASE_URL }),
  ).trim();

  const name = await promptForProfileName(baseUrl, home.cliConfig);

  const key = ensureNotCancelled(
    await ask.password({ message: "API key (leave empty if the endpoint needs none)" }),
  ).trim();

  const profile: AIProviderUse = { type: "chatcompletions", baseUrl };
  if (key.length > 0) {
    const keyName = `${name.toUpperCase().replaceAll("-", "_")}_API_KEY`;
    await writeKey(keyName, key, target);
    profile.apiKeyEnv = keyName;
  }

  const configPath = await upsertCliProvider(name, profile, target);
  ask.log.success(`Provider ${name} saved to ${configPath}`);
  return { name, type: profile.type };
}

async function promptForProfileName(baseUrl: string, cliConfig: CliConfig): Promise<string> {
  const defaultName = baseUrl === OLLAMA_BASE_URL ? "ollama" : undefined;
  for (;;) {
    const name = ensureNotCancelled(
      await ask.text({
        message: "Name for this provider",
        defaultValue: defaultName,
        initialValue: inferChatCompletionsVendor(baseUrl) ?? "",
        validate: (value) => {
          const typed = (value ?? "").trim();
          if (typed.length === 0 && defaultName !== undefined) return undefined;
          return PROFILE_NAME_PATTERN.test(typed)
            ? undefined
            : "Use letters, digits, - and _, starting with a letter";
        },
      }),
    ).trim();

    if (cliConfig.providers?.[name] === undefined) return name;
    const replace = ensureNotCancelled(
      await ask.confirm({
        message: `A provider named ${name} already exists here — replace it?`,
        initialValue: false,
      }),
    );
    if (replace) return name;
  }
}
