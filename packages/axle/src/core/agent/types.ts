import type { MCP, MCPConfig } from "../../mcp/index.js";
import type { AxleMessage, MessageMetadata } from "../../messages/message.js";
import type { LogFn } from "../../observability/log.js";
import type { Tracer } from "../../observability/tracer.js";
import type { EventLevel, Span } from "../../observability/types.js";
import type { AxleFailure } from "../../providers/helpers.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import type { ExecutableTool, ProviderTool } from "../../tools/types.js";
import type { TurnEvent } from "../../turns/events.js";
import type { CompactionUpdate, Turn } from "../../turns/types.js";
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
  /** Optional agent name. */
  name?: string;
  /** Executable tools available to the agent. */
  tools?: ExecutableTool[];
  /** Provider-managed tools such as hosted search or code execution. */
  providerTools?: ProviderTool[];
  /** MCP clients whose tools should be lazily resolved. */
  mcps?: MCP[];
  /** Observability: structured logging and optional span tracing. */
  observability?: ObservabilityOptions;
  /** Optional file resolver for request file references. */
  fileResolver?: FileResolver;
}

/**
 * Observability configuration for an `Agent`.
 *
 * Provide `log` for a structured, level-filtered log sink (the common case);
 * Axle creates and owns a tracer behind the scenes. Provide `trace` to bring
 * your own — a `Tracer` (each send is its own root) or a `Span` (sends nest
 * under it); Axle attaches its spans but never ends or flushes what you pass.
 * `level` governs only the tracer Axle creates from `log`.
 */
export interface ObservabilityOptions {
  /** Minimum level emitted. Default "info"; use "debug" in development. */
  level?: EventLevel;
  /** Structured log sink. Axle creates and owns a tracer when `trace` is absent. */
  log?: LogFn;
  /** Bring your own: a Tracer (per-send roots) or a Span to nest sends under. */
  trace?: Tracer | Span;
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
 * Harness concerns such as file resolvers, tracing, transport, and stores
 * should be modeled outside this core definition.
 */
export interface AgentDefinition {
  /** Agent definition schema version. */
  version: 1;
  /** Optional agent name. */
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
 * Serializable continuation state for an `Agent`: the pure model-facing
 * conversation, nothing else.
 *
 * It intentionally does not include executable runtime objects (providers,
 * tools, MCP clients, file resolvers, tracers) or renderable turn
 * state — transcripts are folds of the event stream owned by the host; persist
 * your `TurnAccumulator` state alongside this if you want one back. Recreate
 * runtime objects from host-owned configuration, then construct a new agent
 * with the session: `new Agent(config, session)`. Unknown keys in stored
 * sessions from older versions are ignored.
 */
export interface AgentSession {
  /** Stable conversation/session id. */
  sessionId: string;
  /** Active model-facing conversation used for continuation. */
  messages: AxleMessage[];
}

/**
 * Serializable saved agent payload: definition plus continuation state.
 */
export interface SavedAgent {
  /** Serializable recipe used to reconstruct runtime config. */
  definition: AgentDefinition;
  /** Serializable continuation state. */
  session: AgentSession;
}

export interface AgentResult<T = string> {
  ok: true;
  response: T;
  error?: undefined;
  turn: Turn;
  usage: Stats;
}

export interface AgentErrorResult {
  ok: false;
  response?: undefined;
  error: AxleFailure;
  turn: Turn | undefined;
  usage: Stats;
}

export type AgentHandle<T = string> = Handle<AgentResult<T> | AgentErrorResult>;

export type TurnEventCallback = (event: TurnEvent) => void;

/**
 * Compaction is split into three layers, each with one job: `triggers` say
 * *when to ask*, `shouldCompact` says *whether*, and `compact` does the work.
 *
 * @experimental Compaction is under active design and may change in any release.
 */
export type CompactionTrigger = "manual" | "beforeTurn" | "afterTurn";

/**
 * The decision: should a compaction run now? Consulted at every trigger
 * boundary, including `manual` — "a manual request always compacts" is policy
 * (`ctx.trigger` is the input), not an engine carve-out. Omitted on the
 * config, the engine assumes always-yes. Keep it cheap; it runs on every
 * triggered boundary and must return its boolean synchronously.
 */
export type ShouldCompactCallback = (
  state: { messages: AxleMessage[] },
  context: {
    usage: ContextUsage;
    trigger: CompactionTrigger;
  },
) => boolean;

/**
 * The work: produce the complete new active conversation, and optionally a
 * reader-facing `summary` for the transcript part. There is no decline path —
 * declining is `shouldCompact`'s job — and failures throw. Publish transient
 * display state through `ctx.emit`; updates replace fields on the
 * running part and keep the event stream flowing during long summarizations.
 *
 * `summary` is a presentation choice, independent of the model-facing
 * messages: it can be the summary text itself, or something else entirely
 * ("Reduced the context by 50%"). Omitted, the latest emitted summary remains;
 * without one, the part renders as a bare divider. Stamp output messages via `MessageMetadata`
 * (`axleCompaction: { id, role }`, see `CompactionStamp`) so your own prior
 * output is recognizable on later runs.
 */
export type CompactionCallback = (
  state: { messages: AxleMessage[] },
  context: {
    usage: ContextUsage;
    signal?: AbortSignal;
    trigger: CompactionTrigger;
    /** Engine-generated id for this compaction; the emitted part shares it. */
    id: string;
    /** Update transient reader-facing state on the running part. */
    emit: (update: CompactionUpdate) => void;
  },
) => MaybePromise<{ messages: AxleMessage[]; summary?: string }>;

/**
 * Compaction wiring: the work, the optional decision policy, and the turn
 * boundaries that invoke them automatically. Manual `agent.compact()` is
 * always available.
 *
 * @experimental Compaction is under active design and may change in any release.
 */
export interface CompactionConfig {
  compact: CompactionCallback;
  /** Decision policy. Absent = always willing (`() => true`). */
  shouldCompact?: ShouldCompactCallback;
  triggers?: {
    beforeTurn?: boolean;
    afterTurn?: boolean;
  };
}

export interface SendMessageOptions extends AxleModelRequestOptions {
  fileResolver?: FileResolver;
  /**
   * Stable host-owned metadata attached to the user message and copied to the
   * renderable user turn. Providers ignore this data.
   */
  metadata?: MessageMetadata;
}

export type { ContextUsage };
