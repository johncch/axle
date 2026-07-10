import type {
  AgentConfig,
  AgentDefinition,
  AIProvider,
  MCP,
  ProviderDefinition,
  Span,
} from "@fifthrevision/axle";
import {
  anthropic,
  chatCompletions,
  createAgentConfig,
  gemini,
  openai,
} from "@fifthrevision/axle";
import { Models } from "@fifthrevision/axle/models";
import { ProceduralMemory } from "../memory/index.js";
import { LocalFileStore } from "../store/index.js";
import type { JobConfig, ServiceConfig } from "./configs/schemas.js";
import { connectMcps } from "./mcp.js";
import { createTools } from "./tools.js";

export interface CliAgentConfig {
  agentConfig: AgentConfig;
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
      const baseUrl = config["base-url"];
      const providerModel = config.model;
      if (!baseUrl || !providerModel) {
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
        model: providerModel,
      };
    }

    default:
      throw new Error(`Unknown provider type: ${definition.type}`);
  }
}

function resolveApiKey(config: Record<string, any>): string | undefined {
  const envName = config.apiKeyEnv ?? config["api-key-env"];
  if (typeof envName === "string" && envName.length > 0) {
    return process.env[envName];
  }

  return config["api-key"];
}

function resolveModel(config: Record<string, any>, defaultModel: string): string {
  if (typeof config.model === "string" && config.model.length > 0) return config.model;
  return defaultModel;
}

function createAgentDefinition(jobConfig: JobConfig): AgentDefinition {
  const { type, ...providerConfig } = jobConfig.provider;
  const provider =
    Object.keys(providerConfig).length > 0
      ? { type, config: providerConfig as Record<string, unknown> }
      : { type };

  return {
    version: 1,
    name: jobConfig.name,
    provider,
    tools: jobConfig.tools?.map((name) => ({ name })),
    providerTools: jobConfig.provider_tools?.map((name) => ({ name })),
    mcps: jobConfig.mcps,
  };
}

export async function createCliAgentConfig(
  jobConfig: JobConfig,
  serviceConfig: ServiceConfig,
  span: Span,
): Promise<CliAgentConfig> {
  const definition = createAgentDefinition(jobConfig);
  const mcps = definition.mcps?.length ? await connectMcps(definition.mcps, span) : [];

  const baseConfig = await createAgentConfig(definition, (definition) => {
    const resolvedProvider = resolveCliProvider(definition.provider, serviceConfig);

    return {
      provider: resolvedProvider.provider,
      model: resolvedProvider.model,
      tools: definition.tools?.length
        ? createTools(definition.tools.map((ref) => ref.name))
        : undefined,
      mcps: mcps.length > 0 ? mcps : undefined,
    };
  });
  return {
    agentConfig: {
      ...baseConfig,
      memory: new ProceduralMemory({
        provider: baseConfig.provider,
        model: baseConfig.model,
        store: new LocalFileStore(".axle"),
      }),
    },
    mcps,
  };
}
