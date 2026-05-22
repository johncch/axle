import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import {
  AIProvider,
  ProviderGenerationParams,
  ModelResult,
  ProviderStreamParams,
} from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
export const NAME = "Gemini" as const;

export function gemini(apiKey: string): AIProvider {
  const client = new GoogleGenAI({ apiKey });

  return {
    name: NAME,

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: ProviderGenerationParams,
    ): Promise<ModelResult> {
      return await createGenerationRequest({ client, model, ...params });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({ client, model, ...params });
    },
  };
}
