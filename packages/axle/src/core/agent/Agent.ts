import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import type { MCP } from "../../mcp/index.js";
import type { AgentMemory } from "../../memory/types.js";
import type { CompactionRecord } from "../../messages/compaction.js";
import { validateCompactedMessages } from "../../messages/compaction.js";
import type { AxleMessage } from "../../messages/message.js";
import { getTextContent } from "../../messages/utils.js";
import { logContent } from "../../observability/log.js";
import type { Tracer } from "../../observability/tracer.js";
import type { Span, SpanStatus } from "../../observability/types.js";
import { estimateContextUsage } from "../../providers/context.js";
import type { StreamResult } from "../../providers/helpers.js";
import { stream } from "../../providers/stream.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ExecutableTool, ToolDefinition } from "../../tools/types.js";
import { TurnAccumulator } from "../../turns/accumulator.js";
import { TurnEventBuilder } from "../../turns/eventBuilder.js";
import type { TurnEvent } from "../../turns/events.js";
import type { Turn } from "../../turns/types.js";
import type { Stats } from "../../types.js";
import type { FileResolver } from "../../utils/file.js";
import { createStats } from "../../utils/stats.js";
import { type Handle } from "../../utils/utils.js";
import { Instruct } from "../Instruct.js";
import type { OutputSchema, ParsedSchema } from "../parse.js";
import { compileUserTurn, type CompiledUserTurn } from "../userTurn.js";
import { History } from "./history.js";
import { resolveObservability, spanStatusFromError } from "./observability.js";
import type {
  AgentConfig,
  AgentErrorResult,
  AgentHandle,
  AgentResult,
  AgentSession,
  CompactionCallback,
  SendMessageOptions,
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
  readonly history: History;
  readonly name?: string;
  readonly fileResolver?: FileResolver;
  readonly requestOptions: Omit<AxleModelRequestOptions, "signal">;
  readonly registry: ToolRegistry;

  sessionId: string;
  system: string | undefined;

  private mcps: MCP[] = [];
  private resolvedMcps = new WeakSet<MCP>();
  private memory?: AgentMemory;
  private spanParent?: Tracer | Span;
  private ownedTracer?: Tracer;

  private eventCallbacks: TurnEventCallback[] = [];
  private compactionCallback?: CompactionCallback;
  private workQueue: Promise<void> = Promise.resolve();
  private accumulator: TurnAccumulator;

  /**
   * Create an agent from runtime config and, optionally, restore saved session state.
   *
   * When both `config.sessionId` and `session.sessionId` are supplied, the
   * restored session id wins.
   */
  constructor(config: AgentConfig, session?: AgentSession) {
    if (session && session.version !== 1) {
      throw new AxleError(`Unsupported agent session version: ${session.version}`);
    }
    this.provider = config.provider;
    this.model = config.model;
    this.sessionId = session?.sessionId ?? config.sessionId ?? crypto.randomUUID();
    this.history = new History(
      session
        ? {
            turns: session.turns,
            messages: session.messages,
            archive: session.archive,
            compactions: session.compactions,
            sessionAnnotations: session.sessionAnnotations,
          }
        : undefined,
    );
    this.accumulator = new TurnAccumulator({
      turns: this.history.turns,
      sessionAnnotations: this.history.sessionAnnotations,
    });
    const observability = resolveObservability(config.observability);
    this.spanParent = observability.parent;
    this.ownedTracer = observability.owned;
    this.system = config.system;
    this.name = config.name;
    this.fileResolver = config.fileResolver;
    this.requestOptions = {
      reasoning: config.reasoning,
      maxOutputTokens: config.maxOutputTokens,
      temperature: config.temperature,
      topP: config.topP,
      stop: config.stop,
      toolChoice: config.toolChoice,
      parallelToolCalls: config.parallelToolCalls,
      providerOptions: config.providerOptions,
    };
    this.registry = new ToolRegistry({
      tools: config.tools,
      providerTools: config.providerTools,
    });
    if (config.mcps) {
      this.mcps = [...config.mcps];
    }
    if (config.memory) {
      this.memory = config.memory;
      const memoryTools = config.memory.tools?.();
      if (memoryTools) this.registry.add(memoryTools);
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

  context(): ContextUsage {
    return this.estimateContext(this.history.messages);
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

  /**
   * Register the compaction callback: the policy and strategy for shrinking
   * the active conversation. One callback per agent; registering again
   * replaces it.
   */
  onCompaction(callback: CompactionCallback): void {
    this.compactionCallback = callback;
  }

  /**
   * Run the registered compaction callback against the active conversation.
   *
   * Compaction is optional: with no callback registered this is a no-op that
   * resolves `null`. Otherwise the call is enqueued behind in-flight sends so
   * compaction never races a turn. The callback may return `null` to skip;
   * cancellation also resolves `null`. Errors propagate — a manual compact
   * was explicitly requested.
   *
   * Do not await this from inside a running send (a tool's `execute`,
   * `onToolCall`, or a compaction callback): the send holds the queue, so the
   * nested call deadlocks.
   */
  compact(options?: { signal?: AbortSignal }): Promise<CompactionRecord | null> {
    const callback = this.compactionCallback;
    if (!callback) return Promise.resolve(null);

    const work = async (signal: AbortSignal): Promise<CompactionRecord | null> => {
      if (signal.aborted) return null;

      const root = this.spanParent?.startSpan("agent.compact", {
        type: "workflow",
        attributes: {
          sessionId: this.sessionId,
          ...(this.name ? { agentName: this.name } : {}),
        },
      });
      let status: SpanStatus = "ok";

      const id = crypto.randomUUID();
      const start = new Date().toISOString();
      this.emitEvent({ type: "compaction:start", id, timing: { start } });

      const end = (outcome: "complete" | "skipped" | "error", record?: CompactionRecord): void => {
        root?.setAttribute("outcome", outcome);
        this.emitEvent({
          type: "compaction:end",
          id,
          outcome,
          record,
          timing: { start, end: new Date().toISOString() },
        });
      };

      try {
        const before = this.context();
        const messages = await callback(
          { messages: this.history.messages },
          {
            usage: before,
            signal,
          },
        );

        if (signal.aborted || messages == null) {
          end("skipped");
          return null;
        }

        validateCompactedMessages(messages);
        const record: CompactionRecord = { id, at: start };
        this.history.compact(messages, record);
        if (root) {
          root.setAttributes({
            beforeTokens: before.total,
            afterTokens: this.context().total,
          });
        }
        end("complete", record);
        return record;
      } catch (error) {
        // A cancelled compaction is a skip, not a failure — the callback
        // forwarding the signal (and its inner call throwing on abort) is the
        // expected shape, and nothing was changed.
        if (signal.aborted) {
          end("skipped");
          return null;
        }
        status = spanStatusFromError(error);
        root?.error(error instanceof Error ? error.message : String(error));
        end("error");
        throw error;
      } finally {
        root?.end(status);
        await this.ownedTracer?.flush();
      }
    };

    return this.queue(work, options?.signal).final;
  }

  /**
   * Capture the serializable session state for later continuation.
   *
   * Enqueued behind in-flight sends and compactions, so the capture is
   * always at rest — a snapshot never contains a streaming or running turn.
   * The returned object contains message history and renderable turn state,
   * but not executable configuration such as providers, tools, MCP clients,
   * memory, or tracers.
   *
   * Do not await this from inside a running send (a tool's `execute`,
   * `onToolCall`, or a compaction callback): the send holds the queue, so the
   * nested call deadlocks.
   */
  snapshot(): Promise<AgentSession> {
    const work = async (): Promise<AgentSession> => {
      const { messages, archive, compactions, turns, sessionAnnotations } = this.history;
      return {
        version: 1,
        sessionId: this.sessionId,
        messages,
        archive,
        compactions,
        turns,
        sessionAnnotations,
      };
    };
    return this.queue(work).final;
  }

  send(message: string | Instruct<undefined>, options?: SendMessageOptions): AgentHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: SendMessageOptions,
  ): AgentHandle<ParsedSchema<TSchema>>;
  send(messageOrInstruct: string | Instruct<any>, options?: SendMessageOptions): AgentHandle<any> {
    const { fileResolver, metadata, ...modelOptions } = options ?? {};
    const userTurn = compileUserTurn(messageOrInstruct, { metadata });
    const requestOptions = mergeAxleModelRequestOptions(this.requestOptions, modelOptions);

    const work = async (signal: AbortSignal) => {
      const root = this.spanParent?.startSpan("agent.send", {
        type: "workflow",
        attributes: {
          sessionId: this.sessionId,
          ...(this.name ? { agentName: this.name } : {}),
        },
      });
      logContent(root, "message", getTextContent(userTurn.message.content));
      let status: SpanStatus = "ok";

      try {
        const result = await this.run(userTurn, {
          signal,
          fileResolver,
          requestOptions,
          span: root,
        });
        if (!result.ok) status = "error";
        root?.setAttributes({
          inputTokens: result.usage.in,
          outputTokens: result.usage.out,
        });
        return result;
      } catch (error) {
        status = spanStatusFromError(error);
        root?.error(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        root?.end(status);
        await this.ownedTracer?.flush();
      }
    };

    return this.queue(work, modelOptions.signal);
  }

  /**
   * Enqueue work behind everything already queued on this agent. Sends and
   * compactions share one queue, so they never overlap.
   *
   * The work is exposed as two promises: `final` carries the outcome to the
   * caller; `workQueue` carries only sequencing, with the outcome stripped —
   * a rejected `final` in the queue would poison the chain and block all
   * later work. Cancelled work still runs in order, but with an
   * already-aborted signal.
   */
  private queue<T>(
    work: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Handle<T> {
    // Per-work controller so handle.cancel() aborts only this work.
    const abort = new AbortController();
    const signal = externalSignal ? AbortSignal.any([externalSignal, abort.signal]) : abort.signal;

    // Chained onto the end of the current queue; work runs once the current tail settles.
    const final = this.workQueue.then(() => work(signal));

    // The queue has to resolve cleanly so the next task can start, hence noops on both resolve and reject
    this.workQueue = final.then(
      () => {},
      () => {},
    );

    return {
      cancel: (reason?: unknown) => abort.abort(reason),
      final,
    };
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
   * The single write path for renderable turn state: every event folds
   * through the agent-lifetime accumulator, History mirrors the result, and
   * subscribers are notified. Engine-internal state and consumer-folded
   * state agree by construction because they run the same fold.
   */
  private emitEvent(event: TurnEvent): void {
    const result = this.accumulator.apply(event);
    if (result.handled) {
      this.history.replaceTurns(result.state.turns, result.state.sessionAnnotations ?? []);
    }
    for (const cb of this.eventCallbacks) cb(event);
  }

  private toToolDefinitions(tools: ExecutableTool[]): ToolDefinition[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));
  }

  private async run(
    userTurn: CompiledUserTurn<any>,
    runtime: {
      signal: AbortSignal;
      fileResolver?: FileResolver;
      requestOptions?: AxleModelRequestOptions;
      span?: Span;
    },
  ): Promise<AgentResult<any> | AgentErrorResult> {
    const { signal, fileResolver: sendFileResolver, requestOptions } = runtime;
    const span = runtime.span;
    const turnEventBuilder = new TurnEventBuilder();
    let agentTurnId: string | undefined;
    // agentTurnId only ever names the Turn created by startAgentTurn.
    const currentAgentTurn = (): Turn | undefined =>
      agentTurnId
        ? (this.accumulator.state.turns.find((entry) => entry.id === agentTurnId) as
            | Turn
            | undefined)
        : undefined;
    const emptyUsage: Stats = createStats();

    if (signal.aborted) {
      throw new AxleAgentAbortError("Agent send aborted", {
        reason: signal.reason,
        usage: emptyUsage,
      });
    }

    try {
      await this.resolveMcpTools(signal, span);
    } catch (error) {
      if (
        signal.aborted ||
        error instanceof AxleAbortError ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new AxleAgentAbortError("Agent send aborted", {
          reason: error instanceof AxleAbortError ? error.reason : signal.reason,
          usage: emptyUsage,
        });
      }
      throw error;
    }

    let effectiveSystem = this.system;
    const requestMessages = [...this.history.messages, userTurn.message];
    if (this.memory) {
      const recallResult = await this.memory.recall({
        agentName: this.name,
        sessionId: this.sessionId,
        system: this.system,
        messages: requestMessages,
        span: span,
      });
      if (recallResult.systemSuffix) {
        effectiveSystem = (effectiveSystem ?? "") + "\n\n" + recallResult.systemSuffix;
      }
    }

    if (signal.aborted) {
      throw new AxleAgentAbortError("Agent send aborted", {
        reason: signal.reason,
        usage: emptyUsage,
      });
    }

    this.history.append(userTurn.message);
    for (const evt of turnEventBuilder.createUserTurn(userTurn.message)) {
      this.emitEvent(evt);
    }

    // Start agent turn
    const startEvent = turnEventBuilder.startAgentTurn();
    agentTurnId = startEvent.turnId;
    this.emitEvent(startEvent);

    const streamSpan = span?.startSpan("stream", { type: "internal" }) ?? undefined;
    const { signal: _requestSignal, ...streamRequestOptions } = requestOptions ?? {};
    const streamHandle = stream({
      provider: this.provider,
      model: this.model,
      messages: requestMessages,
      system: effectiveSystem,
      registry: this.registry,
      span: streamSpan,
      fileResolver: sendFileResolver ?? this.fileResolver,
      ...streamRequestOptions,
      signal,
    });

    // Translate StreamEvents → TurnEvents
    streamHandle.on((streamEvent) => {
      const turnEvents = turnEventBuilder.handleStreamEvent(streamEvent);
      for (const evt of turnEvents) this.emitEvent(evt);
    });

    let streamResult: StreamResult;
    let streamSpanStatus: SpanStatus = "ok";
    try {
      streamResult = await streamHandle.final;
      if (!streamResult.ok) streamSpanStatus = "error";
    } catch (error) {
      streamSpanStatus = spanStatusFromError(error);
      if (error instanceof AxleToolFatalError) {
        if (error.messages && error.messages.length > 0) {
          this.history.append(error.messages);
        }

        const finalizeEvents = turnEventBuilder.finalizeTurn("error");
        for (const evt of finalizeEvents) this.emitEvent(evt);

        throw new AxleToolFatalError(error.message, {
          toolName: error.toolName,
          messages: error.messages,
          partial: error.partial,
          usage: error.usage ?? emptyUsage,
          cause: error.cause,
        });
      }
      if (error instanceof AxleAbortError) {
        if (error.messages && error.messages.length > 0) {
          this.history.append(error.messages);
        }

        const finalizeEvents = turnEventBuilder.finalizeTurn("cancelled");
        for (const evt of finalizeEvents) this.emitEvent(evt);

        throw new AxleAgentAbortError("Agent send aborted", {
          reason: error.reason,
          messages: error.messages,
          partial: error.partial,
          turn: currentAgentTurn(),
          usage: error.usage ?? emptyUsage,
        });
      }
      throw error;
    } finally {
      streamSpan?.end(streamSpanStatus);
    }

    const outcome = streamResult.ok ? "complete" : "error";
    if (streamResult.ok && streamResult.final?.finishReason) {
      span?.setAttribute("finishReason", streamResult.final.finishReason);
    }

    if (streamResult.messages.length > 0) {
      this.history.append(streamResult.messages);
    }

    const finalizeEvents = turnEventBuilder.finalizeTurn(outcome);
    for (const evt of finalizeEvents) this.emitEvent(evt);

    const usage = streamResult.usage ?? emptyUsage;
    const agentTurn = currentAgentTurn();

    if (!streamResult.ok) {
      return {
        ok: false,
        error: streamResult.error,
        turn: agentTurn,
        usage,
      };
    }

    let response: any;
    try {
      response = userTurn.parse(streamResult.final);
    } catch (parseError) {
      return {
        ok: false,
        error: {
          kind: "parse",
          error: parseError,
          message: parseError instanceof Error ? parseError.message : String(parseError),
        },
        turn: agentTurn,
        usage,
      };
    }

    if (!agentTurn) {
      throw new AxleError("Agent turn missing after send");
    }

    if (this.memory) {
      try {
        await this.memory.record({
          agentName: this.name,
          sessionId: this.sessionId,
          system: this.system,
          messages: this.history.messages,
          newMessages: streamResult.messages,
          span: span,
        });
      } catch (e) {
        span?.warn("memory record failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ok: true, response, turn: agentTurn, usage };
  }
}
