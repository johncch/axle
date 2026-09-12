import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../types.js";
import { requireInteger } from "../utils.js";
import { resolveFirstPartyModel } from "../model.js";
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
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        client,
        model: resolveFirstPartyModel(model, ["gemini", "google"]),
        ...params,
      });
    },
  };
}

function retryAttempts(maxRetries = 2): number {
  return requireInteger(maxRetries, "maxRetries", { min: 0 }) + 1;
}
