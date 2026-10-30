import OpenAISDK from "openai";
import { AnyStreamChunk } from "../messages/stream.js";
import { resolveFirstPartyModel } from "../protocols/model.js";
import { createStreamingRequest } from "../protocols/responses/createStreamingRequest.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../protocols/types.js";
import { requireInteger } from "../protocols/utils.js";
export function openai(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  const client = new OpenAISDK({
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
    protocol: "responses",
    id: "openai",

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        client,
        model: resolveFirstPartyModel(model, ["openai"]),
        ...params,
      });
    },
  };
}
