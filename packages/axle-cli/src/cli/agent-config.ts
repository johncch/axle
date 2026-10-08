import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  MCP,
  ProviderDefinition,
  Skill,
  Span,
} from "@fifthrevision/axle";
import { anthropic, chatCompletions, createAgentConfig, gemini, openai } from "@fifthrevision/axle";
import { API_KEY_VARIABLES } from "./configs/loaders.js";
import type { CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import { connectMcps } from "./mcp.js";
import { availableTools, createTools, defaultToolNames, partitionByTrust } from "./tools.js";

export interface CliAgentConfig {
  agentConfig: AgentConfig;
  definition: AgentDefinition;
  mcps: MCP[];
  /** Tools withheld because the folder is not trusted. */
  droppedTools: string[];
}

export interface FolderTrust {
  trusted: boolean;
}

const BUILT_IN_PROVIDER_TYPES = ["anthropic", "openai", "gemini", "chatcompletions"];

/**
 * The uniform resolution chain (AXL-22):
 *   provider name := job.provider → defaults.provider → error
 *   endpoint      := cli.yaml providers[name] → built-in type → error
 *   model         := job.model → defaults.models[name] → env/credentials
 *                    `*_MODEL` → undefined (caller decides: picker or error)
 *
 * The definition keeps a named provider as its name only; `resolveEndpoint`
 * looks the profile up again on every run. An inline provider object in the
 * job is its own endpoint, carried in `config`; its type doubles as the name
 * for the defaults.models lookup.
 */
export function resolveTarget(
  jobConfig: Pick<JobConfig, "provider" | "model"> | undefined,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
): { provider: ProviderDefinition; model?: string; providerName: string } {
  const jobProvider = jobConfig?.provider;

  let provider: ProviderDefinition;
  let providerName: string;

  if (jobProvider && !("name" in jobProvider)) {
    const { type, ...config } = jobProvider;
    provider = Object.keys(config).length > 0 ? { type, config } : { type };
    providerName = type;
  } else {
    const name =
      jobProvider && "name" in jobProvider ? jobProvider.name : cliConfig.defaults?.provider;
    if (!name) {
      throw new Error(
        "No provider specified and no default provider configured. Add provider: to the job, or set defaults.provider in ~/.axle/cli.yaml.",
      );
    }
    provider = { type: name };
    providerName = name;
  }

  const endpoint = resolveEndpoint(provider, cliConfig);
  const model =
    jobConfig?.model ??
    cliConfig.defaults?.models?.[providerName] ??
    serviceConfig[endpoint.type as keyof ServiceConfig]?.model;

  return { provider, model, providerName };
}

/**
 * Resolves a definition's provider reference against the current cli.yaml:
 * an inline endpoint is returned as is; a name finds its profile, else a
 * built-in type, else fails.
 */
export function resolveEndpoint(
  provider: ProviderDefinition,
  cliConfig: CliConfig,
): { type: string; config: Record<string, unknown> } {
  if (provider.config) return { type: provider.type, config: provider.config };
  const profile = cliConfig.providers?.[provider.type];
  if (profile) {
    const { type, ...config } = profile;
    return { type, config };
  }
  if (BUILT_IN_PROVIDER_TYPES.includes(provider.type)) {
    return { type: provider.type, config: {} };
  }
  throw new Error(
    `Provider "${provider.type}" is not a provider profile in cli.yaml or a built-in provider type.`,
  );
}

function resolveCliProvider(
  definition: ProviderDefinition,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  definitionModel: string | undefined,
): { provider: AIProvider; model: string } {
  const endpoint = resolveEndpoint(definition, cliConfig);
  const type = endpoint.type;
  const config = {
    ...serviceConfig[type as keyof ServiceConfig],
    ...endpoint.config,
  } as Record<string, any>;

  const model = definitionModel ?? config.model;
  if (!model) {
    throw new Error(
      `No model resolved for provider ${type}. Add model: to the job, set defaults.models in ~/.axle/cli.yaml, or set ${type.toUpperCase()}_MODEL.`,
    );
  }

  switch (type) {
    case "openai": {
      const apiKey = requireApiKey(type, config);
      return {
        provider: openai(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "anthropic": {
      const apiKey = requireApiKey(type, config);
      return {
        provider: anthropic(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "gemini": {
      const apiKey = requireApiKey(type, config);
      return {
        provider: gemini(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "chatcompletions": {
      const baseUrl = config.baseUrl;
      if (!baseUrl) {
        throw new Error(
          "No base URL for chatcompletions. Set baseUrl on the provider, or CHATCOMPLETIONS_BASE_URL in the environment or ~/.axle/credentials.",
        );
      }
      return {
        provider: chatCompletions(baseUrl, {
          apiKey: resolveApiKey(config),
          maxRetries: config.maxRetries,
          timeoutMs: config.timeoutMs,
          vendor: config.vendor,
        }),
        model,
      };
    }

    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

function resolveApiKey(config: Record<string, any>): string | undefined {
  const envName = config.apiKeyEnv;
  if (typeof envName === "string" && envName.length > 0) {
    return process.env[envName];
  }

  return config.apiKey;
}

function requireApiKey(type: keyof typeof API_KEY_VARIABLES, config: Record<string, any>): string {
  const apiKey = resolveApiKey(config);
  if (apiKey) return apiKey;
  const envName = config.apiKeyEnv;
  if (typeof envName === "string" && envName.length > 0) {
    throw new Error(`No API key for ${type}: apiKeyEnv names ${envName}, which is not set.`);
  }
  throw new Error(
    `No API key for ${type}. Set ${API_KEY_VARIABLES[type]} in the environment or ~/.axle/credentials, or apiKeyEnv on the provider.`,
  );
}

/**
 * Build a definition for runs without a job file (bare chat, one-shot
 * message) from cli.yaml defaults.
 */
export function createDefaultAgentDefinition(
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
): AgentDefinition {
  const target = resolveTarget(undefined, cliConfig, serviceConfig);
  return {
    version: 1,
    provider: target.provider,
    model: target.model,
  };
}

/**
 * The tool names a run asks for before trust is applied: the definition's
 * own list, else `defaults.tools`, else the built-in set.
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

export function createAgentDefinition(
  jobConfig: JobConfig,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
): AgentDefinition {
  const target = resolveTarget(jobConfig, cliConfig, serviceConfig);

  return {
    version: 1,
    name: jobConfig.name,
    provider: target.provider,
    model: target.model,
    system: jobConfig.system,
    request: jobConfig.request,
    tools: jobConfig.tools
      ? validateToolNames(jobConfig.tools).map((name) => ({ name }))
      : undefined,
    providerTools: jobConfig.providerTools?.map((name) => ({ name })),
    mcps: jobConfig.mcps,
  };
}

export async function createCliAgentConfig(
  jobConfig: JobConfig,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  span: Span,
  trust: FolderTrust,
  skills: Skill[],
): Promise<CliAgentConfig> {
  const definition = createAgentDefinition(jobConfig, cliConfig, serviceConfig);
  return resolveAgentDefinition(definition, cliConfig, serviceConfig, span, trust, skills);
}

/**
 * Turns a definition into runtime objects against the current configuration.
 * A definition names what its recipe said; a named provider and an absent
 * tools list are filled from cli.yaml here, on every run including resume.
 * Tools that act on the folder are withheld unless the folder is trusted,
 * whichever layer named them. Every skill discovery produced for this run
 * loads; nothing in a definition selects among them.
 */
export async function resolveAgentDefinition(
  definition: AgentDefinition,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  span: Span,
  trust: FolderTrust,
  skills: Skill[],
): Promise<CliAgentConfig> {
  const mcps = definition.mcps?.length ? await connectMcps(definition.mcps, span) : [];
  let droppedTools: string[] = [];

  const baseConfig = await createAgentConfig(definition, (definition) => {
    const resolvedProvider = resolveCliProvider(
      definition.provider,
      cliConfig,
      serviceConfig,
      definition.model,
    );
    const requested = requestedToolNames(
      definition.tools?.map((ref) => ref.name),
      cliConfig,
    );
    const { kept, dropped } = trust.trusted
      ? { kept: requested, dropped: [] }
      : partitionByTrust(requested);
    droppedTools = dropped;

    return {
      provider: resolvedProvider.provider,
      model: resolvedProvider.model,
      tools: kept.length > 0 ? createTools(kept) : undefined,
      mcps: mcps.length > 0 ? mcps : undefined,
      skills: skills.length > 0 ? skills : undefined,
    };
  });
  return { agentConfig: baseConfig, definition, mcps, droppedTools };
}
