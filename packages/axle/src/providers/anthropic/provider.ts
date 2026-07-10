import AnthropicSDK from "@anthropic-ai/sdk";
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
import { resolveAnthropicProviderToolName } from "./utils.js";
export const NAME = "anthropic" as const;

export function anthropic(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new AnthropicSDK({
    apiKey,
    maxRetries: requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 }),
    ...(options.timeoutMs !== undefined
      ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
      : {}),
  });

  return {
    name: NAME,
    resolveProviderToolName(name) {
      return resolveAnthropicProviderToolName(name);
    },

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: ProviderGenerationParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ client, model: resolveFirstPartyModel(model, ["anthropic"]), ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ client, model: resolveFirstPartyModel(model, ["anthropic"]), ...params });
    },
  };
}
