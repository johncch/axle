import { AxleError } from "../errors/AxleError.js";
import type { MCP } from "../mcp/index.js";
import type { AgentMemory } from "../memory/types.js";
import type { AxleUserMessage } from "../messages/message.js";
import { getTextContent, toContentParts } from "../messages/utils.js";
import type { GenerateError, StreamResult } from "../providers/helpers.js";
import { stream } from "../providers/stream.js";
import type { AIProvider } from "../providers/types.js";
import { LocalFileStore } from "../store/LocalFileStore.js";
import type { FileStore } from "../store/types.js";
import { ToolRegistry } from "../tools/registry.js";
import type { ExecutableTool, ProviderTool } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import { TurnBuilder } from "../turns/builder.js";
import type { AgentEvent } from "../turns/events.js";
import type { Turn } from "../turns/types.js";
import type { Stats } from "../types.js";
import type { FileResolver } from "../utils/file.js";
import { createHandle, type Handle } from "../utils/utils.js";
import { History } from "./history.js";
import { Instruct } from "./Instruct.js";
import type { OutputSchema, ParsedSchema } from "./parse.js";
import { parseResponse } from "./parse.js";

export interface AgentConfig {
  provider: AIProvider;
  model: string;
  system?: string;
  name?: string;
  scope?: Record<string, string>;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
  mcps?: MCP[];
  memory?: AgentMemory;
  tracer?: TracingContext;
  fileResolver?: FileResolver;
  reasoning?: boolean;
}

export interface AgentResult<T = string> {
  response: T | null;
  turn: Turn | undefined;
  usage: Stats;
}

export type AgentHandle<T = string> = Handle<AgentResult<T>>;

export type AgentEventCallback = (event: AgentEvent) => void;
export interface SendMessageOptions {
  signal?: AbortSignal;
  fileResolver?: FileResolver;
  reasoning?: boolean;
}

export class Agent {
  readonly provider: AIProvider;
  readonly model: string;
  readonly history: History;
  readonly tracer?: TracingContext;
  readonly name?: string;
  readonly scope?: Record<string, string>;
  readonly store: FileStore;
  readonly fileResolver?: FileResolver;
  readonly reasoning?: boolean;
  readonly registry: ToolRegistry;

  system: string | undefined;

  private mcps: MCP[] = [];
  private resolvedMcps = new WeakSet<MCP>();
  private memory?: AgentMemory;

  private eventCallbacks: AgentEventCallback[] = [];
  private sendQueue: Promise<void> = Promise.resolve();

  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.history = new History();
    this.tracer = config.tracer;
    this.system = config.system;
    this.name = config.name;
    this.scope = config.scope;
    this.store = new LocalFileStore(".axle");
    this.fileResolver = config.fileResolver;
    this.reasoning = config.reasoning;
    this.registry = new ToolRegistry({
      tools: config.tools,
      providerTools: config.providerTools,
    });
    if (config.mcps) {
      this.mcps = [...config.mcps];
    }
    if (config.memory) {
      if (!config.name) {
        throw new AxleError(
          "Agent requires a 'name' when memory is provided. The name is used to partition memory storage.",
        );
      }
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

  on(callback: AgentEventCallback) {
    this.eventCallbacks.push(callback);
  }

  send(message: string | Instruct<undefined>, options?: SendMessageOptions): AgentHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    options?: SendMessageOptions,
  ): AgentHandle<ParsedSchema<TSchema>>;
  send(messageOrInstruct: string | Instruct<any>, options?: SendMessageOptions): AgentHandle<any> {
    let schema: OutputSchema | undefined;
    let userMessage: AxleUserMessage;

    if (typeof messageOrInstruct === "string") {
      userMessage = {
        role: "user",
        id: crypto.randomUUID(),
        content: [{ type: "text", text: messageOrInstruct }],
      };
    } else {
      const text = messageOrInstruct.render();
      const files = messageOrInstruct.files;
      userMessage = {
        role: "user",
        id: crypto.randomUUID(),
        content: toContentParts({ text, files }),
      };
      schema = messageOrInstruct.schema;
    }

    const effectiveReasoning = options?.reasoning ?? this.reasoning;

    const { handle, settled } = createHandle(
      this.sendQueue,
      (signal) => this.run(userMessage, schema, signal, options?.fileResolver, effectiveReasoning),
      options?.signal,
    );
    this.sendQueue = settled;
    return handle;
  }

  private async resolveMcpTools(): Promise<void> {
    for (const mcp of this.mcps) {
      if (this.resolvedMcps.has(mcp)) continue;
      const tools = await mcp.listTools({ prefix: mcp.name, tracer: this.tracer });
      this.registry.add(tools);
      this.resolvedMcps.add(mcp);
    }
  }

  private emitEvent(event: AgentEvent): void {
    for (const cb of this.eventCallbacks) cb(event);
  }

  private async run(
    userMessage: AxleUserMessage,
    schema: OutputSchema | undefined,
    signal: AbortSignal,
    sendFileResolver?: FileResolver,
    reasoning?: boolean,
  ): Promise<AgentResult<any>> {
    const builder = new TurnBuilder();

    await this.resolveMcpTools();

    let effectiveSystem = this.system;
    const requestMessages = [...this.history.log, userMessage];
    if (this.memory) {
      const recallResult = await this.memory.recall({
        name: this.name,
        scope: this.scope,
        system: this.system,
        messages: requestMessages,
        store: this.store,
        tracer: this.tracer,
      });
      if (recallResult.systemSuffix) {
        effectiveSystem = (effectiveSystem ?? "") + "\n\n" + recallResult.systemSuffix;
      }
    }

    if (signal.aborted) {
      return { response: null, turn: undefined, usage: { in: 0, out: 0 } };
    }

    const { turn: userTurn, events: userEvents } = builder.createUserTurn(userMessage);
    this.history.addTurn(userTurn);
    this.history.appendToLog(userMessage);
    for (const evt of userEvents) {
      this.emitEvent(evt);
    }

    // Start agent turn
    const { turn: agentTurn, events: startEvents } = builder.startAgentTurn();
    this.history.addTurn(agentTurn);
    for (const evt of startEvents) this.emitEvent(evt);

    const streamHandle = stream({
      provider: this.provider,
      model: this.model,
      messages: requestMessages,
      system: effectiveSystem,
      registry: this.registry,
      tracer: this.tracer,
      fileResolver: sendFileResolver ?? this.fileResolver,
      reasoning,
      onToolCall: async (name, params, ctx) => {
        const tool = this.registry.get(name);
        if (!tool) return null;
        try {
          const result = await tool.execute(params, ctx);
          return { type: "success", content: result };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { type: "error", error: { type: "execution", message: msg } };
        }
      },
      signal,
    });

    // Translate StreamEvents → AgentEvents
    streamHandle.on((streamEvent) => {
      const agentEvents = builder.handleStreamEvent(streamEvent);
      for (const evt of agentEvents) this.emitEvent(evt);
    });

    const streamResult: StreamResult = await streamHandle.final;

    // Determine outcome and finalize
    const outcome =
      streamResult.result === "cancelled"
        ? "cancelled"
        : streamResult.result === "error"
          ? "error"
          : "complete";

    if (streamResult.messages.length > 0) {
      this.history.appendToLog(streamResult.messages);
    }

    const finalizeEvents = builder.finalizeTurn(outcome);
    for (const evt of finalizeEvents) this.emitEvent(evt);

    if (streamResult.result === "error") {
      throw new AxleError(formatGenerateError(streamResult.error), {
        code: streamResult.error.type === "model" ? "MODEL_ERROR" : "TOOL_ERROR",
        details: { error: streamResult.error },
      });
    }

    let response: any | null = null;
    if (streamResult.result === "success") {
      if (streamResult.final) {
        const textContent = getTextContent(streamResult.final.content);
        response = parseResponse(textContent, schema);
      }

      if (this.memory) {
        try {
          await this.memory.record({
            name: this.name,
            scope: this.scope,
            system: this.system,
            messages: this.history.log,
            newMessages: streamResult.messages,
            store: this.store,
            tracer: this.tracer,
          });
        } catch (e) {
          this.tracer?.warn("memory record failed", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const usage = streamResult.usage ?? { in: 0, out: 0 };
    return { response, turn: agentTurn, usage };
  }
}

function formatGenerateError(error: GenerateError): string {
  if (error.type === "model") {
    return `Model error: ${error.error.error.message}`;
  }
  return `Tool error (${error.error.name}): ${error.error.message}`;
}
