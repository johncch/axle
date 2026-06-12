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
import {
  resolveChatCompletionsProviderToolName,
  type ChatCompletionsProviderDialect,
} from "./utils.js";

export interface ChatCompletionsOptions extends ProviderClientOptions {
  apiKey?: string;
  providerDialect?: ChatCompletionsProviderDialect;
  providerToolVendor?: "openrouter";
}

export function chatCompletions(baseUrl: string, options?: ChatCompletionsOptions): AIProvider;
export function chatCompletions(baseUrl: string, apiKey?: string): AIProvider;
export function chatCompletions(
  baseUrl: string,
  apiKey: string,
  options?: Omit<ChatCompletionsOptions, "apiKey">,
): AIProvider;
export function chatCompletions(
  baseUrl: string,
  apiKeyOrOptions?: string | ChatCompletionsOptions,
  options?: Omit<ChatCompletionsOptions, "apiKey">,
): AIProvider {
  const apiKey = typeof apiKeyOrOptions === "string" ? apiKeyOrOptions : apiKeyOrOptions?.apiKey;
  const clientOptions = typeof apiKeyOrOptions === "string" ? options : apiKeyOrOptions;
  const maxRetries = requireInteger(clientOptions?.maxRetries ?? 2, "maxRetries", { min: 0 });
  const timeoutMs =
    clientOptions?.timeoutMs === undefined
      ? undefined
      : requireInteger(clientOptions.timeoutMs, "timeoutMs", { min: 1 });
  const providerToolVendor = clientOptions?.providerToolVendor;
  const providerDialect = clientOptions?.providerDialect;

  return {
    name: "ChatCompletions",
    resolveProviderToolName(name) {
      return resolveChatCompletionsProviderToolName(name, providerToolVendor);
    },

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
        providerDialect,
        providerToolVendor,
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
        providerDialect,
        providerToolVendor,
        ...params,
      });
    },
  };
}
