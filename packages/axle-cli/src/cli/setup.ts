import * as clack from "@clack/prompts";
import { ModelInfo } from "@fifthrevision/axle/models";
import type { ServiceConfig } from "./configs/schemas.js";
import { updateCliDefaults, upsertCredentials } from "./configs/writers.js";

interface ProviderChoice {
  value: "anthropic" | "openai" | "gemini" | "chatcompletions";
  label: string;
  keyName: string;
  publisher?: string;
}

const PROVIDER_CHOICES: ProviderChoice[] = [
  { value: "anthropic", label: "Anthropic", keyName: "ANTHROPIC_API_KEY", publisher: "anthropic/" },
  { value: "openai", label: "OpenAI", keyName: "OPENAI_API_KEY", publisher: "openai/" },
  { value: "gemini", label: "Google Gemini", keyName: "GEMINI_API_KEY", publisher: "google/" },
  {
    value: "chatcompletions",
    label: "OpenAI-compatible endpoint (Ollama, OpenRouter, …)",
    keyName: "CHATCOMPLETIONS_API_KEY",
  },
];

export function hasAnyCredentials(serviceConfig: ServiceConfig): boolean {
  return Boolean(
    serviceConfig.anthropic?.apiKey ??
    serviceConfig.openai?.apiKey ??
    serviceConfig.gemini?.apiKey ??
    serviceConfig.chatcompletions?.baseUrl,
  );
}

function ensureNotCancelled<T>(value: T | symbol): T {
  if (clack.isCancel(value)) {
    clack.cancel("Setup cancelled.");
    process.exit(1);
  }
  return value;
}

/**
 * Pick a model for a provider: registry-backed options for known publishers,
 * free text for OpenAI-compatible endpoints (and as an escape hatch).
 */
export async function promptForModel(providerType: string): Promise<string> {
  const choice = PROVIDER_CHOICES.find((c) => c.value === providerType);
  const publisher = choice?.publisher;

  if (publisher) {
    const ids = Object.keys(ModelInfo)
      .filter((id) => id.startsWith(publisher))
      .sort();
    if (ids.length > 0) {
      const OTHER = "__other__";
      const picked = ensureNotCancelled(
        await clack.select({
          message: "Pick a model",
          options: [
            ...ids.map((id) => {
              const info = ModelInfo[id];
              const window = info.contextWindow
                ? `${Math.round(info.contextWindow / 1000)}k context`
                : undefined;
              return { value: id, label: id, hint: window };
            }),
            { value: OTHER, label: "Other (type a model id)" },
          ],
        }),
      );
      if (picked !== OTHER) return picked;
    }
  }

  return ensureNotCancelled(
    await clack.text({
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
    await clack.text({
      message: "Input files (glob or path)",
      placeholder: "data/*.md",
      validate: (value) => ((value ?? "").trim().length === 0 ? "Inputs are required" : undefined),
    }),
  ).trim();
}

/**
 * Fallback for a run that resolved a provider but no model: pick one, and
 * optionally persist it as the provider's default.
 */
export async function promptForMissingModel(
  providerType: string,
  options?: { offerSave?: boolean },
): Promise<string> {
  clack.log.warn(`No model configured for provider ${providerType}.`);
  const model = await promptForModel(providerType);
  if (options?.offerSave !== false) {
    const save = ensureNotCancelled(
      await clack.confirm({
        message: `Save ${model} as the default model for ${providerType}?`,
        initialValue: true,
      }),
    );
    if (save) {
      const path = await updateCliDefaults({ models: { [providerType]: model } });
      clack.log.success(`Saved to ${path}`);
    }
  }
  return model;
}

/**
 * First-run / `axle setup` wizard: pick provider → paste key → write
 * credentials (append-only, chmod 600) → model picker → save defaults in
 * ~/.axle/cli.yaml. Programmatic — no LLM involved.
 */
export async function runSetupWizard(serviceConfig: ServiceConfig): Promise<void> {
  clack.intro("axle setup");

  const provider = ensureNotCancelled(
    await clack.select({
      message: "Which provider should axle use by default?",
      options: PROVIDER_CHOICES.map((c) => ({ value: c.value, label: c.label })),
    }),
  );
  const choice = PROVIDER_CHOICES.find((c) => c.value === provider)!;

  const credentials: Record<string, string> = {};

  if (provider === "chatcompletions") {
    const baseUrl = ensureNotCancelled(
      await clack.text({
        message: "Base URL of the endpoint",
        placeholder: "http://localhost:11434/v1",
        initialValue: serviceConfig.chatcompletions?.baseUrl ?? "",
        validate: (value) =>
          (value ?? "").trim().length === 0 ? "A base URL is required" : undefined,
      }),
    ).trim();
    credentials.CHATCOMPLETIONS_BASE_URL = baseUrl;
  }

  const existingKey = serviceConfig[provider as keyof ServiceConfig]?.apiKey !== undefined;
  let writeKey = true;
  if (existingKey) {
    writeKey = ensureNotCancelled(
      await clack.confirm({
        message: `A key for ${choice.label} is already configured — replace it?`,
        initialValue: false,
      }),
    );
  }
  if (writeKey) {
    const key = ensureNotCancelled(
      await clack.password({
        message:
          provider === "chatcompletions"
            ? "API key (leave empty if the endpoint needs none)"
            : `API key for ${choice.label}`,
        validate: (value) =>
          provider !== "chatcompletions" && (value ?? "").trim().length === 0
            ? "An API key is required"
            : undefined,
      }),
    ).trim();
    if (key.length > 0) {
      credentials[choice.keyName] = key;
    }
  }

  if (Object.keys(credentials).length > 0) {
    const path = await upsertCredentials(credentials);
    clack.log.success(`Credentials written to ${path}`);
  }

  const model = await promptForModel(provider);
  const configPath = await updateCliDefaults({
    provider,
    models: { [provider]: model },
  });
  clack.log.success(`Defaults saved to ${configPath}`);

  clack.outro(`Ready — run axle to chat with ${model}. Re-run anytime with: axle setup`);
}
