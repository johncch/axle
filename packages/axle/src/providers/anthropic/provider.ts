import AnthropicSDK from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/stream.js";
import { resolveFirstPartyModel } from "../model.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../types.js";
import { requireInteger } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
export const NAME = "anthropic" as const;

export function anthropic(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new AnthropicSDK({
    apiKey,
    maxRetries: requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 }),
    ...(options.timeoutMs !== undefined
      ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
      : {}),
    ...(options.headers !== undefined ? { defaultHeaders: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });

  return {
    name: NAME,

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        client,
        model: resolveFirstPartyModel(model, ["anthropic"]),
        ...params,
      });
    },
  };
}
