import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  MCP,
  ProviderDefinition,
  Span,
} from "@fifthrevision/axle";
import { anthropic, chatCompletions, createAgentConfig, gemini, openai } from "@fifthrevision/axle";
import type { CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import { connectMcps } from "./mcp.js";
import { createTools } from "./tools.js";

export interface CliAgentConfig {
  agentConfig: AgentConfig;
  definition: AgentDefinition;
  mcps: MCP[];
}

const BUILT_IN_PROVIDER_TYPES = ["anthropic", "openai", "gemini", "chatcompletions"];

/**
 * The uniform resolution chain (AXL-22):
 *   provider name := job.provider → defaults.provider → error
 *   endpoint      := cli.yaml providers[name] → built-in type → error
 *   model         := job.model → defaults.models[name] → env/credentials
 *                    `*_MODEL` → undefined (caller decides: picker or error)
 *
 * An inline provider object in the job is its own endpoint; its type doubles
 * as the name for the defaults.models lookup.
 */
export function resolveTarget(
  jobConfig: Pick<JobConfig, "provider" | "model"> | undefined,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
): { provider: ProviderDefinition; model?: string } {
  const jobProvider = jobConfig?.provider;

  let endpoint: { type: string } & Record<string, unknown>;
  let providerName: string;

  if (jobProvider && !("name" in jobProvider)) {
    endpoint = jobProvider;
    providerName = jobProvider.type;
  } else {
    const name =
      jobProvider && "name" in jobProvider ? jobProvider.name : cliConfig.defaults?.provider;
    if (!name) {
      throw new Error(
        "No provider specified and no default provider configured. Add provider: to the job, or set defaults.provider in ~/.axle/cli.yaml.",
      );
    }
    providerName = name;
    const profile = cliConfig.providers?.[name];
    if (profile) {
      endpoint = profile;
    } else if (BUILT_IN_PROVIDER_TYPES.includes(name)) {
      endpoint = { type: name };
    } else {
      throw new Error(
        `Provider "${name}" is not a provider profile in cli.yaml or a built-in provider type.`,
      );
    }
  }

  const model =
    jobConfig?.model ??
    cliConfig.defaults?.models?.[providerName] ??
    serviceConfig[endpoint.type as keyof ServiceConfig]?.model;

  const { type, ...config } = endpoint;
  return {
    provider: Object.keys(config).length > 0 ? { type, config } : { type },
    model,
  };
}

function resolveCliProvider(
  definition: ProviderDefinition,
  serviceConfig: ServiceConfig,
  definitionModel: string | undefined,
): { provider: AIProvider; model: string } {
  const providerConfig = (definition.config ?? {}) as Record<string, any>;
  const type = definition.type;
  const config = {
    ...serviceConfig[type as keyof ServiceConfig],
    ...providerConfig,
  } as Record<string, any>;

  const model = definitionModel ?? config.model;
  if (!model) {
    throw new Error(
      `No model resolved for provider ${type}. Add model: to the job, set defaults.models in ~/.axle/cli.yaml, or set ${type.toUpperCase()}_MODEL.`,
    );
  }

  switch (type) {
    case "openai": {
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error("The provider openai is not configured. Please check your configuration.");
      }
      return {
        provider: openai(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "anthropic": {
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error(
          "The provider anthropic is not configured. Please check your configuration.",
        );
      }
      return {
        provider: anthropic(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "gemini": {
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error("The provider gemini is not configured. Please check your configuration.");
      }
      return {
        provider: gemini(apiKey, { maxRetries: config.maxRetries, timeoutMs: config.timeoutMs }),
        model,
      };
    }

    case "chatcompletions": {
      const baseUrl = config.baseUrl;
      if (!baseUrl) {
        throw new Error(
          "The provider chatcompletions is not configured. Please check your configuration.",
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
    tools: jobConfig.tools?.map((name) => ({ name })),
    providerTools: jobConfig.providerTools?.map((name) => ({ name })),
    mcps: jobConfig.mcps,
  };
}

export async function createCliAgentConfig(
  jobConfig: JobConfig,
  cliConfig: CliConfig,
  serviceConfig: ServiceConfig,
  span: Span,
): Promise<CliAgentConfig> {
  const definition = createAgentDefinition(jobConfig, cliConfig, serviceConfig);
  return resolveAgentDefinition(definition, serviceConfig, span);
}

export async function resolveAgentDefinition(
  definition: AgentDefinition,
  serviceConfig: ServiceConfig,
  span: Span,
): Promise<CliAgentConfig> {
  const mcps = definition.mcps?.length ? await connectMcps(definition.mcps, span) : [];

  const baseConfig = await createAgentConfig(definition, (definition) => {
    const resolvedProvider = resolveCliProvider(
      definition.provider,
      serviceConfig,
      definition.model,
    );

    return {
      provider: resolvedProvider.provider,
      model: resolvedProvider.model,
      tools: definition.tools?.length
        ? createTools(definition.tools.map((ref) => ref.name))
        : undefined,
      mcps: mcps.length > 0 ? mcps : undefined,
    };
  });
  return { agentConfig: baseConfig, definition, mcps };
}
