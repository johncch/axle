import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import { estimateContextUsage } from "../../execution/context.js";
import type { AxleProviderFailure } from "../../execution/helpers.js";
import { stream, type StreamHandle } from "../../execution/stream.js";
import type { MCP } from "../../mcp/index.js";
import { validateCompactedMessages } from "../../messages/compaction.js";
import type { AxleMessage, AxleUserMessage } from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { logContent } from "../../observability/log.js";
import type { Tracer } from "../../observability/tracer.js";
import type { Span, SpanStatus } from "../../observability/types.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../protocols/types.js";
import { requireInteger } from "../../protocols/utils.js";
import { renderSkillsCatalog } from "../../skills/prompt.js";
import { SkillRegistry } from "../../skills/registry.js";
import { ToolRegistry } from "../../tools/registry.js";
import type {
  AnyTool,
  ToolCallCallback,
  ToolDefinition,
  WaitingToolCall,
} from "../../tools/types.js";
import { TurnEventBuilder, userTurnFromMessage } from "../../turns/eventBuilder.js";
import type { TurnEvent } from "../../turns/events.js";
import { Transcript } from "../../turns/transcript.js";
import { isTimeoutReason, type OperationOutcome, type Turn } from "../../turns/types.js";
import type { Stats } from "../../types.js";
import { timeoutSignal } from "../../utils/abort.js";
import type { FileResolver } from "../../utils/file.js";
import { createStats } from "../../utils/stats.js";
import { Instruct } from "../Instruct.js";
import type { OutputSchema, ParsedSchema } from "../parse.js";
import { resolveObservability, spanStatusFromError } from "./observability.js";
import { AgentScheduler, type InlineRunner, type OperationKind } from "./scheduler.js";
import type {
  AgentConfig,
  AgentErrorResult,
  AgentEventCallback,
  AgentHandle,
  AgentResult,
  AgentSession,
  AgentStatus,
  CompactionConfig,
  CompactionTrigger,
  Continuation,
  ContinuationContext,
  IdleCallback,
  InlineSendOptions,
  InlineTurn,
  SendMessageOptions,
  SettledCallback,
  SettledOperation,
  StartCallback,
  StartedOperation,
} from "./types.js";

interface PreparedSend {
  instruct: Instruct<any>;
  fileResolver?: FileResolver;
  turnTimeoutMs?: number;
  streamStallMs?: number;
  message: AxleUserMessage;
  userTurn: Turn;
  requestOptions: AxleModelRequestOptions;
}

function mergeAxleModelRequestOptions(
  defaults?: Omit<AxleModelRequestOptions, "signal">,
  overrides?: AxleModelRequestOptions,
): AxleModelRequestOptions {
  return {
    ...defaults,
    ...overrides,
    providerOptions:
      defaults?.providerOptions || overrides?.providerOptions
        ? { ...defaults?.providerOptions, ...overrides?.providerOptions }
        : undefined,
  };
}

export class Agent {
  readonly provider: AIProvider;
  readonly model: string;
  readonly name?: string;
  readonly fileResolver?: FileResolver;
  readonly turnTimeoutMs?: number;
  readonly streamStallMs?: number;
  readonly requestOptions: Omit<AxleModelRequestOptions, "signal">;
  readonly registry: ToolRegistry;
  readonly skills: SkillRegistry;

  sessionId: string;
  private readonly baseSystem: string | undefined;

  private mcps: MCP[] = [];
  private resolvedMcps = new WeakSet<MCP>();
  private spanParent?: Tracer | Span;
  private ownedTracer?: Tracer;

  private eventCallbacks: AgentEventCallback[] = [];

  private toolCallHandler: ToolCallCallback | undefined;
  private activeStream: StreamHandle | undefined;
  private startCallbacks: StartCallback[] = [];
  private settledCallbacks: SettledCallback[] = [];
  private compaction?: CompactionConfig;
  private idleCallbacks: IdleCallback[] = [];
  private scheduler = new AgentScheduler({
    started: (id, kind) => this.emitEvent({ type: "operation:start", id, kind }),
    afterStarted: (id) => this.emitEvent({ type: "after:start", id }),
    afterEnded: (id) => this.emitEvent({ type: "after:end", id }),
    ended: (id, result) =>
      this.emitEvent({ type: "operation:end", id, outcome: outcomeOf(result) }),
    idle: () => {
      this.emitEvent({ type: "agent:idle" });
      this.notifyIdle();
    },
  });
  private turnActive = false;
  private stopRequested = false;
  private transcript = new Transcript();
  private pendingTurns: Turn[] = [];
  private messagesInternal: AxleMessage[];

  /**
   * Create an agent from runtime config and, optionally, restore saved session state.
   *
   * When both `config.sessionId` and `session.sessionId` are supplied, the
   * restored session id wins. Unknown keys in sessions stored by older axle
   * versions are ignored.
   */
  constructor(config: AgentConfig, session?: AgentSession) {
    this.provider = config.provider;
    this.model = config.model;
    this.sessionId = session?.sessionId ?? config.sessionId ?? crypto.randomUUID();
    this.messagesInternal = [...(session?.messages ?? [])];
    const observability = resolveObservability(config.observability);
    this.spanParent = observability.parent;
    this.ownedTracer = observability.owned;
    this.baseSystem = config.system;
    this.name = config.name;
    this.fileResolver = config.fileResolver;
    this.turnTimeoutMs =
      config.turnTimeoutMs === undefined
        ? undefined
        : requireInteger(config.turnTimeoutMs, "turnTimeoutMs", { min: 1 });
    this.streamStallMs =
      config.streamStallMs === undefined
        ? undefined
        : requireInteger(config.streamStallMs, "streamStallMs", { min: 1 });
    this.requestOptions = {
      reasoning: config.reasoning,
      maxOutputTokens: config.maxOutputTokens,
      toolChoice: config.toolChoice,
      parallelToolCalls: config.parallelToolCalls,
      cache: config.cache,
      providerOptions: config.providerOptions,
    };
    this.registry = new ToolRegistry({
      tools: config.tools,
      providerTools: config.providerTools,
    });
    this.skills = new SkillRegistry(this.registry, config.skills);
    if (config.mcps) {
      this.mcps = [...config.mcps];
    }
  }

  /** The prompt the model sees: the configured system prompt, then the skills catalog when skills are present. */
  get system(): string | undefined {
    const sections = [this.baseSystem];
    if (this.skills.size > 0) sections.push(renderSkillsCatalog(this.skills.list()));
    const present = sections.filter((section) => section !== undefined);
    return present.length > 0 ? present.join("\n\n") : undefined;
  }

  addMcp(mcp: MCP) {
    this.mcps.push(mcp);
  }

  addMcps(mcps: MCP[]) {
    this.mcps.push(...mcps);
  }

  hasTools(): boolean {
    return this.registry.size > 0 || this.mcps.length > 0;
  }

  on(callback: AgentEventCallback) {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) this.eventCallbacks.splice(index, 1);
    };
  }

  /**
   * Answer the agent's deferred tool calls. One handler per agent, the
   * dispatcher over every deferred tool: registering another replaces it,
   * and the returned function removes it if it is still the one in place.
   * The handler in place when a turn opens is the one that turn uses. The
   * contract is `execute`'s: return the result, throw to give the model an
   * error, and return nothing for a call no branch answers.
   */
  onToolCall(handler: ToolCallCallback): () => void {
    this.toolCallHandler = handler;
    return () => {
      if (this.toolCallHandler === handler) this.toolCallHandler = undefined;
    };
  }

  /**
   * The deferred call with this tool call id while the active turn is
   * waiting on it; `undefined` once it has settled or when no turn is
   * running. `answer` gives the model the result and `fail` an `execution`
   * error, the two outcomes `onToolCall` has. Whichever of the handler, this,
   * the tool's `timeout` and `cancel()` comes first settles the call.
   */
  toolCall(id: string): WaitingToolCall | undefined {
    return this.activeStream?.toolCall(id);
  }

  /**
   * Called each time an operation takes the queue, before its turn opens: a
   * send, or a compaction. Never inside `send()` itself; always after it
   * returns. `status` is already `busy` with the operation's id, and
   * `operation:start` has been emitted.
   *
   * A callback may return a promise; the operation does not start its work
   * until every callback has settled, and all callbacks run together. One
   * that throws skips the work and the continuation: the pending turn is
   * dropped with the error, `onSettled` still runs with it as the result,
   * and the handle rejects with it. A
   * `cancel()` while callbacks run aborts `operation.signal`, and the work is
   * skipped once they return. An operation cancelled while still queued
   * never starts and does not fire.
   *
   * Do not await `send()`, `compact()` or `snapshot()` on this agent from
   * inside a callback: the callback holds the queue they wait for, so the
   * nested call deadlocks.
   */
  onStart(callback: StartCallback) {
    this.startCallbacks.push(callback);
    return () => {
      const index = this.startCallbacks.indexOf(callback);
      if (index >= 0) this.startCallbacks.splice(index, 1);
    };
  }

  /**
   * Receive the session each time an operation ends.
   *
   * Fires once for every operation that started, however it ended: after
   * its turn and its continuation, before `operation:end` is emitted, the
   * handle settles or the next operation starts. Inline turns sent by a
   * continuation do not fire it on their own. The session is the one
   * `snapshot()` returns; unlike `snapshot()`, it does not wait behind queued
   * operations. The operation carries what the handle settles with: the
   * result on success, the rejection reason otherwise, the same
   * `AxleAgentAbortError`, abort reason included, a cancelled handle
   * rejects with.
   *
   * A callback may return a promise. The handle does not settle and the
   * next queued operation does not start until every callback has settled;
   * all callbacks run together, and nothing cancels them: `cancel()` and
   * `stop()` return `false` while they run. A callback that throws or
   * rejects cannot affect the operation: the error is recorded on the trace
   * and the other callbacks still run.
   *
   * Do not await `send()`, `compact()` or `snapshot()` on this agent from
   * inside a callback: the callback holds the queue they wait for, so the
   * nested call deadlocks.
   */
  onSettled(callback: SettledCallback) {
    this.settledCallbacks.push(callback);
    return () => {
      const index = this.settledCallbacks.indexOf(callback);
      if (index >= 0) this.settledCallbacks.splice(index, 1);
    };
  }

  /**
   * Called each time the agent goes from busy to idle: an operation finished
   * and nothing is queued behind it. Returns an unsubscribe function.
   *
   * It fires after the last operation's `onSettled` callbacks have settled,
   * and also when the queue was emptied by `clear()` while they ran, just
   * after `agent:idle` is emitted. Work
   * scheduled during those callbacks keeps the agent busy, so it does not
   * fire until that work is done too.
   *
   * The callback is not awaited. The agent is already free, so a `send()`
   * from inside it starts at once. A callback that throws is recorded on the
   * trace and the other callbacks still run.
   */
  onIdle(callback: IdleCallback) {
    this.idleCallbacks.push(callback);
    return () => {
      const index = this.idleCallbacks.indexOf(callback);
      if (index >= 0) this.idleCallbacks.splice(index, 1);
    };
  }

  /**
   * `busy` with the running operation's id from the moment it starts until
   * it finishes, its `onStart` callbacks, continuation and `onSettled`
   * callbacks included; `idle` when a `send()` would start at once. It
   * changes only where `on` delivers `operation:start` (to busy with that
   * id) and `agent:idle`, and it already reads the new value when that event
   * is delivered.
   */
  get status(): AgentStatus {
    return this.scheduler.status;
  }

  /** The active, model-facing conversation. Requests are built from it; compaction replaces it. */
  get messages(): AxleMessage[] {
    return [...this.messagesInternal];
  }

  context(): ContextUsage {
    return this.estimateContext(this.messagesInternal);
  }

  private estimateContext(messages: AxleMessage[]): ContextUsage {
    return estimateContextUsage({
      system: this.system,
      messages,
      tools: this.toToolDefinitions([...this.registry.local(), ...this.registry.deferred()]),
      providerTools: this.registry.provider(),
      mcpTools: this.toToolDefinitions(this.registry.mcp()),
    });
  }

  /**
   * Schedule a FIFO conversation turn.
   *
   * With `after`, the send carries a continuation: it runs after the turn
   * settles with a result, holds the queue until it returns, and may run
   * inline turns through `ctx.send()`, each stamped with this send's id as
   * its `threadId`. The handle then resolves with the inline turns listed
   * under `after`. A turn whose handle rejects skips it.
   */
  send(
    message: string | Instruct<undefined>,
    options?: SendMessageOptions<string>,
  ): AgentHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: SendMessageOptions<ParsedSchema<TSchema>>,
  ): AgentHandle<ParsedSchema<TSchema>>;
  send(messageOrInstruct: string | Instruct<any>, options?: SendMessageOptions): AgentHandle<any> {
    const { after, ...sendOptions } = options ?? {};
    const prepared = this.prepareSend(messageOrInstruct, sendOptions);
    const { userTurn } = prepared;

    this.emitEvent({ type: "pending:queued", turn: { ...userTurn, status: "pending" } });

    return this.scheduler.schedule(
      userTurn.id,
      ({ signal }) => this.executeTurn(prepared, { signal, announced: true }),
      {
        signal: prepared.requestOptions.signal,
        start: (signal) => this.start({ kind: "send", id: userTurn.id, signal }),
        onWithdrawn: () =>
          this.emitEvent({
            type: "pending:dropped",
            id: userTurn.id,
            reason: { type: "cancelled" },
          }),
        settle: (result) => this.settle({ kind: "send", id: userTurn.id, result }),
        after: after && ((value, inline) => this.continueSend(after, value, inline, userTurn.id)),
      },
    );
  }

  private prepareSend(
    messageOrInstruct: string | Instruct<any>,
    options: InlineSendOptions,
    threadId?: string,
  ): PreparedSend {
    const { fileResolver, metadata, id, turnTimeoutMs, streamStallMs, ...modelOptions } = options;
    const instruct =
      typeof messageOrInstruct === "string"
        ? new Instruct({ prompt: messageOrInstruct, vars: "optional" })
        : messageOrInstruct.clone();
    instruct.validate();
    const requestOptions = mergeAxleModelRequestOptions(this.requestOptions, modelOptions);
    const message = {
      ...instruct.toMessage({ metadata, id }),
      ...(threadId ? { threadId } : {}),
    };
    return {
      instruct,
      fileResolver,
      turnTimeoutMs:
        turnTimeoutMs === undefined
          ? this.turnTimeoutMs
          : requireInteger(turnTimeoutMs, "turnTimeoutMs", { min: 1 }),
      streamStallMs:
        streamStallMs === undefined
          ? this.streamStallMs
          : requireInteger(streamStallMs, "streamStallMs", { min: 1 }),
      message,
      userTurn: userTurnFromMessage(message),
      requestOptions,
    };
  }

  private async continueSend(
    after: Continuation<any>,
    value: AgentResult<any> | AgentErrorResult,
    inline: InlineRunner,
    id: string,
  ): Promise<AgentResult<any> | AgentErrorResult> {
    const inlineTurns: InlineTurn[] = [];
    const agent = this;
    const span = this.spanParent?.startSpan("agent.continuation", {
      type: "workflow",
      attributes: { sessionId: this.sessionId, id },
    });
    const ctx: ContinuationContext = {
      signal: inline.signal,
      id,
      get messages() {
        return agent.messages;
      },
      get pending() {
        return agent.pendingTurns;
      },
      send: (messageOrInstruct: string | Instruct<any>, options?: InlineSendOptions) =>
        this.sendInline(messageOrInstruct, options ?? {}, inline, inlineTurns, span, id),
    };
    let status: SpanStatus = "ok";
    try {
      await after(value, ctx);
    } catch (error) {
      status = spanStatusFromError(error);
      span?.error(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      span?.end(status);
    }
    return { ...value, after: inlineTurns };
  }

  private async sendInline(
    messageOrInstruct: string | Instruct<any>,
    options: InlineSendOptions,
    inline: InlineRunner,
    inlineTurns: InlineTurn[],
    spanParent: Span | undefined,
    threadId: string,
  ): Promise<AgentResult<any> | AgentErrorResult> {
    const prepared = this.prepareSend(messageOrInstruct, options, threadId);
    const result = await inline.run(({ signal }) =>
      this.executeTurn(prepared, { signal, announced: false, spanParent }),
    );
    inlineTurns.push({ userTurn: prepared.userTurn, ...result });
    return result;
  }

  /**
   * Ask the active turn to finish at its next complete tool-batch boundary.
   * The in-flight batch still executes and commits, then the active handle
   * settles without another provider request. A turn whose response requests
   * no tools completes normally. Returns `false` when no turn is executing;
   * queued sends are unaffected — cancel their handles instead.
   */
  stop(): boolean {
    if (!this.turnActive) return false;
    this.stopRequested = true;
    return true;
  }

  /**
   * Cancel whatever remains of the active operation. Its handle rejects with
   * an `AxleAgentAbortError`, exactly as if that handle's own `cancel()` had
   * been called: a turn that already opened settles `cancelled` with its
   * partial work committed, a continuation that has not started never does,
   * and one that is running sees `ctx.signal` abort along with any inline
   * turn in flight. Queued operations are unaffected and the next one starts.
   * Returns `false` when nothing remains: nothing is running, or the active
   * turn is in its settle window with no continuation to run.
   */
  cancel(reason?: unknown): boolean {
    return this.scheduler.cancelCurrent(reason);
  }

  /**
   * Cancel every queued operation without touching the active turn. Each
   * cleared handle rejects with an `AxleAgentAbortError`, exactly as if it
   * had been cancelled individually; nothing is committed to history.
   * Returns the number of operations cleared.
   *
   * `agent.stop(); agent.clear(); agent.send(next)` interjects `next` as the
   * next turn: the active turn settles at its tool-batch boundary, queued
   * work is dropped, and `next` runs against the committed history.
   */
  clear(): number {
    return this.scheduler.clear();
  }

  private async executeTurn(
    prepared: PreparedSend,
    runtime: { signal: AbortSignal; announced: boolean; spanParent?: Span },
  ): Promise<AgentResult<any> | AgentErrorResult> {
    const {
      instruct,
      fileResolver,
      message,
      userTurn,
      requestOptions,
      turnTimeoutMs,
      streamStallMs,
    } = prepared;
    const { announced } = runtime;
    let signal = runtime.signal;
    let userTurnOpened = false;
    const emptyUsage: Stats = createStats();
    const turnEventBuilder = new TurnEventBuilder();
    let agentTurnId: string | undefined;
    const finalize = (
      outcome: "complete" | "cancelled" | "error",
      failure?: AxleProviderFailure,
    ): void => {
      for (const event of turnEventBuilder.finalizeTurn(outcome, failure)) this.emitEvent(event);
    };

    const root = (runtime.spanParent ?? this.spanParent)?.startSpan("agent.send", {
      type: "workflow",
      attributes: {
        sessionId: this.sessionId,
        ...(this.name ? { agentName: this.name } : {}),
      },
    });
    logContent(root, "message", getTextContent(message.content));
    let status: SpanStatus = "ok";
    let streamSpan: Span | undefined;

    this.turnActive = true;
    this.stopRequested = false;
    try {
      // Lifecycle: prepare dependencies and context
      if (signal.aborted) {
        throw new AxleAbortError("Agent send aborted", { reason: signal.reason });
      }

      await this.resolveMcpTools(signal, root);

      if (signal.aborted) {
        throw new AxleAbortError("Agent send aborted", { reason: signal.reason });
      }

      // Lifecycle: commit the user message and open the agent turn
      const priorMessages = this.messages;
      this.messagesInternal.push(message);
      this.emitEvent({ type: "turn:user", turn: userTurn });
      userTurnOpened = true;
      using deadline = timeoutSignal(runtime.signal, turnTimeoutMs);
      signal = deadline.signal;
      const startEvent = turnEventBuilder.startAgentTurn();
      agentTurnId = startEvent.turnId;
      this.emitEvent(startEvent);

      // Lifecycle: compact before the provider turn
      const beforeTurnCompaction = this.compaction;
      if (beforeTurnCompaction?.triggers?.beforeTurn) {
        await this.runCompaction(beforeTurnCompaction, signal, "beforeTurn", {
          state: priorMessages,
          target: { type: "turn", turnId: startEvent.turnId },
          onApplied: () => {
            this.messagesInternal.push(message);
          },
        });
      }

      // Lifecycle: stream the provider turn
      streamSpan = root?.startSpan("stream", { type: "internal" });
      const { signal: _requestSignal, ...streamRequestOptions } = requestOptions ?? {};
      const streamHandle = stream({
        provider: this.provider,
        model: this.model,
        messages: [...this.messagesInternal],
        system: this.system,
        tools: this.callableTools(),
        providerTools: this.registry.provider(),
        onToolCall: this.toolCallHandler,
        sessionId: this.sessionId,
        agentName: this.name,
        span: streamSpan,
        fileResolver: fileResolver ?? this.fileResolver,
        streamStallMs,
        ...streamRequestOptions,
        signal,
      });

      this.activeStream = streamHandle;
      streamHandle.on((streamEvent) => {
        const turnEvents = turnEventBuilder.handleStreamEvent(streamEvent);
        for (const evt of turnEvents) this.emitEvent(evt);
      });
      streamHandle.onToolBatchComplete(() =>
        this.stopRequested
          ? "finish"
          : {
              system: this.system,
              tools: this.callableTools(),
              providerTools: this.registry.provider(),
            },
      );

      const streamResult = await streamHandle.final;
      streamSpan?.end(streamResult.ok ? "ok" : "error");
      streamSpan = undefined;

      if (streamResult.ok && streamResult.final?.finishReason) {
        root?.setAttribute("finishReason", streamResult.final.finishReason);
      }
      if (streamResult.messages.length > 0) {
        this.messagesInternal.push(...streamResult.messages);
      }

      const usage = streamResult.usage ?? emptyUsage;
      root?.setAttributes({ inputTokens: usage.in, outputTokens: usage.out });

      if (!streamResult.ok) {
        status = "error";
        finalize("error", streamResult.error);
        return {
          ok: false,
          error: streamResult.error,
          turn: this.transcript.getTurn(startEvent.turnId),
          usage,
        };
      }

      // Lifecycle: parse the response and compact the completed turn
      let response: any;
      let parseFailure: AgentErrorResult["error"] | undefined;
      try {
        response = instruct.parse(streamResult.final);
      } catch (parseError) {
        parseFailure = {
          kind: "parse",
          message: parseError instanceof Error ? parseError.message : String(parseError),
          cause: parseError,
        };
      }

      const afterTurnCompaction = this.compaction;
      if (!parseFailure && afterTurnCompaction?.triggers?.afterTurn) {
        await this.runCompaction(afterTurnCompaction, signal, "afterTurn", {
          state: this.messages,
          target: { type: "turn", turnId: startEvent.turnId },
        });
      }

      if (parseFailure) finalize("error", parseFailure);
      else finalize("complete");
      const agentTurn = this.transcript.getTurn(startEvent.turnId);

      if (parseFailure) {
        status = "error";
        return { ok: false, error: parseFailure, turn: agentTurn, usage };
      }

      if (!agentTurn) {
        throw new AxleError("Agent turn missing after send");
      }

      return { ok: true, response, turn: agentTurn, usage };
    } catch (error) {
      // Lifecycle: settle a failed or cancelled turn
      status = signal.aborted ? "cancelled" : spanStatusFromError(error);

      if (
        (error instanceof AxleAbortError || error instanceof AxleToolFatalError) &&
        error.messages?.length
      ) {
        this.messagesInternal.push(...error.messages);
      }

      finalize(status === "cancelled" ? "cancelled" : "error");
      if (announced && !userTurnOpened) {
        this.emitEvent({
          type: "pending:dropped",
          id: userTurn.id,
          reason:
            status === "cancelled"
              ? { type: "cancelled" }
              : {
                  type: "error",
                  error: {
                    type: "setup",
                    message: error instanceof Error ? error.message : String(error),
                  },
                },
        });
      }
      const turn = agentTurnId ? this.transcript.getTurn(agentTurnId) : undefined;
      root?.error(error instanceof Error ? error.message : String(error));

      if (
        signal.aborted ||
        error instanceof AxleAbortError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new AxleAgentAbortError("Agent send aborted", {
          reason: error instanceof AxleAbortError ? error.reason : signal.reason,
          messages: error instanceof AxleAbortError ? error.messages : undefined,
          partial: error instanceof AxleAbortError ? error.partial : undefined,
          turn,
          usage: error instanceof AxleAbortError ? (error.usage ?? emptyUsage) : emptyUsage,
        });
      }

      if (error instanceof AxleToolFatalError) {
        throw new AxleToolFatalError(error.message, {
          toolName: error.toolName,
          messages: error.messages,
          partial: error.partial,
          usage: error.usage ?? emptyUsage,
          cause: error.cause,
        });
      }

      throw error;
    } finally {
      // Lifecycle: release per-turn state and observability
      streamSpan?.end(status);
      this.activeStream = undefined;
      this.turnActive = false;
      this.stopRequested = false;
      this.transcript = new Transcript();
      root?.end(status);
      await this.ownedTracer?.flush();
    }
  }

  private async resolveMcpTools(signal: AbortSignal, span?: Span): Promise<void> {
    for (const mcp of this.mcps) {
      if (this.resolvedMcps.has(mcp)) continue;
      const tools = await mcp.listTools({ prefix: mcp.name, span: span, signal });
      this.registry.addMcp(tools);
      this.resolvedMcps.add(mcp);
    }
  }

  /**
   * Set the compaction implementation and its optional automatic triggers.
   * Setting another configuration replaces it.
   */
  setCompaction(config: CompactionConfig): void {
    this.compaction = config;
  }

  /**
   * Run the registered compaction against the active conversation.
   *
   * Compaction is optional: with no config registered this resolves `false`.
   * Otherwise the call is enqueued behind in-flight sends so compaction never
   * races a turn. Explicit compaction bypasses `shouldCompactOnTrigger`: the
   * engine opens a turn, streams the `CompactionPart` in it, and resolves
   * `true` once applied. Failures settle the part and turn as errored on the
   * transcript and reject.
   * Cancellation rejects with `AxleAgentAbortError`, matching `send()`.
   *
   * Do not await this from inside a running send (a tool's `execute`,
   * `onToolCall`, or a compaction callback): the send holds the queue, so the
   * nested call deadlocks.
   */
  compact(options?: { signal?: AbortSignal }): Promise<boolean> {
    const config = this.compaction;
    if (!config) return Promise.resolve(false);

    const id = crypto.randomUUID();
    const dropCancelled = (): void =>
      this.emitEvent({ type: "pending:dropped", id, reason: { type: "cancelled" } });
    this.emitEvent({
      type: "pending:queued",
      turn: {
        id,
        owner: "agent",
        status: "pending",
        parts: [{ id, type: "compaction", trigger: "manual", status: "pending" }],
      },
    });

    return this.scheduler.schedule(
      id,
      async ({ signal }) => {
        if (signal.aborted) dropCancelled();
        try {
          const outcome = await this.runCompaction(config, signal, "manual", {
            state: this.messages,
            target: { type: "self-wrapped", id },
          });
          return outcome === "applied";
        } finally {
          this.transcript = new Transcript();
        }
      },
      {
        signal: options?.signal,
        kind: "compaction",
        start: (signal) => this.start({ kind: "compaction", id, signal }),
        onWithdrawn: dropCancelled,
        settle: (result) => this.settle({ kind: "compaction", id, result }),
      },
    ).final;
  }

  private async runCompaction(
    config: CompactionConfig,
    signal: AbortSignal,
    trigger: CompactionTrigger,
    run: {
      state: AxleMessage[];
      target: { type: "turn"; turnId: string } | { type: "self-wrapped"; id: string };
      onApplied?: () => void;
    },
  ): Promise<"applied" | "declined" | "errored"> {
    const manualAbort = (): never => {
      throw new AxleAgentAbortError("Agent compact aborted", {
        reason: signal.reason,
        usage: createStats(),
      });
    };
    if (signal.aborted) {
      if (trigger === "manual") manualAbort();
      return "declined";
    }

    const root = this.spanParent?.startSpan("agent.compact", {
      type: "workflow",
      attributes: {
        sessionId: this.sessionId,
        trigger,
        ...(this.name ? { agentName: this.name } : {}),
      },
    });
    let status: SpanStatus = "ok";

    try {
      const before = this.estimateContext(run.state);
      if (
        trigger !== "manual" &&
        config.shouldCompactOnTrigger &&
        !config.shouldCompactOnTrigger({ messages: [...run.state] }, { usage: before, trigger })
      ) {
        root?.setAttribute("outcome", "skipped");
        return "declined";
      }

      const selfWrapped = run.target.type === "self-wrapped";
      const id = run.target.type === "self-wrapped" ? run.target.id : crypto.randomUUID();
      const start = new Date().toISOString();
      const turnId = run.target.type === "self-wrapped" ? id : run.target.turnId;
      if (selfWrapped) {
        this.emitEvent({ type: "turn:start", turnId, timing: { start } });
      }
      this.emitEvent({
        type: "part:start",
        turnId,
        part: { id, type: "compaction", trigger, status: "running", timing: { start } },
      });

      try {
        const result = await config.compact(
          { messages: [...run.state] },
          {
            usage: before,
            signal,
            trigger,
            id,
            emit: (update) => {
              this.emitEvent({ type: "compaction:update", turnId, partId: id, update });
            },
          },
        );
        if (signal.aborted)
          throw new AxleAbortError("Agent compact aborted", { reason: signal.reason });
        if (!result || !Array.isArray(result.messages)) {
          throw new AxleError("Compaction callback must return { messages }", {
            code: "COMPACTION_INVALID_MESSAGES",
          });
        }
        validateCompactedMessages(result.messages);
        this.messagesInternal = [...result.messages];
        run.onApplied?.();

        const summary = result.summary;
        const timing = { start, end: new Date().toISOString() };
        this.emitEvent({
          type: "compaction:complete",
          turnId,
          partId: id,
          ...(summary ? { summary } : {}),
          timing,
        });
        if (selfWrapped) {
          this.emitEvent({
            type: "turn:end",
            turnId,
            status: "complete",
            usage: createStats(),
            timing,
          });
        }
        if (root) {
          root.setAttributes({
            outcome: "complete",
            beforeTokens: before.total,
            afterTokens: this.context().total,
          });
        }
        return "applied";
      } catch (error) {
        const aborted =
          signal.aborted || error instanceof AxleAbortError || error instanceof AxleAgentAbortError;
        const message = error instanceof Error ? error.message : String(error);
        const timing = { start, end: new Date().toISOString() };
        if (aborted) {
          this.emitEvent({ type: "compaction:cancelled", turnId, partId: id, timing });
        } else {
          this.emitEvent({ type: "compaction:error", turnId, partId: id, error: message, timing });
        }
        if (selfWrapped) {
          this.emitEvent({
            type: "turn:end",
            turnId,
            status: aborted ? "cancelled" : "error",
            usage: createStats(),
            timing,
          });
        }
        if (aborted) {
          root?.setAttribute("outcome", "skipped");
          if (trigger === "manual") manualAbort();
          return "errored";
        }
        status = spanStatusFromError(error);
        root?.error(message);
        root?.setAttribute("outcome", "error");
        if (trigger === "manual") throw error;
        return "errored";
      }
    } finally {
      root?.end(status);
      await this.ownedTracer?.flush();
    }
  }

  /**
   * Capture the serializable session state to resume from later.
   *
   * Resolves at once when the agent is idle, and otherwise when it next goes
   * idle, so the capture is always at rest — a snapshot never contains a
   * streaming or running turn, and it includes everything queued before the
   * agent went idle. It is not queued work: it does not make the agent busy,
   * fires no `onIdle`, and is not cancelled by `clear()`.
   * The returned object is the resumable state: session id and the active
   * model-facing conversation. It contains no renderable turn state —
   * transcripts are consumer-owned; persist your `Transcript.turns`
   * alongside it.
   *
   * Do not await this from inside a running send (a tool's `execute`,
   * `onToolCall`, or a compaction callback) or an `onSettled` callback: the
   * agent cannot go idle until they return, so the nested call deadlocks.
   */
  snapshot(): Promise<AgentSession> {
    if (this.scheduler.status.phase === "idle") return Promise.resolve(this.currentSession());
    const { promise, resolve } = Promise.withResolvers<AgentSession>();
    const unsubscribe = this.onIdle(() => {
      unsubscribe();
      resolve(this.currentSession());
    });
    return promise;
  }

  private currentSession(): AgentSession {
    return { sessionId: this.sessionId, messages: this.messages };
  }

  private notifyIdle(): void {
    for (const callback of [...this.idleCallbacks]) {
      try {
        callback();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const span = this.spanParent?.startSpan("agent.idle", {
          type: "workflow",
          attributes: { sessionId: this.sessionId },
        });
        span?.warn(`onIdle callback threw: ${message}`);
        span?.end();
      }
    }
  }

  private async start(operation: StartedOperation): Promise<void> {
    if (this.startCallbacks.length === 0) return;
    const failures = await this.runCallbacks(
      "agent.start",
      { kind: operation.kind },
      this.startCallbacks.map((cb) => () => cb(operation)),
    );
    if (failures.length === 0) return;
    const [failure] = failures;
    const message = failure instanceof Error ? failure.message : String(failure);
    this.emitEvent({
      type: "pending:dropped",
      id: operation.id,
      reason: { type: "error", error: { type: "start", message } },
    });
    throw failure;
  }

  private async settle(operation: SettledOperation): Promise<void> {
    if (this.settledCallbacks.length === 0) return;
    const session = this.currentSession();
    await this.runCallbacks(
      "agent.settle",
      { kind: operation.kind },
      this.settledCallbacks.map((cb) => () => cb(session, operation)),
      "onSettled",
    );
  }

  private async runCallbacks(
    name: string,
    attributes: { kind: OperationKind },
    callbacks: Array<() => void | Promise<void>>,
    warnAs?: string,
  ): Promise<unknown[]> {
    const span = this.spanParent?.startSpan(name, {
      type: "workflow",
      attributes: { sessionId: this.sessionId, ...attributes },
    });
    const results = await Promise.allSettled(callbacks.map(async (cb) => cb()));
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    for (const failure of warnAs ? failures : []) {
      const message = failure instanceof Error ? failure.message : String(failure);
      span?.warn(`${warnAs} callback threw: ${message}`);
    }
    span?.end();
    await this.ownedTracer?.flush();
    return failures;
  }

  private emitEvent(event: TurnEvent): void {
    this.transcript.apply(event);
    switch (event.type) {
      case "pending:queued":
        this.pendingTurns = [...this.pendingTurns, event.turn];
        break;
      case "pending:dropped":
      case "turn:user":
      case "turn:start": {
        const id =
          event.type === "pending:dropped"
            ? event.id
            : event.type === "turn:user"
              ? event.turn.id
              : event.turnId;
        this.pendingTurns = this.pendingTurns.filter((turn) => turn.id !== id);
        break;
      }
    }
    for (const cb of this.eventCallbacks) cb(event);
  }

  private callableTools(): AnyTool[] {
    return [...this.registry.executable(), ...this.registry.deferred()];
  }

  private toToolDefinitions(tools: AnyTool[]): ToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
  }
}

function outcomeOf(result: PromiseSettledResult<unknown>): OperationOutcome {
  if (result.status === "fulfilled") return { type: "complete" };
  if (result.reason instanceof AxleAbortError) {
    return isTimeoutReason(result.reason.reason)
      ? { type: "cancelled", reason: result.reason.reason }
      : { type: "cancelled" };
  }
  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return { type: "error", error: { message } };
}
