import { AnyStreamChunk } from "../../messages/stream.js";
import type { ExecutableTool } from "../../tools/types.js";
import { AIProvider, ProtocolOptions, ProviderStreamParams } from "../types.js";
import { lookupHost, requireInteger } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import type { ChatCompletionsDialect } from "./dialect.js";
import { openrouterDialect } from "./dialects/openrouter.js";
import { togetherDialect } from "./dialects/together.js";

export interface ChatCompletionsOptions extends ProtocolOptions {
  /** Inferred from the base URL's hostname when omitted. */
  dialect?: ChatCompletionsDialect;
  webSearch?: ExecutableTool;
}

const KNOWN_HOSTS: Readonly<Record<string, { id: string; dialect?: ChatCompletionsDialect }>> = {
  "openrouter.ai": { id: "openrouter", dialect: openrouterDialect },
  "api.openrouter.ai": { id: "openrouter", dialect: openrouterDialect },
  "api.together.xyz": { id: "togetherai", dialect: togetherDialect },
  "api.together.ai": { id: "togetherai", dialect: togetherDialect },
};

/**
 * A provider speaking OpenAI Chat Completions at `baseUrl`, which includes
 * the API version; requests go to `${baseUrl}/chat/completions`.
 */
export function chatCompletions(options: ChatCompletionsOptions): AIProvider {
  const { baseUrl } = options;
  const known = lookupHost(KNOWN_HOSTS, baseUrl);
  const id = options.id ?? known?.id;
  const dialect = options.dialect ?? known?.dialect;
  const maxRetries = requireInteger(options.maxRetries ?? 2, "maxRetries", { min: 0 });
  const timeoutMs =
    options.timeoutMs === undefined
      ? undefined
      : requireInteger(options.timeoutMs, "timeoutMs", { min: 1 });
  const webSearch = options.webSearch;

  return {
    protocol: "chatCompletions",
    id,
    tools: webSearch ? [webSearch] : undefined,

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        baseUrl,
        model: options.resolveModel ? options.resolveModel(model) : model,
        apiKey: options.apiKey,
        maxRetries,
        timeoutMs,
        headers: options.headers,
        fetch: options.fetch,
        dialect,
        webSearch,
        ...params,
      });
    },
  };
}
