import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  GenerationRequestParams,
  ModelResult,
  StreamingRequestParams,
} from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

export function chatCompletions(baseUrl: string, apiKey?: string): AIProvider {
  return {
    name: "ChatCompletions",

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: GenerationRequestParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ baseUrl, model, apiKey, ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: StreamingRequestParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ baseUrl, model, apiKey, ...params });
    },
  };
}
