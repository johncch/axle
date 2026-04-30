import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  GenerationRequestParams,
  ModelResult,
  StreamingRequestParams,
} from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import type { ChatCompletionsProviderOptions } from "./types.js";

export function chatCompletions(
  baseUrl: string,
  apiKey?: string,
  providerOptions: ChatCompletionsProviderOptions = {},
): AIProvider {
  return {
    name: "ChatCompletions",

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: GenerationRequestParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({
        baseUrl,
        model,
        apiKey,
        providerOptions,
        ...params,
      });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: StreamingRequestParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        baseUrl,
        model,
        apiKey,
        providerOptions,
        ...params,
      });
    },
  };
}
