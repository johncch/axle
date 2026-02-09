import AnthropicSDK from "@anthropic-ai/sdk";
import type { TracingContext } from "../../tracer/types.js";

import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
export const NAME = "anthropic" as const;

export function anthropic(apiKey: string): AIProvider {
  const client = new AnthropicSDK({ apiKey });

  return {
    name: NAME,

    /** @internal */
    async createGenerationRequest(model: string, params: {
      messages: Array<AxleMessage>;
      system?: string;
      tools?: Array<ToolDefinition>;
      context: { tracer?: TracingContext };
      options?: {
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
        stop?: string | string[];
        [key: string]: any;
      };
    }): Promise<ModelResult> {
      return await createGenerationRequest({ client, model, ...params });
    },

    /** @internal */
    createStreamingRequest(model: string, params: {
      messages: Array<AxleMessage>;
      system?: string;
      tools?: Array<ToolDefinition>;
      context: { tracer?: TracingContext };
      signal?: AbortSignal;
      options?: {
        temperature?: number;
        top_p?: number;
        max_tokens?: number;
        frequency_penalty?: number;
        presence_penalty?: number;
        stop?: string | string[];
        [key: string]: any;
      };
    }): AsyncGenerator<AnyStreamChunk, void, unknown> {
      const { messages, system, tools, context, signal, options } = params;
      return createStreamingRequest({
        client,
        model,
        messages,
        system,
        tools,
        runtime: context,
        signal,
        options,
      });
    },
  };
}
