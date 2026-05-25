import { AxleAbortError } from "../../errors/AxleAbortError.js";
import { AxleAgentAbortError } from "../../errors/AxleAgentAbortError.js";
import { AxleError } from "../../errors/AxleError.js";
import { AxleToolFatalError } from "../../errors/AxleToolFatalError.js";
import type { MCP } from "../../mcp/index.js";
import type { AgentMemory } from "../../memory/types.js";
import { estimateContextUsage } from "../../providers/context.js";
import type { StreamResult } from "../../providers/helpers.js";
import { stream } from "../../providers/stream.js";
import type { AIProvider, AxleModelRequestOptions, ContextUsage } from "../../providers/types.js";
import { ToolRegistry } from "../../tools/registry.js";
import type { ExecutableTool, ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
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
  readonly tracer?: TracingContext;
  readonly name?: string;
  readonly fileResolver?: FileResolver;
  readonly requestOptions: Omit<AxleModelRequestOptions, "signal">;
  readonly registry: ToolRegistry;

  sessionId: string;
  system: string | undefined;

  private mcps: MCP[] = [];
  private resolvedMcps = new WeakSet<MCP>();
  private memory?: AgentMemory;

  private eventCallbacks: TurnEventCallback[] = [];
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.sessionId = config.sessionId ?? crypto.randomUUID();
    this.history = new History();
    this.tracer = config.tracer;
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
    const userTurn = compileUserTurn(messageOrInstruct);
    const requestOptions = mergeAxleModelRequestOptions(this.requestOptions, options);

    const { handle, settled } = createHandle(
      this.sendQueue,
      (signal) => this.run(userTurn, signal, options?.fileResolver, requestOptions),
      options?.signal,
    );
    this.sendQueue = settled;
    return handle;
  }

  private async resolveMcpTools(signal: AbortSignal): Promise<void> {
    for (const mcp of this.mcps) {
      if (this.resolvedMcps.has(mcp)) continue;
      const tools = await mcp.listTools({ prefix: mcp.name, tracer: this.tracer, signal });
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
    signal: AbortSignal,
    sendFileResolver?: FileResolver,
    requestOptions?: AxleModelRequestOptions,
  ): Promise<AgentResult<any> | AgentErrorResult> {
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
      await this.resolveMcpTools(signal);
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
        tracer: this.tracer,
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

    const { signal: _requestSignal, ...streamRequestOptions } = requestOptions ?? {};
    const streamHandle = stream({
      provider: this.provider,
      model: this.model,
      messages: requestMessages,
      system: effectiveSystem,
      registry: this.registry,
      tracer: this.tracer,
      fileResolver: sendFileResolver ?? this.fileResolver,
      ...streamRequestOptions,
      signal,
      onToolCall: async (name, params, ctx) => {
        const tool = this.registry.get(name);
        if (!tool) return null;
        try {
          const result = await tool.execute(params, ctx);
          return { type: "success", content: result };
        } catch (error) {
          if (error instanceof AxleToolFatalError) {
            throw error;
          }
          const msg = error instanceof Error ? error.message : String(error);
          return { type: "error", error: { type: "execution", message: msg } };
        }
      },
    });

    // Translate StreamEvents → TurnEvents
    streamHandle.on((streamEvent) => {
      const turnEvents = turnEventBuilder.handleStreamEvent(streamEvent);
      for (const evt of turnEvents) applyTurnEvent(evt);
    });

    let streamResult: StreamResult;
    try {
      streamResult = await streamHandle.final;
    } catch (error) {
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
    }

    const outcome = streamResult.ok ? "complete" : "error";

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
          tracer: this.tracer,
        });
      } catch (e) {
        this.tracer?.warn("memory record failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ok: true, response, turn: agentTurn, usage };
  }
}
