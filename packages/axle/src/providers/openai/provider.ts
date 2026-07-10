import OpenAISDK from "openai";
import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  ModelResult,
  ProviderClientOptions,
  ProviderGenerationParams,
  ProviderStreamParams,
} from "../types.js";
import { requireInteger } from "../utils.js";
import { resolveFirstPartyModel } from "../model.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { resolveOpenAIProviderToolName } from "./utils.js";
export const NAME = "OpenAI" as const;

export function openai(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new OpenAISDK({
    apiKey,
    maxRetries: requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 }),
    ...(options.timeoutMs !== undefined
      ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
      : {}),
  });

  return {
    name: NAME,
    resolveProviderToolName(name) {
      return resolveOpenAIProviderToolName(name);
    },

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: ProviderGenerationParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ client, model: resolveFirstPartyModel(model, ["openai"]), ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ client, model: resolveFirstPartyModel(model, ["openai"]), ...params });
    },
  };
}
