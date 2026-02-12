import { History } from "../messages/history.js";
import type { AxleAssistantMessage, AxleMessage } from "../messages/types.js";
import { getTextContent, toContentParts } from "../messages/utils.js";
import type { StreamResult } from "../providers/helpers.js";
import { stream, type StreamHandle } from "../providers/stream.js";
import type { AIProvider } from "../providers/types.js";
import type { Stats } from "../types.js";
import { compileInstruct } from "./compile.js";
import { Instruct } from "./Instruct.js";
import { parseResponse } from "./parse.js";

export interface AgentConfig {
  provider: AIProvider;
  model: string;
}

export interface AgentResult {
  response: any;
  messages: AxleMessage[];
  final: AxleAssistantMessage | undefined;
  usage: Stats;
}

export interface AgentHandle {
  onPartStart: StreamHandle["onPartStart"];
  onPartUpdate: StreamHandle["onPartUpdate"];
  onPartEnd: StreamHandle["onPartEnd"];
  onInternalTool: StreamHandle["onInternalTool"];
  onError: StreamHandle["onError"];
  cancel: StreamHandle["cancel"];
  readonly final: Promise<AgentResult>;
}

export class Agent {
  readonly instruct: Instruct;
  readonly provider: AIProvider;
  readonly model: string;
  readonly history: History;

  constructor(instruct: Instruct, config: AgentConfig) {
    this.instruct = instruct;
    this.provider = config.provider;
    this.model = config.model;
    this.history = new History();
  }

  start(variables?: Record<string, string>): AgentHandle {
    const text = compileInstruct(this.instruct, variables);
    const files = this.instruct.files;

    this.history.addUser(toContentParts({ text, files }));

    return this.execute();
  }

  send(message: string): AgentHandle {
    this.history.addUser(message);

    return this.execute();
  }

  private execute(): AgentHandle {
    const tools = this.instruct.tools;
    const toolDefinitions = Object.values(tools).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
    }));

    const handle = stream({
      provider: this.provider,
      model: this.model,
      messages: this.history.messages,
      system: this.instruct.system ?? undefined,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
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

    const finalPromise = handle.final.then((streamResult: StreamResult): AgentResult => {
      if (streamResult.messages.length > 0) {
        this.history.add(streamResult.messages);
      }

      let response: any = null;
      let final: AxleAssistantMessage | undefined;

      if (streamResult.result === "success") {
        final = streamResult.final;
        if (final) {
          const textContent = getTextContent(final.content);
          if (this.instruct.schema) {
            response = parseResponse(textContent, this.instruct.schema);
          } else {
            response = textContent;
          }
        }
      } else if (streamResult.result === "cancelled") {
        final = streamResult.partial;
      }

      const usage = streamResult.usage ?? { in: 0, out: 0 };

      return { response, messages: streamResult.messages, final, usage };
    });

    return {
      onPartStart: (cb) => handle.onPartStart(cb),
      onPartUpdate: (cb) => handle.onPartUpdate(cb),
      onPartEnd: (cb) => handle.onPartEnd(cb),
      onInternalTool: (cb) => handle.onInternalTool(cb),
      onError: (cb) => handle.onError(cb),
      cancel: () => handle.cancel(),
      get final() {
        return finalPromise;
      },
    } satisfies AgentHandle;
  }
}
