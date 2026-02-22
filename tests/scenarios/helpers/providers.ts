import type { AnyStreamChunk } from "../../../src/messages/stream.js";
import type { AIProvider, ModelResult } from "../../../src/providers/types.js";

export function makeStreamingProvider(streamChunks: AnyStreamChunk[][]): AIProvider {
  let callIndex = 0;
  return {
    get name() {
      return "test";
    },
    async createGenerationRequest() {
      throw new Error("Not implemented");
    },
    createStreamingRequest: function* () {
      const chunks = streamChunks[callIndex++];
      if (!chunks) throw new Error("No stream chunks configured");
      for (const chunk of chunks) yield chunk;
    } as any,
  };
}

export function makeGenerateProvider(responses: Array<ModelResult>): AIProvider {
  let callIndex = 0;
  return {
    get name() {
      return "test";
    },
    async createGenerationRequest(): Promise<ModelResult> {
      return responses[callIndex++];
    },
  };
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
    async createGenerationRequest() {
      throw new Error("Not implemented");
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
