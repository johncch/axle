import type { MCP, MCPConfig } from "../../mcp/index.js";
import type { AgentMemory } from "../../memory/types.js";
import type { AxleMessage, MessageMetadata } from "../../messages/message.js";
import type { GenerateError } from "../../providers/helpers.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import type { ExecutableTool, ProviderTool } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import type { TurnEvent } from "../../turns/events.js";
import type { Annotation, Turn } from "../../turns/types.js";
import type { Stats } from "../../types.js";
import type { FileResolver } from "../../utils/file.js";
import type { Handle } from "../../utils/utils.js";

/**
 * Runtime configuration for an `Agent`.
 *
 * This contains executable objects and process-local services. It is not meant
 * to be serialized directly. Use `AgentDefinition` for a serializable recipe
 * and `createAgentConfig()` to produce an `AgentConfig`.
 */
export interface AgentConfig extends Omit<AxleModelRequestOptions, "signal"> {
  /** Provider adapter used to execute model requests. */
  provider: AIProvider;
  /** Model identifier passed to the provider. */
  model: string;
  /** Stable conversation/session id. Generated when omitted. */
  sessionId?: string;
  /** Optional system/developer instruction. */
  system?: string;
  /** Optional agent name passed to host services such as memory. */
  name?: string;
  /** Executable tools available to the agent. */
  tools?: ExecutableTool[];
  /** Provider-managed tools such as hosted search or code execution. */
  providerTools?: ProviderTool[];
  /** MCP clients whose tools should be lazily resolved. */
  mcps?: MCP[];
  /** Optional memory implementation. */
  memory?: AgentMemory;
  /** Optional tracing context. */
  tracer?: TracingContext;
  /** Optional file resolver for request file references. */
  fileResolver?: FileResolver;
}

/**
 * Serializable provider reference for an agent definition.
 *
 * `type` is host-defined. Common values are provider names such as `"openai"`,
 * `"anthropic"`, `"gemini"`, or `"chatcompletions"`, but core does not
 * interpret the value. `config` is passed through to the host resolver.
 */
export interface ProviderDefinition {
  /** Host-defined provider discriminator. */
  type: string;
  /** Serializable provider configuration or references, such as `apiKeyEnv`. */
  config?: Record<string, unknown>;
}

/**
 * Serializable reference to an executable tool.
 */
export interface ToolDefinitionRef {
  /** Host-defined tool name or id. */
  name: string;
  /** Optional serializable tool configuration passed to the resolver. */
  config?: Record<string, unknown>;
}

/**
 * Serializable reference to a provider-managed tool.
 */
export interface ProviderToolDefinitionRef {
  /** Provider tool name. */
  name: string;
  /** Optional provider tool configuration. */
  config?: Record<string, unknown>;
}

/**
 * Serializable request options for an agent definition.
 */
export interface AgentDefinitionRequestOptions extends Omit<AxleModelRequestOptions, "signal"> {}

/**
 * Serializable recipe for reconstructing an agent.
 *
 * This is deliberately not executable by itself. Hosts resolve provider and
 * tool references into runtime objects using an `AgentDefinitionResolver`.
 * Harness concerns such as memory implementations, file resolvers, tracing,
 * transport, and stores should be modeled outside this core definition.
 */
export interface AgentDefinition {
  /** Agent definition schema version. */
  version: 1;
  /** Optional agent name passed to host services such as memory. */
  name?: string;
  /** Provider reference resolved by the host. */
  provider: ProviderDefinition;
  /** Optional model identifier passed to the resolved provider. */
  model?: string;
  /** Optional system/developer instruction. */
  system?: string;
  /** Provider-portable request defaults. */
  request?: AgentDefinitionRequestOptions;
  /** Serializable executable tool references. */
  tools?: ToolDefinitionRef[];
  /** Serializable provider-managed tool references. */
  providerTools?: ProviderToolDefinitionRef[];
  /** Serializable MCP client configuration. */
  mcps?: MCPConfig[];
}

export type MaybePromise<T> = T | Promise<T>;

/**
 * Executable dependencies resolved from an `AgentDefinition`.
 */
export interface ResolvedAgentDefinition {
  /** Provider adapter used to execute model requests. */
  provider: AIProvider;
  /** Model identifier used when `AgentDefinition.model` is omitted. */
  model?: string;
  /** Executable tools resolved from `AgentDefinition.tools`. */
  tools?: ExecutableTool[];
  /** Provider-managed tools resolved from `AgentDefinition.providerTools`. */
  providerTools?: ProviderTool[];
  /** MCP clients resolved from `AgentDefinition.mcps`. */
  mcps?: MCP[];
}

/**
 * Host function used to turn an `AgentDefinition` into executable dependencies.
 */
export type AgentDefinitionResolver = (
  definition: AgentDefinition,
) => MaybePromise<ResolvedAgentDefinition>;

/**
 * Serializable continuation and presentation state for an `Agent`.
 *
 * This is the data needed to continue a model conversation and restore the
 * renderable turn state. It intentionally does not include executable runtime
 * objects such as providers, tools, MCP clients, memory implementations, file
 * resolvers, or tracers. Recreate those from host-owned configuration, then
 * call `agent.restore(session)`.
 *
 * @typeParam TAnnotation - Annotation union supported by the host renderer.
 */
export interface AgentSession<TAnnotation extends Annotation = Annotation> {
  /** Agent session schema version. */
  version: 1;
  /** Stable conversation/session id. */
  sessionId: string;
  /** Canonical model-facing message history used for continuation. */
  messages: AxleMessage[];
  /** Renderable turn state for exact UI restoration. */
  turns?: Turn<TAnnotation>[];
  /** Session-level annotations for generic renderer state. */
  sessionAnnotations?: TAnnotation[];
}

/**
 * Serializable saved agent payload: definition plus continuation state.
 */
export interface SavedAgent<TAnnotation extends Annotation = Annotation> {
  /** Serializable recipe used to reconstruct runtime config. */
  definition: AgentDefinition;
  /** Serializable continuation and presentation state. */
  session: AgentSession<TAnnotation>;
}

export interface AgentResult<T = string> {
  ok: true;
  response: T;
  turn: Turn;
  usage: Stats;
}

export interface AgentErrorResult {
  ok: false;
  response?: undefined;
  error: GenerateError;
  turn: Turn | undefined;
  usage: Stats;
}

export type AgentHandle<T = string> = Handle<AgentResult<T> | AgentErrorResult>;

export type TurnEventCallback = (event: TurnEvent) => void;

export interface SendMessageOptions extends AxleModelRequestOptions {
  fileResolver?: FileResolver;
  /**
   * Stable host-owned metadata attached to the user message and copied to the
   * renderable user turn. Providers ignore this data.
   */
  metadata?: MessageMetadata;
}

export type { ContextUsage };
