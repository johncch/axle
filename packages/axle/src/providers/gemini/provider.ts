import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  ModelResult,
  ProviderClientOptions,
  ProviderGenerationParams,
  ProviderStreamParams,
} from "../types.js";
import { requireInteger } from "../utils.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { resolveGeminiProviderToolName } from "./utils.js";
export const NAME = "Gemini" as const;

export function gemini(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      retryOptions: { attempts: retryAttempts(options.maxRetries) },
      ...(options.timeoutMs !== undefined
        ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
        : {}),
    },
  });

  return {
    name: NAME,
    resolveProviderToolName(name) {
      return resolveGeminiProviderToolName(name);
    },

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: ProviderGenerationParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ client, model, ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ client, model, ...params });
    },
  };
}

function retryAttempts(maxRetries = 2): number {
  return requireInteger(maxRetries, "maxRetries", { min: 0 }) + 1;
}
