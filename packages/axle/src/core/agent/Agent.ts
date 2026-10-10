import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import type { MCP } from "../../mcp/index.js";
import { validateCompactedMessages } from "../../messages/compaction.js";
import type { AxleMessage, AxleUserMessage } from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { logContent } from "../../observability/log.js";
import type { Tracer } from "../../observability/tracer.js";
import type { Span, SpanStatus } from "../../observability/types.js";
import { estimateContextUsage } from "../../providers/context.js";
import { stream } from "../../providers/stream.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import { createViewSkillTool, renderSkillsCatalog } from "../../skills/prompt.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ExecutableTool, ToolDefinition } from "../../tools/types.js";
import { TurnEventBuilder, userTurnFromMessage } from "../../turns/eventBuilder.js";
import type { TurnEvent } from "../../turns/events.js";
import { Transcript } from "../../turns/transcript.js";
import type { Turn } from "../../turns/types.js";
import type { Stats } from "../../types.js";
import type { FileResolver } from "../../utils/file.js";
import { createStats } from "../../utils/stats.js";
import { Instruct } from "../Instruct.js";
import type { OutputSchema, ParsedSchema } from "../parse.js";
import { resolveObservability, spanStatusFromError } from "./observability.js";
import { AgentScheduler } from "./scheduler.js";
import type {
  AgentConfig,
  AgentErrorResult,
  AgentHandle,
  AgentResult,
  AgentSession,
  CompactionConfig,
  CompactionTrigger,
  SendMessageOptions,
  SettledCallback,
  SettledOperation,
  TurnEventCallback,
} from "./types.js";

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
  readonly requestOptions: Omit<AxleModelRequestOptions, "signal">;
  readonly registry: ToolRegistry;

  sessionId: string;
  system: string | undefined;

  private mcps: MCP[] = [];
  private resolvedMcps = new WeakSet<MCP>();
  private spanParent?: Tracer | Span;
  private ownedTracer?: Tracer;

  private eventCallbacks: TurnEventCallback[] = [];
  private settledCallbacks: SettledCallback[] = [];
  private compaction?: CompactionConfig;
  private scheduler = new AgentScheduler();
  private turnActive = false;
  private stopRequested = false;
  private transcript = new Transcript();
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
    this.system = config.system;
    this.name = config.name;
    this.fileResolver = config.fileResolver;
    this.requestOptions = {
      reasoning: config.reasoning,
      maxOutputTokens: config.maxOutputTokens,
      toolChoice: config.toolChoice,
      parallelToolCalls: config.parallelToolCalls,
      providerOptions: config.providerOptions,
    };
    this.registry = new ToolRegistry({
      tools: config.tools,
      providerTools: config.providerTools,
    });
    if (config.skills && config.skills.length > 0) {
      this.system = [config.system, renderSkillsCatalog(config.skills)]
        .filter((section) => section !== undefined)
        .join("\n\n");
      this.registry.add(createViewSkillTool(config.skills));
    }
    if (config.mcps) {
      this.mcps = [...config.mcps];
    }
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

  on(callback: TurnEventCallback) {
    this.eventCallbacks.push(callback);
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index >= 0) this.eventCallbacks.splice(index, 1);
    };
  }

  /**
   * Receive the session each time an operation settles.
   *
   * Fires once after every send or manual compaction that ran, however it
   * ended: after its `turn:end` when it opened a turn, and before its handle
   * settles. The agent is at rest and the next queued operation has not
   * started, so a host that reads its `Transcript.turns` inside the callback
   * gets turns and messages that match. An operation cancelled while still
   * queued never ran and does not fire. The session is the one `snapshot()`
   * returns; unlike `snapshot()`, it does not wait behind queued operations.
   * The operation carries exactly what the handle is about to settle with:
   * the result on success, the rejection reason otherwise.
   *
   * A callback may return a promise. The handle does not settle and the next
   * queued operation does not start until every callback has settled; all
   * callbacks run together. A callback that throws or rejects cannot affect
   * the operation: the error is recorded on the trace and the other callbacks
   * still run. The operation is already done while callbacks run, so
   * `cancel()` and `stop()` return `false` in that window.
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
      tools: this.toToolDefinitions(this.registry.local()),
      providerTools: this.registry.provider(),
      mcpTools: this.toToolDefinitions(this.registry.mcp()),
    });
  }

  /** Schedule a FIFO conversation turn. */
  send(message: string | Instruct<undefined>, options?: SendMessageOptions): AgentHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: SendMessageOptions,
  ): AgentHandle<ParsedSchema<TSchema>>;
  send(messageOrInstruct: string | Instruct<any>, options?: SendMessageOptions): AgentHandle<any> {
    const { fileResolver, metadata, ...modelOptions } = options ?? {};
    const instruct =
      typeof messageOrInstruct === "string"
        ? new Instruct({ prompt: messageOrInstruct, vars: "optional" })
        : messageOrInstruct.clone();
    instruct.validate();
    const requestOptions = mergeAxleModelRequestOptions(this.requestOptions, modelOptions);
    const message = instruct.toMessage({ metadata });
    const userTurn = userTurnFromMessage(message);

    this.emitEvent({ type: "pending:queued", turn: { ...userTurn, status: "pending" } });

    return this.scheduler.schedule(
      ({ signal }) =>
        this.executeTurn(instruct, {
          signal,
          fileResolver,
          message,
          userTurn,
          requestOptions,
        }),
      {
        signal: modelOptions.signal,
        onWithdrawn: () =>
          this.emitEvent({
            type: "pending:dropped",
            id: userTurn.id,
            reason: { type: "cancelled" },
          }),
        settle: (result) => this.settle({ kind: "send", result }),
      },
    );
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
   * Cancel the active operation immediately. Its handle rejects with an
   * `AxleAgentAbortError`, exactly as if that handle's own `cancel()` had been
   * called: a turn that already opened settles `cancelled` with its partial
   * work committed. Queued operations are unaffected and the next one starts.
   * Returns `false` when nothing is running.
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
    instruct: Instruct<any>,
    runtime: {
      signal: AbortSignal;
      fileResolver?: FileResolver;
      message: AxleUserMessage;
      userTurn: Turn;
      requestOptions?: AxleModelRequestOptions;
    },
  ): Promise<AgentResult<any> | AgentErrorResult> {
    const { signal, fileResolver, message, userTurn, requestOptions } = runtime;
    let userTurnOpened = false;
    const emptyUsage: Stats = createStats();
    const turnEventBuilder = new TurnEventBuilder();
    let agentTurnId: string | undefined;
    const finalize = (outcome: "complete" | "cancelled" | "error"): void => {
      for (const event of turnEventBuilder.finalizeTurn(outcome)) this.emitEvent(event);
    };

    const root = this.spanParent?.startSpan("agent.send", {
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
        registry: this.registry,
        sessionId: this.sessionId,
        span: streamSpan,
        fileResolver: fileResolver ?? this.fileResolver,
        ...streamRequestOptions,
        signal,
      });

      streamHandle.on((streamEvent) => {
        const turnEvents = turnEventBuilder.handleStreamEvent(streamEvent);
        for (const evt of turnEvents) this.emitEvent(evt);
      });
      streamHandle.onToolBatchComplete(() => (this.stopRequested ? "finish" : "continue"));

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
        finalize("error");
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

      finalize("complete");
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
      if (!userTurnOpened) {
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
        parts: [{ id, type: "compaction", status: "pending" }],
      },
    });

    return this.scheduler.schedule(
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
        operation: "compact",
        onWithdrawn: dropCancelled,
        settle: (result) => this.settle({ kind: "compaction", result }),
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
        part: { id, type: "compaction", status: "running", timing: { start } },
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
        this.emitEvent({ type: "compaction:error", turnId, partId: id, error: message, timing });
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
   * Capture the serializable session state for later continuation.
   *
   * Enqueued behind in-flight sends and compactions, so the capture is
   * always at rest — a snapshot never contains a streaming or running turn.
   * The returned object is the pure continuation: session id and the active
   * model-facing conversation. It contains no renderable turn state —
   * transcripts are host-owned; persist your `Transcript.turns`
   * alongside it.
   *
   * Do not await this from inside a running send (a tool's `execute`,
   * `onToolCall`, or a compaction callback): the send holds the queue, so the
   * nested call deadlocks.
   */
  snapshot(): Promise<AgentSession> {
    return this.scheduler.schedule(async (): Promise<AgentSession> => this.currentSession()).final;
  }

  private currentSession(): AgentSession {
    return { sessionId: this.sessionId, messages: this.messages };
  }

  private async settle(operation: SettledOperation): Promise<void> {
    if (this.settledCallbacks.length === 0) return;
    const session = this.currentSession();
    const span = this.spanParent?.startSpan("agent.settle", {
      type: "workflow",
      attributes: { sessionId: this.sessionId, kind: operation.kind },
    });
    try {
      await Promise.all(
        this.settledCallbacks.map(async (cb) => {
          try {
            await cb(session, operation);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            span?.warn(`onSettled callback threw: ${message}`);
          }
        }),
      );
    } finally {
      span?.end();
      await this.ownedTracer?.flush();
    }
  }

  private emitEvent(event: TurnEvent): void {
    this.transcript.apply(event);
    for (const cb of this.eventCallbacks) cb(event);
  }

  private toToolDefinitions(tools: ExecutableTool[]): ToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
  }
}
