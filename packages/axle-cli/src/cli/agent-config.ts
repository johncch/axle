import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  MCP,
  ProviderDefinition,
  Span,
} from "@fifthrevision/axle";
import { anthropic, chatCompletions, createAgentConfig, gemini, openai } from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";
import type { CliConfig, JobConfig, ServiceConfig } from "./configs/schemas.js";
import { connectMcps } from "./mcp.js";
import { createTools } from "./tools.js";

export interface CliAgentConfig {
  agentConfig: AgentConfig;
  definition: AgentDefinition;
  mcps: MCP[];
}

const defaultModels = {
  anthropic: Models.Anthropic.CLAUDE_HAIKU_4_5,
  gemini: Models.Google.GEMINI_3_5_FLASH,
  openai: Models.OpenAI.GPT_5_4_MINI,
};

function resolveCliProvider(
  definition: ProviderDefinition,
  serviceConfig: ServiceConfig,
  jobModel: string | undefined,
): { provider: AIProvider; model: string } {
  const providerConfig = (definition.config ?? {}) as Record<string, any>;

  switch (definition.type) {
    case "openai": {
      const config = { ...serviceConfig.openai, ...providerConfig };
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error("The provider openai is not configured. Please check your configuration.");
      }
      return {
        provider: openai(apiKey, {
          maxRetries: config.maxRetries,
          timeoutMs: config.timeoutMs,
        }),
        model: resolveModel(config, defaultModels.openai),
      };
    }

    case "anthropic": {
      const config = { ...serviceConfig.anthropic, ...providerConfig };
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error(
          "The provider anthropic is not configured. Please check your configuration.",
        );
      }
      return {
        provider: anthropic(apiKey, {
          maxRetries: config.maxRetries,
          timeoutMs: config.timeoutMs,
        }),
        model: resolveModel(config, defaultModels.anthropic),
      };
    }

    case "gemini": {
      const config = { ...serviceConfig.gemini, ...providerConfig };
      const apiKey = resolveApiKey(config);
      if (!apiKey) {
        throw new Error("The provider gemini is not configured. Please check your configuration.");
      }
      return {
        provider: gemini(apiKey, {
          maxRetries: config.maxRetries,
          timeoutMs: config.timeoutMs,
        }),
        model: resolveModel(config, defaultModels.gemini),
      };
    }

    case "chatcompletions": {
      const config = { ...serviceConfig.chatcompletions, ...providerConfig };
      const baseUrl = config.baseUrl;
      const model = jobModel ?? config.model;
      if (!baseUrl || !model) {
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
      throw new Error(`Unknown provider type: ${definition.type}`);
  }
}

function resolveApiKey(config: Record<string, any>): string | undefined {
  const envName = config.apiKeyEnv;
  if (typeof envName === "string" && envName.length > 0) {
    return process.env[envName];
  }

  return config.apiKey;
}

function resolveModel(config: Record<string, any>, defaultModel: string): string {
  if (typeof config.model === "string" && config.model.length > 0) return config.model;
  return defaultModel;
}

const BUILT_IN_PROVIDER_TYPES = ["anthropic", "openai", "gemini", "chatcompletions"];

/**
 * Build a definition for runs without a job file (bare chat, one-shot
 * message) from cli.yaml defaults. Job files still require an explicit
 * provider until the full resolution chain lands (AXL-22).
 */
export function createDefaultAgentDefinition(cliConfig: CliConfig): AgentDefinition {
  const providerName = cliConfig.defaults?.provider;
  if (!providerName) {
    throw new Error(
      "No default provider configured. Set defaults.provider in ~/.axle/cli.yaml, or run a job file with --job.",
    );
  }

  const profile = cliConfig.providers?.[providerName];
  let provider: AgentDefinition["provider"];
  if (profile) {
    const { type, ...config } = profile;
    provider = Object.keys(config).length > 0 ? { type, config } : { type };
  } else if (BUILT_IN_PROVIDER_TYPES.includes(providerName)) {
    provider = { type: providerName };
  } else {
    throw new Error(
      `Default provider "${providerName}" is not a provider profile in cli.yaml or a built-in provider type.`,
    );
  }

  return {
    version: 1,
    provider,
    model: cliConfig.defaults?.models?.[providerName],
  };
}

function createAgentDefinition(jobConfig: JobConfig): AgentDefinition {
  if (!jobConfig.provider) {
    throw new Error(
      "The job file does not specify a provider and no default provider is configured.",
    );
  }
  const { type, ...providerConfig } = jobConfig.provider;
  const provider =
    Object.keys(providerConfig).length > 0
      ? { type, config: providerConfig as Record<string, unknown> }
      : { type };

  return {
    version: 1,
    name: jobConfig.name,
    provider,
    model: jobConfig.model,
    system: jobConfig.system,
    request: jobConfig.request,
    tools: jobConfig.tools?.map((name) => ({ name })),
    providerTools: jobConfig.providerTools?.map((name) => ({ name })),
    mcps: jobConfig.mcps,
  };
}

export async function createCliAgentConfig(
  jobConfig: JobConfig,
  serviceConfig: ServiceConfig,
  span: Span,
): Promise<CliAgentConfig> {
  const definition = createAgentDefinition(jobConfig);
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
