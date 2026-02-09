import OpenAISDK from "openai";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import type { TracingContext } from "../../tracer/types.js";
import { AIProvider, ModelResult } from "../types.js";
import { createGenerationRequest } from "./createGenerationRequest.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { DEFAULT_MODEL as _DEFAULT_MODEL, Models as _Models } from "./models.js";

export const NAME = "OpenAI" as const;

export function openai(apiKey: string): AIProvider {
  const client = new OpenAISDK({ apiKey });

  return {
    name: NAME,

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
        client,
        model,
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

export namespace openai {
  export const MODELS = _Models;
  export const DEFAULT_MODEL = _DEFAULT_MODEL;
}
