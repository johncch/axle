import { AnyStreamChunk } from "../messages/stream.js";
import { createStreamingRequest } from "../protocols/chatCompletions/createStreamingRequest.js";
import type { ChatCompletionsVendor } from "../protocols/chatCompletions/utils.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../protocols/types.js";
import { requireInteger } from "../protocols/utils.js";
import type { ExecutableTool } from "../tools/types.js";

export interface ChatCompletionsOptions extends Omit<ProviderClientOptions, "baseUrl"> {
  apiKey?: string;
  vendor?: ChatCompletionsVendor;
  webSearch?: ExecutableTool;
}

export type { ChatCompletionsVendor } from "../protocols/chatCompletions/utils.js";

const CHAT_COMPLETIONS_VENDOR_HOSTS: Partial<Record<string, ChatCompletionsVendor>> = {
  "api.openrouter.ai": "openrouter",
  "api.together.ai": "togetherai",
  "api.together.xyz": "togetherai",
  "openrouter.ai": "openrouter",
};

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
  const vendor = clientOptions?.vendor ?? inferChatCompletionsVendor(baseUrl);
  const webSearch = clientOptions?.webSearch;

  return {
    protocol: "chatCompletions",
    id: vendor,
    tools: webSearch ? [webSearch] : undefined,

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
        headers: clientOptions?.headers,
        fetch: clientOptions?.fetch,
        vendor,
        webSearch,
        ...params,
      });
    },
  };
}

export function inferChatCompletionsVendor(baseUrl: string): ChatCompletionsVendor | undefined {
  try {
    return CHAT_COMPLETIONS_VENDOR_HOSTS[new URL(baseUrl).hostname.toLowerCase()];
  } catch {
    return undefined;
  }
}
