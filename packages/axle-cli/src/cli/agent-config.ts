import type { AgentConfig, AIProvider, MCP, Skill, Span } from "@fifthrevision/axle";
import {
  anthropic,
  bedrock,
  chatCompletions,
  gemini,
  generateContent,
  messages,
  openai,
  openrouter,
  openrouterDialect,
  responses,
  together,
  togetherDialect,
} from "@fifthrevision/axle";
import type { Credentials } from "./configs/loaders.js";
import { API_KEY_VARIABLES } from "./configs/loaders.js";
import type {
  AgentRecipe,
  BedrockProfile,
  CliConfig,
  GenericProfile,
  JobConfig,
  OpenRouterProfile,
  PresetProfile,
  ProviderProfiles,
  ProviderUse,
  ServiceConfig,
} from "./configs/schemas.js";
import { PRESET_NAMES } from "./configs/schemas.js";
import { connectMcps } from "./mcp.js";
import { availableTools, createTools, defaultToolNames, partitionByTrust } from "./tools.js";

export interface CliAgentConfig {
  agentConfig: AgentConfig;
  mcps: MCP[];
  /** Tools withheld because the folder is not trusted. */
  droppedTools: string[];
}

export interface FolderTrust {
  trusted: boolean;
}

/** The provider and model a run resolved to, before the picker fills a missing model. */
export interface RunTarget {
  provider: ProviderUse;
  model?: string;
  providerName: string;
}

/** What a provider use resolves to: a preset call, or a protocol constructor call. */
export type Endpoint =
  | {
      kind: "preset";
      preset: "anthropic" | "openai" | "gemini" | "together";
      config: PresetProfile;
    }
  | { kind: "preset"; preset: "openrouter"; config: OpenRouterProfile }
  | { kind: "preset"; preset: "bedrock"; config: BedrockProfile }
  | { kind: "generic"; config: GenericProfile };

/** The name a provider use goes by: its name, or an inline profile's protocol. */
export function providerNameOf(provider: ProviderUse): string {
  return "name" in provider ? provider.name : provider.protocol;
}

/**
 * The uniform resolution chain (AXL-22):
 *   provider name := job.provider → defaults.provider → error
 *   endpoint      := preset of that name → cli.yaml providers[name] → error
 *   model         := job.model → defaults.models[name] → env/credentials
 *                    `*_MODEL` (presets) → undefined (caller decides:
 *                    picker or error)
 *
 * A named provider stays a name; `resolveEndpoint` looks the profile up
 * again on every run. An inline provider object is a generic profile; its
 * protocol doubles as the name for the defaults.models lookup.
 */
export function resolveTarget(
  jobConfig: Pick<JobConfig, "provider" | "model"> | undefined,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
): RunTarget {
  const jobProvider = jobConfig?.provider;

  let provider: ProviderUse;
  if (jobProvider) {
    provider = jobProvider;
  } else {
    const name = cliConfig.defaults?.provider;
    if (!name) {
      throw new Error(
        "No provider specified and no default provider configured. Add provider: to the job, or set defaults.provider in ~/.axle/cli.yaml.",
      );
    }
    provider = { name };
  }
  const providerName = providerNameOf(provider);

  const endpoint = resolveEndpoint(provider, cliConfig);
  const model =
    jobConfig?.model ??
    cliConfig.defaults?.models?.[providerName] ??
    (endpoint.kind === "preset" ? serviceConfig[endpoint.preset]?.model : undefined);

  return { provider, model, providerName };
}

function isGenericProfile(
  profile: NonNullable<ProviderProfiles[string]>,
): profile is GenericProfile {
  return "protocol" in profile && "baseUrl" in profile;
}

/**
 * Resolves a provider use against the current cli.yaml. An inline provider
 * is a generic profile. A name that matches a preset is that preset, with
 * its profile if there is one; any other name finds its generic profile.
 */
export function resolveEndpoint(provider: ProviderUse, cliConfig: CliConfig): Endpoint {
  if (!("name" in provider)) return { kind: "generic", config: provider };

  const { name } = provider;
  const profiles = cliConfig.providers;
  switch (name) {
    case "anthropic":
    case "openai":
    case "gemini":
    case "together":
      return { kind: "preset", preset: name, config: profiles?.[name] ?? {} };
    case "openrouter":
      return { kind: "preset", preset: name, config: profiles?.openrouter ?? {} };
    case "bedrock": {
      const config = profiles?.bedrock;
      if (!config) {
        throw new Error(
          "bedrock needs a protocol and a region. Add providers.bedrock to cli.yaml with both.",
        );
      }
      return { kind: "preset", preset: name, config };
    }
  }
  const profile = profiles?.[name];
  if (profile && isGenericProfile(profile)) return { kind: "generic", config: profile };
  throw new Error(
    `Provider "${name}" is not a preset (${PRESET_NAMES.join(", ")}) or a provider profile in cli.yaml.`,
  );
}

/** Builds the provider an endpoint describes. A generic endpoint with no key passes "". */
export function createProvider(endpoint: Endpoint, apiKey: string): AIProvider {
  const { maxRetries, timeoutMs } = endpoint.config;
  const client = { maxRetries, timeoutMs };

  if (endpoint.kind === "preset") {
    switch (endpoint.preset) {
      case "anthropic":
        return anthropic(apiKey, client);
      case "openai":
        return openai(apiKey, client);
      case "gemini":
        return gemini(apiKey, client);
      case "together":
        return together(apiKey, client);
      case "openrouter":
        return openrouter(apiKey, { ...client, baseUrl: endpoint.config.baseUrl });
      case "bedrock": {
        const { protocol, region } = endpoint.config;
        return bedrock(apiKey, { ...client, protocol, region });
      }
    }
  }

  const { protocol, baseUrl, id, dialect } = endpoint.config;
  const options = { ...client, baseUrl, apiKey, id };
  switch (protocol) {
    case "messages":
      return messages(options);
    case "responses":
      return responses(options);
    case "generateContent":
      return generateContent(options);
    case "chatCompletions":
      return chatCompletions({
        ...options,
        apiKey: apiKey || undefined,
        dialect:
          dialect === "openrouter"
            ? openrouterDialect
            : dialect === "together"
              ? togetherDialect
              : undefined,
      });
  }
}

function resolveCliProvider(
  target: Pick<RunTarget, "provider" | "model">,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  credentials: Credentials,
): { provider: AIProvider; model: string } {
  const endpoint = resolveEndpoint(target.provider, cliConfig);
  const service = endpoint.kind === "preset" ? serviceConfig[endpoint.preset] : undefined;
  const label = endpoint.kind === "preset" ? endpoint.preset : providerNameOf(target.provider);

  const model = target.model ?? service?.model;
  if (!model) {
    const modelVariable =
      endpoint.kind === "preset" ? `, or set ${endpoint.preset.toUpperCase()}_MODEL` : "";
    throw new Error(
      `No model resolved for provider ${label}. Add model: to the job, or set defaults.models in ~/.axle/cli.yaml${modelVariable}.`,
    );
  }

  const apiKey = resolveApiKey(label, endpoint.config, service, credentials);
  if (apiKey) return { provider: createProvider(endpoint, apiKey), model };

  if (endpoint.kind === "preset") {
    throw new Error(
      `No API key for ${label}. Set ${API_KEY_VARIABLES[endpoint.preset]} in the environment or ~/.axle/credentials, or apiKeyEnv on the provider.`,
    );
  }
  if (endpoint.config.protocol !== "chatCompletions") {
    throw new Error(`No API key for ${label}. Set apiKeyEnv on the provider.`);
  }
  return { provider: createProvider(endpoint, ""), model };
}

function resolveApiKey(
  label: string,
  config: { apiKey?: string; apiKeyEnv?: string },
  service: { apiKey?: string } | undefined,
  credentials: Credentials,
): string | undefined {
  const envName = config.apiKeyEnv;
  if (envName) {
    const apiKey = credentials[envName];
    if (!apiKey) {
      throw new Error(`No API key for ${label}: apiKeyEnv names ${envName}, which is not set.`);
    }
    return apiKey;
  }

  return config.apiKey ?? service?.apiKey;
}

/**
 * The tool names a run asks for before trust is applied: the recipe's own
 * list, else `defaults.tools`, else the built-in set.
 */
export function requestedToolNames(tools: string[] | undefined, cliConfig: CliConfig): string[] {
  return tools ?? validateToolNames(cliConfig.defaults?.tools ?? [...defaultToolNames]);
}

function validateToolNames(names: string[]): string[] {
  const unknown = names.filter((name) => !(availableTools as readonly string[]).includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown tool: ${unknown.join(", ")}. Available: ${availableTools.join(", ")}`);
  }
  return names;
}

/**
 * Turns a run's target and its recipe into runtime objects against the
 * current configuration, on every run including resume. A named provider
 * and an absent tools list are filled from cli.yaml here. Tools that act on
 * the folder are withheld unless the folder is trusted, whichever layer
 * named them. Every skill discovery produced for this run loads; nothing in
 * a recipe selects among them.
 */
export async function createCliAgentConfig(
  target: Pick<RunTarget, "provider" | "model">,
  recipe: AgentRecipe,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  credentials: Credentials,
  span: Span,
  trust: FolderTrust,
  skills: Skill[],
): Promise<CliAgentConfig> {
  const resolvedProvider = resolveCliProvider(target, cliConfig, serviceConfig, credentials);
  const requested = requestedToolNames(
    recipe.tools ? validateToolNames(recipe.tools) : undefined,
    cliConfig,
  );
  const { kept, dropped } = trust.trusted
    ? { kept: requested, dropped: [] }
    : partitionByTrust(requested);
  const mcps = recipe.mcps?.length ? await connectMcps(recipe.mcps, span) : [];

  return {
    agentConfig: {
      provider: resolvedProvider.provider,
      model: resolvedProvider.model,
      system: recipe.system,
      name: recipe.name,
      tools: kept.length > 0 ? createTools(kept) : undefined,
      providerTools: recipe.providerTools?.map((name) => ({ type: "provider", name })),
      mcps: mcps.length > 0 ? mcps : undefined,
      skills: skills.length > 0 ? skills : undefined,
      reasoning: recipe.request?.reasoning,
      maxOutputTokens: recipe.request?.maxOutputTokens,
      toolChoice: recipe.request?.toolChoice,
      parallelToolCalls: recipe.request?.parallelToolCalls,
      cache: recipe.request?.cache,
      providerOptions: recipe.request?.providerOptions,
    },
    mcps,
    droppedTools: dropped,
  };
}
