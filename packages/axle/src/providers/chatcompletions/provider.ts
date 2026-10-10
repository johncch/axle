import { AnyStreamChunk } from "../../messages/stream.js";
import { createWebSearchTool, type WebSearchBackend } from "../../tools/webSearch.js";
import { AIProvider, ProviderClientOptions, ProviderStreamParams } from "../types.js";
import { requireInteger } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import type { ChatCompletionsVendor } from "./utils.js";

export interface ChatCompletionsOptions extends ProviderClientOptions {
  apiKey?: string;
  vendor?: ChatCompletionsVendor;
  webSearch?: WebSearchBackend;
}

export type { ChatCompletionsVendor } from "./utils.js";

const CHAT_COMPLETIONS_VENDOR_HOSTS: Partial<Record<string, ChatCompletionsVendor>> = {
  "api.openrouter.ai": "openrouter",
  "api.together.ai": "together",
  "api.together.xyz": "together",
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
  const webSearchTool = clientOptions?.webSearch
    ? createWebSearchTool(clientOptions.webSearch)
    : undefined;

  return {
    name: "ChatCompletions",
    tools: webSearchTool ? [webSearchTool] : undefined,

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
        vendor,
        webSearchTool,
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
