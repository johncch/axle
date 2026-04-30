import AnthropicSDK from "@anthropic-ai/sdk";
import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  GenerationRequestParams,
  ModelResult,
  StreamingRequestParams,
} from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
export const NAME = "anthropic" as const;

export function anthropic(apiKey: string): AIProvider {
  const client = new AnthropicSDK({ apiKey });

  return {
    name: NAME,

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: GenerationRequestParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ client, model, ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: StreamingRequestParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ client, model, ...params });
    },
  };
}
