import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  ModelResult,
  ProviderGenerationParams,
  ProviderClientOptions,
  ProviderStreamParams,
} from "../types.js";
import { requireInteger } from "../utils.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

export interface ChatCompletionsOptions extends ProviderClientOptions {
  apiKey?: string;
}

export function chatCompletions(baseUrl: string, options?: ChatCompletionsOptions): AIProvider;
export function chatCompletions(baseUrl: string, apiKey?: string): AIProvider;
export function chatCompletions(
  baseUrl: string,
  apiKeyOrOptions?: string | ChatCompletionsOptions,
): AIProvider {
  const apiKey = typeof apiKeyOrOptions === "string" ? apiKeyOrOptions : apiKeyOrOptions?.apiKey;
  const maxRetries = requireInteger(
    typeof apiKeyOrOptions === "string" ? 2 : (apiKeyOrOptions?.maxRetries ?? 2),
    "maxRetries",
    { min: 0 },
  );
  const timeoutMs =
    typeof apiKeyOrOptions === "string" || apiKeyOrOptions?.timeoutMs === undefined
      ? undefined
      : requireInteger(apiKeyOrOptions.timeoutMs, "timeoutMs", { min: 1 });

  return {
    name: "ChatCompletions",

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: ProviderGenerationParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({
        baseUrl,
        model,
        apiKey,
        maxRetries,
        timeoutMs,
        ...params,
      });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        baseUrl,
        model,
        apiKey,
        maxRetries,
        timeoutMs,
        ...params,
      });
    },
  };
}
