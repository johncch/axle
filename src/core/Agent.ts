import { History } from "../messages/history.js";
import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import { getTextContent, toContentParts } from "../messages/utils.js";
import type { StreamResult } from "../providers/helpers.js";
import {
  stream,
  type ErrorCallback,
  type InternalToolCallback,
  type PartEndCallback,
  type PartStartCallback,
  type PartUpdateCallback,
} from "../providers/stream.js";
import type { AIProvider } from "../providers/types.js";
import type { Tool } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import { compileInstruct } from "./compile.js";
import { Instruct } from "./Instruct.js";
import type { OutputSchema, ParsedSchema } from "./parse.js";
import { parseResponse } from "./parse.js";

export interface AgentConfig {
  provider: AIProvider;
  model: string;
  system?: string;
  tools?: Tool[];
  tracer?: TracingContext;
}

export interface AgentResult<T = string> {
  response: T | null;
  messages: AxleMessage[];
  final: AxleAssistantMessage | undefined;
  usage: Stats;
}

export interface AgentHandle<T = string> {
  cancel(): void;
  readonly final: Promise<AgentResult<T>>;
}

export class Agent {
  readonly provider: AIProvider;
  readonly model: string;
  readonly history: History;
  readonly tracer?: TracingContext;

  system: string | undefined;
  tools: Record<string, Tool> = {};

  private partStartCallback?: PartStartCallback;
  private partUpdateCallback?: PartUpdateCallback;
  private partEndCallback?: PartEndCallback;
  private internalToolCallback?: InternalToolCallback;
  private errorCallback?: ErrorCallback;

  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.history = new History();
    this.tracer = config.tracer;
    this.system = config.system;
    if (config.tools) {
      this.addTools(config.tools);
    }
  }

  addTool(tool: Tool) {
    this.tools[tool.name] = tool;
  }

  addTools(tools: Tool[]) {
    for (const tool of tools) {
      this.tools[tool.name] = tool;
    }
  }

  hasTools(): boolean {
    return Object.keys(this.tools).length > 0;
  }

  onPartStart(callback: PartStartCallback) {
    this.partStartCallback = callback;
  }

  onPartUpdate(callback: PartUpdateCallback) {
    this.partUpdateCallback = callback;
  }

  onPartEnd(callback: PartEndCallback) {
    this.partEndCallback = callback;
  }

  onInternalTool(callback: InternalToolCallback) {
    this.internalToolCallback = callback;
  }

  onError(callback: ErrorCallback) {
    this.errorCallback = callback;
  }

  send(message: string): AgentHandle<string>;
  send(instruct: Instruct<undefined>, variables?: Record<string, string>): AgentHandle<string>;
  send<TSchema extends OutputSchema>(
    instruct: Instruct<TSchema>,
    variables?: Record<string, string>,
  ): AgentHandle<ParsedSchema<TSchema>>;
  send(
    messageOrInstruct: string | Instruct<any>,
    variables?: Record<string, string>,
  ): AgentHandle<any> {
    let schema: OutputSchema | undefined;

    if (typeof messageOrInstruct === "string") {
      this.history.addUser(messageOrInstruct);
    } else {
      const text = compileInstruct(messageOrInstruct, variables);
      const files = messageOrInstruct.files;
      this.history.addUser(toContentParts({ text, files }));
      schema = messageOrInstruct.schema;
    }

    return this.execute(schema);
  }

  private execute(schema?: OutputSchema): AgentHandle<any> {
    const tools = this.tools;
    const toolDefinitions = Object.values(tools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));

    const handle = stream({
      provider: this.provider,
      model: this.model,
      messages: this.history.messages,
      system: this.system,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
      tracer: this.tracer,
      onToolCall: async (name, params) => {
        const tool = tools[name];
        if (!tool) return null;
        try {
          const result = await tool.execute(params);
          return { type: "success", content: JSON.stringify(result) };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { type: "error", error: { type: "execution", message: msg } };
        }
      },
    });

    if (this.partStartCallback) handle.onPartStart(this.partStartCallback);
    if (this.partUpdateCallback) handle.onPartUpdate(this.partUpdateCallback);
    if (this.partEndCallback) handle.onPartEnd(this.partEndCallback);
    if (this.internalToolCallback) handle.onInternalTool(this.internalToolCallback);
    if (this.errorCallback) handle.onError(this.errorCallback);

    const finalPromise = handle.final.then((streamResult: StreamResult): AgentResult<any> => {
      if (streamResult.messages.length > 0) {
        this.history.add(streamResult.messages);
      }

      let response: any | null = null;
      let final: AxleAssistantMessage | undefined;

      if (streamResult.result === "success") {
        final = streamResult.final;
        if (final) {
          const textContent = getTextContent(final.content);
          response = parseResponse(textContent, schema);
        }
      } else if (streamResult.result === "cancelled") {
        final = streamResult.partial;
      }

      const usage = streamResult.usage ?? { in: 0, out: 0 };
      return { response, messages: streamResult.messages, final, usage };
    });

    return {
      cancel: () => handle.cancel(),
      get final() {
        return finalPromise;
      },
    };
  }
}
