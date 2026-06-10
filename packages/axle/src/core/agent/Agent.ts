import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import type { MCP } from "../../mcp/index.js";
import type { AgentMemory } from "../../memory/types.js";
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
import { createHandle } from "../../utils/utils.js";
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
  private sendQueue: Promise<void> = Promise.resolve();

  /**
   * Create an agent from runtime config and, optionally, restore saved session state.
   *
   * When both `config.sessionId` and `session.sessionId` are supplied, the
   * restored session id wins.
   */
  constructor(config: AgentConfig, session?: AgentSession) {
    this.provider = config.provider;
    this.model = config.model;
    this.sessionId = config.sessionId ?? crypto.randomUUID();
    this.history = new History();
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
    if (session) {
      this.restore(session);
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
    return estimateContextUsage({
      system: this.system,
      messages: this.history.log,
      tools: this.toToolDefinitions(this.registry.local()),
      providerTools: this.registry.provider(),
      mcpTools: this.toToolDefinitions(this.registry.mcp()),
    });
  }

  /**
   * Capture the serializable session state for later continuation.
   *
   * The returned object contains message history and renderable turn state, but
   * not executable configuration such as providers, tools, MCP clients, memory,
   * or tracers.
   */
  snapshot(): AgentSession {
    const sessionAnnotations = this.history.sessionAnnotations;
    return {
      version: 1,
      sessionId: this.sessionId,
      messages: this.history.log,
      turns: this.history.turns,
      sessionAnnotations: sessionAnnotations.length > 0 ? sessionAnnotations : undefined,
    };
  }

  /**
   * Replace the agent's continuation and render state from a saved session.
   *
   * Restore does not change runtime configuration. The current provider, model,
   * tools, MCP clients, memory, and other constructor-supplied objects remain in
   * effect.
   */
  restore(session: AgentSession): void {
    if (session.version !== 1) {
      throw new AxleError(`Unsupported agent session version: ${session.version}`);
    }
    this.sessionId = session.sessionId;
    this.history.replaceLog(session.messages);
    this.history.replaceTurns(session.turns ?? []);
    this.history.replaceSessionAnnotations(session.sessionAnnotations ?? []);
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

    const { handle, settled } = createHandle(this.sendQueue, work, modelOptions.signal);
    this.sendQueue = settled;
    return handle;
  }

  private async resolveMcpTools(signal: AbortSignal, span?: Span): Promise<void> {
    for (const mcp of this.mcps) {
      if (this.resolvedMcps.has(mcp)) continue;
      const tools = await mcp.listTools({ prefix: mcp.name, span: span, signal });
      this.registry.addMcp(tools);
      this.resolvedMcps.add(mcp);
    }
  }

  private emitEvent(event: TurnEvent): void {
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
    const turnAccumulator = new TurnAccumulator({
      turns: this.history.turns,
      sessionAnnotations: this.history.sessionAnnotations,
    });
    let agentTurnId: string | undefined;
    const applyTurnEvent = (event: TurnEvent): void => {
      const result = turnAccumulator.apply(event);
      if (result.handled) {
        this.history.replaceTurns(result.state.turns);
        this.history.replaceSessionAnnotations(result.state.sessionAnnotations ?? []);
      }
      this.emitEvent(event);
    };
    const currentAgentTurn = (): Turn | undefined =>
      agentTurnId ? turnAccumulator.state.turns.find((turn) => turn.id === agentTurnId) : undefined;
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
    const requestMessages = [...this.history.log, userTurn.message];
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

    this.history.appendToLog(userTurn.message);
    for (const evt of turnEventBuilder.createUserTurn(userTurn.message)) {
      applyTurnEvent(evt);
    }

    // Start agent turn
    const startEvent = turnEventBuilder.startAgentTurn();
    agentTurnId = startEvent.turnId;
    applyTurnEvent(startEvent);

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
      for (const evt of turnEvents) applyTurnEvent(evt);
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
          this.history.appendToLog(error.messages);
        }

        const finalizeEvents = turnEventBuilder.finalizeTurn("error");
        for (const evt of finalizeEvents) applyTurnEvent(evt);

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
          this.history.appendToLog(error.messages);
        }

        const finalizeEvents = turnEventBuilder.finalizeTurn("cancelled");
        for (const evt of finalizeEvents) applyTurnEvent(evt);

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
      this.history.appendToLog(streamResult.messages);
    }

    const finalizeEvents = turnEventBuilder.finalizeTurn(outcome);
    for (const evt of finalizeEvents) applyTurnEvent(evt);

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
          messages: this.history.log,
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
