import AnthropicSDK from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../messages/stream.js";
import { createStreamingRequest } from "../protocols/messages/createStreamingRequest.js";
import { resolveFirstPartyModel } from "../protocols/model.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../protocols/types.js";
import { requireInteger } from "../protocols/utils.js";

export function anthropic(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new AnthropicSDK({
    apiKey,
    maxRetries: requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 }),
    ...(options.timeoutMs !== undefined
      ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
      : {}),
    ...(options.headers !== undefined ? { defaultHeaders: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
  });

  return {
    protocol: "messages",
    id: "anthropic",

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
