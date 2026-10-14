import type { MCP, MCPConfig } from "../../mcp/index.js";
import type { AxleMessage, MessageMetadata } from "../../messages/message.js";
import type { LogFn } from "../../observability/log.js";
import type { Tracer } from "../../observability/tracer.js";
import type { EventLevel, Span } from "../../observability/types.js";
import type { AxleFailure } from "../../providers/helpers.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import type { Skill, SkillDefinitionRef } from "../../skills/types.js";
import type { ExecutableTool, ProviderTool } from "../../tools/types.js";
import type { TurnEvent } from "../../turns/events.js";
import type { CompactionUpdate, Turn } from "../../turns/types.js";
import type { Stats } from "../../types.js";
import type { FileResolver } from "../../utils/file.js";
import type { Handle } from "../../utils/utils.js";
import type { Instruct } from "../Instruct.js";
import type { OutputSchema, ParsedSchema } from "../parse.js";

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
  /** Skills disclosed in the system prompt and loaded on demand through the view-skill tool. */
  skills?: Skill[];
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
  /** Serializable skill references, resolved by the host. */
  skills?: SkillDefinitionRef[];
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
  /** Skills resolved from `AgentDefinition.skills`. */
  skills?: Skill[];
}

/**
 * Host function used to turn an `AgentDefinition` into executable dependencies.
 */
export type AgentDefinitionResolver = (
  definition: AgentDefinition,
) => MaybePromise<ResolvedAgentDefinition>;

/**
 * Serializable resumable state for an `Agent`: the pure model-facing
 * conversation, nothing else.
 *
 * It intentionally does not include executable runtime objects (providers,
 * tools, MCP clients, file resolvers, tracers) or renderable turn
 * state — transcripts are folds of the event stream owned by the host; persist
 * your `Transcript.turns` alongside this if you want one back. Recreate
 * runtime objects from host-owned configuration, then construct a new agent
 * with the session: `new Agent(config, session)`. Unknown keys in stored
 * sessions from older versions are ignored.
 */
export interface AgentSession {
  /** Stable conversation/session id. */
  sessionId: string;
  /** Active model-facing conversation the next turn resumes from. */
  messages: AxleMessage[];
}

/**
 * Serializable saved agent payload: definition plus session state.
 */
export interface SavedAgent {
  /** Serializable recipe used to reconstruct runtime config. */
  definition: AgentDefinition;
  /** Serializable session state. */
  session: AgentSession;
}

export interface AgentResult<T = string> {
  ok: true;
  response: T;
  error?: undefined;
  turn: Turn;
  usage: Stats;
  /** The inline turns the send's continuation ran, in order; empty when none ran. */
  after: InlineTurn[];
}

export interface AgentErrorResult {
  ok: false;
  response?: undefined;
  error: AxleFailure;
  turn: Turn | undefined;
  usage: Stats;
  /** The inline turns the send's continuation ran, in order; empty when none ran. */
  after: InlineTurn[];
}

/**
 * One turn a continuation ran through `ctx.send()`: the user turn it sent
 * and what came back. The response is `unknown` because only the
 * continuation saw the inline send's schema.
 */
export type InlineTurn = { userTurn: Turn } & (
  Omit<AgentResult<unknown>, "after"> | Omit<AgentErrorResult, "after">
);

export type AgentHandle<T = string> = Handle<AgentResult<T> | AgentErrorResult>;

/** Options an inline send accepts: everything a send does, except a continuation. */
export type InlineSendOptions = Omit<SendMessageOptions, "after">;

/**
 * The inside of a continuation: inline sends in the held slot, the
 * operation's signal and id, and read-only views of the conversation and
 * the queue.
 */
export interface ContinuationContext {
  send(
    message: string | Instruct<undefined>,
    options?: InlineSendOptions,
  ): Promise<AgentResult<string> | AgentErrorResult>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: InlineSendOptions,
  ): Promise<AgentResult<ParsedSchema<TSchema>> | AgentErrorResult>;
  /** Aborted by `cancel()`; every inline turn runs under it. */
  readonly signal: AbortSignal;
  /** The send's user turn id, the one its `pending:queued` turn carried. */
  readonly id: string;
  /** The active model-facing conversation as it stands. */
  readonly messages: readonly AxleMessage[];
  /** Preview turns of the operations queued behind this one. */
  readonly pending: readonly Turn[];
}

/**
 * A program a send carries under `after`. It runs after the send's turn
 * settles with a result, holds the queue until it returns, and runs inline
 * turns through `ctx.send()`.
 */
export type Continuation<T = string> = (
  result: AgentResult<T> | AgentErrorResult,
  ctx: ContinuationContext,
) => void | Promise<void>;

/**
 * What a turn settled with, handed to `onSettled` first. `id` is the turn's
 * user turn id: for an operation's own turn, the one its `pending:queued`
 * turn carried; for an inline turn, one no `pending:queued` announced.
 */
export type SettledOperation =
  | {
      kind: "send";
      id: string;
      result: PromiseSettledResult<AgentResult<unknown> | AgentErrorResult>;
    }
  | { kind: "compaction"; id: string; result: PromiseSettledResult<boolean> };

export type SettledCallback = (
  session: AgentSession,
  operation: SettledOperation,
) => void | Promise<void>;

export type IdleCallback = () => void;

export type TurnEventCallback = (event: TurnEvent) => void;

/**
 * Compaction is split into three layers, each with one job: `triggers` say
 * *when to ask automatically*, `shouldCompactOnTrigger` filters those
 * automatic requests, and `compact` does the work.
 *
 * @experimental Compaction is under active design and may change in any release.
 */
export type AutomaticCompactionTrigger = "beforeTurn" | "afterTurn";
export type CompactionTrigger = "manual" | AutomaticCompactionTrigger;

/**
 * The decision: should an automatically triggered compaction run now?
 * Omitted on the config, every configured automatic trigger runs. Explicit
 * `agent.compact()` calls bypass this policy. Keep it cheap; it runs on every
 * configured automatic boundary and must return its boolean synchronously.
 */
export type ShouldCompactOnTriggerCallback = (
  state: { messages: AxleMessage[] },
  context: {
    usage: ContextUsage;
    trigger: AutomaticCompactionTrigger;
  },
) => boolean;

/**
 * The work: produce the complete new active conversation, and optionally a
 * reader-facing `summary` for the transcript part. There is no decline path —
 * declining automatic work is `shouldCompactOnTrigger`'s job — and failures
 * throw. Publish transient display state through `ctx.emit`; updates replace
 * fields on the running part and keep the event stream flowing during long
 * summarizations.
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
  /** Automatic-trigger policy. Absent = run at every configured trigger. */
  shouldCompactOnTrigger?: ShouldCompactOnTriggerCallback;
  triggers?: {
    beforeTurn?: boolean;
    afterTurn?: boolean;
  };
}

export interface SendMessageOptions<T = any> extends AxleModelRequestOptions {
  fileResolver?: FileResolver;
  /**
   * Stable host-owned metadata attached to the user message and copied to the
   * renderable user turn. Providers ignore this data.
   */
  metadata?: MessageMetadata;
  /**
   * A continuation: runs after this send's turn settles with a result and
   * before the queue moves on, and may run inline turns through
   * `ctx.send()`. The handle resolves once it returns, with the inline turns
   * under `after`. See `Continuation`.
   */
  after?: Continuation<T>;
}

export type { ContextUsage };
