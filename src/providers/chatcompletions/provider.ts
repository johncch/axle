import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

export function chatCompletions(baseUrl: string, apiKey?: string): AIProvider {
  return {
    name: "ChatCompletions",

    /** @internal */
    async createGenerationRequest(
      model: string,
      params: {
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
      },
    ): Promise<ModelResult> {
      return await createGenerationRequest({
        baseUrl,
        model,
        apiKey,
        ...params,
      });
    },

    /** @internal */
    createStreamingRequest(
      model: string,
      params: {
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
      },
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        baseUrl,
        model,
        apiKey,
        ...params,
      });
    },
  };
}
