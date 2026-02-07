import type {
  AxleAssistantMessage,
  AxleMessage,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../messages/types.js";
import type { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import type { GenerateTurnOptions } from "./generateTurn.js";
import {
  appendUsage,
  executeToolCalls,
  type GenerateResult,
  type ToolCallCallback,
  type ToolCallResult,
} from "./helpers.js";
import { streamTurn } from "./streamTurn.js";
import type { AIProvider } from "./types.js";
import { AxleStopReason } from "./types.js";

// --- Public types ---

export type StreamPartType = "thinking" | "text" | "tool-call" | "tool-result";

export interface ToolCallInfo {
  name: string;
  parameters: Record<string, unknown>;
}

export type StreamPartDataMap = {
  text: string;
  thinking: string;
  "tool-call": ToolCallInfo;
  "tool-result": string;
};

export type PartUpdateCallback = <T extends StreamPartType>(
  index: number,
  type: T,
  delta: StreamPartDataMap[T],
  accumulated: StreamPartDataMap[T],
) => void;

export type PartEndCallback = <T extends StreamPartType>(
  index: number,
  type: T,
  final: StreamPartDataMap[T],
) => void;

export interface StreamOptions {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  tracer?: TracingContext;
  options?: GenerateTurnOptions;
}

export interface StreamHandle {
  onPartUpdate(callback: PartUpdateCallback): void;
  onPartEnd(callback: PartEndCallback): void;
  readonly final: Promise<GenerateResult>;
}

// --- Implementation ---

export function stream(options: StreamOptions): StreamHandle {
  const partUpdateCallbacks: PartUpdateCallback[] = [];
  const partEndCallbacks: PartEndCallback[] = [];

  let resolveResult: (r: GenerateResult) => void;
  let rejectResult: (e: unknown) => void;
  const finalPromise = new Promise<GenerateResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // Kick off processing on next microtask so callers can register callbacks first
  Promise.resolve().then(() =>
    run(options, partUpdateCallbacks, partEndCallbacks).then(resolveResult!, rejectResult!),
  );

  return {
    onPartUpdate(cb) {
      partUpdateCallbacks.push(cb);
    },
    onPartEnd(cb) {
      partEndCallbacks.push(cb);
    },
    get final() {
      return finalPromise;
    },
  };
}

// --- Core loop ---

function emitPartUpdate<T extends StreamPartType>(
  callbacks: PartUpdateCallback[],
  index: number,
  type: T,
  delta: StreamPartDataMap[T],
  accumulated: StreamPartDataMap[T],
) {
  for (const cb of callbacks) cb(index, type, delta, accumulated);
}

function emitPartEnd<T extends StreamPartType>(
  callbacks: PartEndCallback[],
  index: number,
  type: T,
  final: StreamPartDataMap[T],
) {
  for (const cb of callbacks) cb(index, type, final);
}

async function run(
  options: StreamOptions,
  updateCbs: PartUpdateCallback[],
  partEndCbs: PartEndCallback[],
): Promise<GenerateResult> {
  const {
    provider,
    messages,
    system,
    tools,
    onToolCall,
    maxIterations,
    tracer,
    options: genOptions,
  } = options;
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = { in: 0, out: 0 };
  let globalIndex = 0;
  let iterations = 0;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  while (true) {
    if (maxIterations !== undefined && iterations >= maxIterations) {
      return {
        result: "error",
        messages: newMessages,
        error: {
          type: "model",
          error: {
            type: "error",
            error: {
              type: "MaxIterations",
              message: `Exceeded max iterations (${maxIterations})`,
            },
          },
        },
        usage,
      };
    }

    iterations += 1;

    const streamResult = streamTurn({
      provider,
      messages: workingMessages,
      system,
      tools,
      tracer,
      options: genOptions,
    });

    if (!streamResult) {
      throw new Error("Provider does not support streaming. Use generate() instead.");
    }

    const turnParts: Array<ContentPartText | ContentPartThinking | ContentPartToolCall> = [];
    let turnId = "";
    let turnModel = "";
    let turnFinishReason: AxleStopReason = AxleStopReason.Stop;

    // Track the current "open" part for accumulation
    let openPartIndex = -1;
    let openPartType: StreamPartType | null = null;
    let openAccumulated: string = "";

    const closePart = () => {
      if (openPartType !== null && openPartIndex >= 0) {
        emitPartEnd(
          partEndCbs,
          openPartIndex,
          openPartType as "text" | "thinking",
          openAccumulated,
        );
        openPartType = null;
        openAccumulated = "";
        openPartIndex = -1;
      }
    };

    for await (const chunk of streamResult) {
      switch (chunk.type) {
        case "start":
          turnId = chunk.id;
          turnModel = chunk.data.model;
          break;

        case "text": {
          const isNew = chunk.data.index >= turnParts.length;
          if (isNew) {
            closePart();
            turnParts.push({ type: "text", text: chunk.data.text });
            openPartIndex = globalIndex++;
            openPartType = "text";
            openAccumulated = chunk.data.text;
          } else {
            const part = turnParts[chunk.data.index] as ContentPartText;
            part.text += chunk.data.text;
            openAccumulated = part.text;
          }
          emitPartUpdate(updateCbs, openPartIndex, "text", chunk.data.text, openAccumulated);
          break;
        }

        case "thinking-start": {
          closePart();
          turnParts.push({ type: "thinking", text: "" });
          openPartIndex = globalIndex++;
          openPartType = "thinking";
          openAccumulated = "";
          break;
        }

        case "thinking-delta": {
          const part = turnParts[chunk.data.index] as ContentPartThinking;
          part.text += chunk.data.text;
          openAccumulated = part.text;
          emitPartUpdate(updateCbs, openPartIndex, "thinking", chunk.data.text, openAccumulated);
          break;
        }

        case "tool-call-start": {
          closePart();
          turnParts.push({
            type: "tool-call",
            id: chunk.data.id,
            name: chunk.data.name,
            parameters: {},
          });
          openPartIndex = globalIndex++;
          openPartType = "tool-call";
          break;
        }

        case "tool-call-complete": {
          const part = turnParts[chunk.data.index] as ContentPartToolCall;
          part.parameters = chunk.data.arguments;
          const toolCallFinal: ToolCallInfo = { name: part.name, parameters: part.parameters };
          emitPartUpdate(updateCbs, openPartIndex, "tool-call", toolCallFinal, toolCallFinal);
          emitPartEnd(partEndCbs, openPartIndex, "tool-call", toolCallFinal);
          openPartType = null;
          openPartIndex = -1;
          break;
        }

        case "complete": {
          closePart();
          turnFinishReason = chunk.data.finishReason;
          break;
        }

        case "error": {
          closePart();
          const errorUsage = chunk.data.usage ?? { in: 0, out: 0 };
          usage.in += errorUsage.in ?? 0;
          usage.out += errorUsage.out ?? 0;
          return {
            result: "error",
            messages: newMessages,
            error: {
              type: "model",
              error: {
                type: "error",
                error: { type: chunk.data.type, message: chunk.data.message },
              },
            },
            usage,
          };
        }
      }
    }

    const modelResult = await streamResult.final;
    appendUsage(usage, modelResult);

    // Build and add assistant message
    const assistantMessage: AxleAssistantMessage = {
      role: "assistant",
      id: turnId,
      model: turnModel,
      content: turnParts,
      finishReason: turnFinishReason,
    };
    addMessage(assistantMessage);

    // If not a function call, we're done
    if (turnFinishReason !== AxleStopReason.FunctionCall) {
      return {
        result: "success",
        messages: newMessages,
        final: assistantMessage,
        usage,
      };
    }

    // Extract tool calls from the turn's parts
    const toolCalls = turnParts.filter((p): p is ContentPartToolCall => p.type === "tool-call");
    if (toolCalls.length === 0) {
      return {
        result: "success",
        messages: newMessages,
        final: assistantMessage,
        usage,
      };
    }

    // Execute tool calls
    const wrappedToolCall = onToolCall
      ? async (name: string, parameters: Record<string, unknown>) => {
          return onToolCall(name, parameters);
        }
      : async () => null as ToolCallResult | null;

    const { results, missingTool } = await executeToolCalls(toolCalls, wrappedToolCall);

    // Emit tool-result events
    for (const r of results) {
      const idx = globalIndex++;
      emitPartUpdate(updateCbs, idx, "tool-result", r.content, r.content);
      emitPartEnd(partEndCbs, idx, "tool-result", r.content);
    }

    if (results.length > 0) {
      addMessage({ role: "tool", content: results });
    }

    if (missingTool) {
      return {
        result: "error",
        messages: newMessages,
        error: { type: "tool", error: missingTool },
        usage,
      };
    }
  }
}
