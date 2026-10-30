import type {
  AgentConfig,
  AIProvider,
  ChatCompletionsDialect,
  MCP,
  Skill,
  Span,
} from "@fifthrevision/axle";
import {
  anthropic,
  chatCompletions,
  gemini,
  openai,
  openrouterDialect,
  togetherDialect,
} from "@fifthrevision/axle";
import type { Credentials } from "./configs/loaders.js";
import { API_KEY_VARIABLES } from "./configs/loaders.js";
import type {
  AgentRecipe,
  CliConfig,
  JobConfig,
  ProviderUse,
  ServiceConfig,
} from "./configs/schemas.js";
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

const BUILT_IN_PROVIDER_TYPES = ["anthropic", "openai", "gemini"];

/** The name a provider use goes by: its profile name, or an inline endpoint's type. */
export function providerNameOf(provider: ProviderUse): string {
  return "name" in provider ? provider.name : provider.type;
}

/**
 * The uniform resolution chain (AXL-22):
 *   provider name := job.provider → defaults.provider → error
 *   endpoint      := cli.yaml providers[name] → built-in type → error
 *   model         := job.model → defaults.models[name] → env/credentials
 *                    `*_MODEL` (built-in types) → undefined (caller decides:
 *                    picker or error)
 *
 * A named provider stays a name; `resolveEndpoint` looks the profile up
 * again on every run. An inline provider object is its own endpoint; its
 * type doubles as the name for the defaults.models lookup.
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
    serviceConfig[endpoint.type as keyof ServiceConfig]?.model;

  return { provider, model, providerName };
}

/**
 * Resolves a provider use against the current cli.yaml: an inline endpoint
 * is returned as is; a name finds its profile, else a built-in type, else
 * fails.
 */
export function resolveEndpoint(
  provider: ProviderUse,
  cliConfig: CliConfig,
): { type: string; config: Record<string, unknown> } {
  if (!("name" in provider)) {
    const { type, ...config } = provider;
    return { type, config };
  }
  const profile = cliConfig.providers?.[provider.name];
  if (profile) {
    const { type, ...config } = profile;
    return { type, config };
  }
  if (BUILT_IN_PROVIDER_TYPES.includes(provider.name)) {
    return { type: provider.name, config: {} };
  }
  throw new Error(
    `Provider "${provider.name}" is not a provider profile in cli.yaml or a built-in provider type.`,
  );
}

function resolveCliProvider(
  target: Pick<RunTarget, "provider" | "model">,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  credentials: Credentials,
): { provider: AIProvider; model: string } {
  const endpoint = resolveEndpoint(target.provider, cliConfig);
  const type = endpoint.type;
  const config = {
    ...serviceConfig[type as keyof ServiceConfig],
    ...endpoint.config,
  } as Record<string, any>;

  const model = target.model ?? config.model;
  if (!model) {
    const modelVariable = type in API_KEY_VARIABLES ? `, or set ${type.toUpperCase()}_MODEL` : "";
    throw new Error(
      `No model resolved for provider ${type}. Add model: to the job, or set defaults.models in ~/.axle/cli.yaml${modelVariable}.`,
    );
  }

  switch (type) {
    case "openai": {
      const apiKey = requireApiKey(type, config, credentials);
      return {
        provider: openai(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "anthropic": {
      const apiKey = requireApiKey(type, config, credentials);
      return {
        provider: anthropic(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "gemini": {
      const apiKey = requireApiKey(type, config, credentials);
      return {
        provider: gemini(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "chatcompletions": {
      const baseUrl = config.baseUrl;
      if (!baseUrl) {
        throw new Error("No base URL for chatcompletions. Set baseUrl on the provider.");
      }
      return {
        provider: chatCompletions({
          baseUrl,
          apiKey: resolveApiKey(type, config, credentials),
          maxRetries: config.maxRetries,
          timeoutMs: config.timeoutMs,
          ...(typeof config.vendor === "string" ? vendorProvider(config.vendor) : {}),
        }),
        model,
      };
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

function resolveApiKey(
  type: string,
  config: Record<string, any>,
  credentials: Credentials,
): string | undefined {
  const envName = config.apiKeyEnv;
  if (typeof envName === "string" && envName.length > 0) {
    const apiKey = credentials[envName];
    if (!apiKey) {
      throw new Error(`No API key for ${type}: apiKeyEnv names ${envName}, which is not set.`);
    }
    return apiKey;
  }

  return config.apiKey;
}

function requireApiKey(
  type: keyof typeof API_KEY_VARIABLES,
  config: Record<string, any>,
  credentials: Credentials,
): string {
  const apiKey = resolveApiKey(type, config, credentials);
  if (apiKey) return apiKey;
  throw new Error(
    `No API key for ${type}. Set ${API_KEY_VARIABLES[type]} in the environment or ~/.axle/credentials, or apiKeyEnv on the provider.`,
  );
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

function vendorProvider(
  vendor: string,
): { id: string; dialect: ChatCompletionsDialect } | undefined {
  if (vendor === "openrouter") return { id: "openrouter", dialect: openrouterDialect };
  if (vendor === "togetherai") return { id: "togetherai", dialect: togetherDialect };
  return undefined;
}
