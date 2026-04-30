import { AxleMessage } from "../../messages/message.js";
import { AnyStreamChunk } from "../../messages/stream.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import type { FileResolver } from "../../utils/file.js";
import { AIProvider, ModelResult } from "../types.js";
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
      params: {
        messages: Array<AxleMessage>;
        system?: string;
        tools?: Array<ToolDefinition>;
        context: { tracer?: TracingContext; fileResolver?: FileResolver };
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
        providerOptions,
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
        context: { tracer?: TracingContext; fileResolver?: FileResolver };
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
        providerOptions,
        ...params,
      });
    },
  };
}
