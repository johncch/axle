import OpenAISDK from "openai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { AIProvider, ProtocolOptions, ProviderStreamParams } from "../types.js";
import { lookupHost, requireInteger } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

const KNOWN_HOSTS: Readonly<Record<string, { id: string }>> = {
  "api.openai.com": { id: "openai" },
};

/**
 * A provider speaking the OpenAI Responses protocol at `baseUrl`, which
 * includes the API version; the SDK appends `/responses`.
 */
export function responses(options: ProtocolOptions): AIProvider {
  const { baseUrl } = options;
  const known = lookupHost(KNOWN_HOSTS, baseUrl);
  const client = new OpenAISDK({
    apiKey: options.apiKey,
    baseURL: baseUrl,
    maxRetries: requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 }),
    ...(options.timeoutMs !== undefined
      ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
      : {}),
    ...(options.headers !== undefined ? { defaultHeaders: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  });

  return {
    protocol: "responses",
    id: options.id ?? known?.id,

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        client,
        model: options.resolveModel ? options.resolveModel(model) : model,
        ...params,
      });
    },
  };
}
