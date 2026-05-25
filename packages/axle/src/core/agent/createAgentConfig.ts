import { AxleError } from "../../errors/AxleError.js";
import { MCP } from "../../mcp/index.js";
import type {
  AgentConfig,
  AgentDefinition,
  AgentDefinitionResolver,
  ProviderToolDefinitionRef,
} from "./types.js";

function defaultProviderTools(
  refs: ProviderToolDefinitionRef[] | undefined,
): AgentConfig["providerTools"] {
  return refs?.map((ref) => ({
    type: "provider",
    name: ref.name,
    config: ref.config,
  }));
}

/**
 * Create executable `Agent` config from a serializable agent definition.
 *
 * Core resolves only what it can safely construct from serializable data. The
 * host remains responsible for executable dependencies such as providers,
 * tools, and MCP clients. Harness runtime services such as memory and file
 * resolvers should be layered onto the returned config by the host.
 */
export async function createAgentConfig(
  definition: AgentDefinition,
  resolver: AgentDefinitionResolver,
): Promise<AgentConfig> {
  if (definition.version !== 1) {
    throw new AxleError(`Unsupported agent definition version: ${definition.version}`);
  }

  const resolved = await resolver(definition);
  const model = definition.model ?? resolved.model;
  if (!model) {
    throw new AxleError("AgentDefinition requires a model or model resolver");
  }

  if (definition.tools?.length && !resolved.tools) {
    throw new AxleError("AgentDefinition includes tools but resolver did not return tools");
  }

  return {
    provider: resolved.provider,
    model,
    system: definition.system,
    name: definition.name,
    tools: resolved.tools,
    providerTools: resolved.providerTools ?? defaultProviderTools(definition.providerTools),
    mcps: resolved.mcps ?? definition.mcps?.map((config) => new MCP(config)),
    reasoning: definition.request?.reasoning,
    maxOutputTokens: definition.request?.maxOutputTokens,
    temperature: definition.request?.temperature,
    topP: definition.request?.topP,
    stop: definition.request?.stop,
    toolChoice: definition.request?.toolChoice,
    parallelToolCalls: definition.request?.parallelToolCalls,
    providerOptions: definition.request?.providerOptions,
  };
}
