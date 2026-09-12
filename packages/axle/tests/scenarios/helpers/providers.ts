import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import type {
  ContentPartCitation,
  ContentPartText,
  ContentPartThinking,
  ContentPartToolCall,
} from "../../../src/messages/message.js";
import type { AIProvider, AxleStopReason } from "../../../src/providers/types.js";
import type { Stats } from "../../../src/types.js";

/** A buffered model response, as the deleted non-streaming transport produced it. */
export interface ModelResponse {
  type: "success";
  role: "assistant";
  id: string;
  model: string;
  text: string;
  content: Array<ContentPartText | ContentPartThinking | ContentPartToolCall | ContentPartCitation>;
  finishReason: AxleStopReason;
  usage: Stats;
  raw: unknown;
}

export interface ModelError {
  type: "error";
  error: { type: string; message: string };
  usage?: Stats;
}

export type ModelResult = ModelResponse | ModelError;
import {
  completeChunk,
  startChunk,
  textChunk,
  textCompleteChunk,
  textStartChunk,
  toolCallCompleteChunk,
  toolCallStartChunk,
} from "./chunks.js";

/**
 * Renders a buffered `ModelResult` fixture as the chunk stream the streaming
 * transport would have produced for it.
 */
export function modelResultToChunks(result: ModelResult): AnyStreamChunk[] {
  if (result.type === "error") {
    return [
      {
        type: "error",
        data: {
          type: result.error.type,
          message: result.error.message,
          ...(result.usage ? { usage: result.usage } : {}),
        },
      },
    ];
  }
  const chunks: AnyStreamChunk[] = [startChunk(result.id, result.model)];
  result.content.forEach((part, index) => {
    if (part.type === "text") {
      chunks.push(textStartChunk(index), textChunk(index, part.text), textCompleteChunk(index));
    } else if (part.type === "tool-call") {
      chunks.push(
        toolCallStartChunk(index, part.id, part.name),
        toolCallCompleteChunk(index, part.id, part.name, part.parameters),
      );
    } else if (part.type === "thinking") {
      chunks.push({
        type: "thinking-start",
        data: {
          index,
          ...(part.redacted !== undefined ? { redacted: part.redacted } : {}),
          ...(part.continuity ? { continuity: part.continuity } : {}),
        },
      });
      if (part.summary) {
        chunks.push({ type: "thinking-summary-delta", data: { index, text: part.summary } });
      }
      if (part.text) chunks.push({ type: "thinking-raw-delta", data: { index, text: part.text } });
      chunks.push({ type: "thinking-complete", data: { index } });
    } else if (part.type === "citation") {
      chunks.push({ type: "citation", data: { index, citations: part.citations } });
    }
  });
  chunks.push(completeChunk(result.finishReason, result.usage));
  return chunks;
}

export function makeStreamingProvider(streamChunks: AnyStreamChunk[][]): AIProvider {
  let callIndex = 0;
  return {
    get name() {
      return "test";
    },
    createStreamingRequest: function* () {
      const chunks = streamChunks[callIndex++];
      if (!chunks) throw new Error("No stream chunks configured");
      for (const chunk of chunks) yield chunk;
    } as any,
  };
}

export function makeGenerateProvider(responses: Array<ModelResult>): AIProvider {
  return makeStreamingProvider(responses.map(modelResultToChunks));
}

/**
 * Async streaming provider that pauses after a given number of chunks,
 * allowing cancellation tests to abort mid-stream.
 */
export function makeAsyncStreamingProvider(
  streamChunks: AnyStreamChunk[][],
  pauseAfterChunk?: number,
): { provider: AIProvider; resume: () => void; gateReached: Promise<void> } {
  let resolveGate: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  let resolveGateReached: () => void;
  const gateReached = new Promise<void>((resolve) => {
    resolveGateReached = resolve;
  });

  let callIndex = 0;
  const provider: AIProvider = {
    get name() {
      return "test";
    },
    async *createStreamingRequest() {
      const chunks = streamChunks[callIndex++];
      if (!chunks) throw new Error("No stream chunks configured");
      for (let i = 0; i < chunks.length; i++) {
        if (pauseAfterChunk !== undefined && i === pauseAfterChunk) {
          resolveGateReached!();
          await gate;
        }
        yield chunks[i];
      }
    },
  };

  return { provider, resume: () => resolveGate!(), gateReached };
}
