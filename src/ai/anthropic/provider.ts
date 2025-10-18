import Anthropic from "@anthropic-ai/sdk";
import { Recorder } from "../../recorder/recorder.js";

import { Chat } from "../../messages/chat.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDef } from "../../tools/types.js";
import { AIProvider, AIRequest, AIResponse, AxleStopReason } from "../types.js";
import { Models, MULTIMODAL_MODELS } from "./models.js";
import {
  convertStopReason,
  convertToAxleContentParts,
  convertToAxleToolCalls,
  convertToProviderMessages,
  convertToProviderTools,
  prepareRequest,
} from "./utils.js";

const DEFAULT_MODEL = Models.CLAUDE_SONNET_4_LATEST;

export class AnthropicProvider implements AIProvider {
  name = "Anthropic";
  client: Anthropic;
  model: string;

  constructor(apiKey: string, model?: string) {
    this.model = model ?? DEFAULT_MODEL;
    this.client = new Anthropic({
      apiKey: apiKey,
    });
  }

  createChatRequest(chat: Chat, context: { recorder?: Recorder } = {}): AIRequest {
    const { recorder } = context;
    if (chat.hasFiles() && !MULTIMODAL_MODELS.includes(this.model as any)) {
      recorder?.warn?.log(
        `Model ${this.model} may not support multimodal content. Use one of: ${MULTIMODAL_MODELS.join(", ")}`,
      );
    }
    return new AnthropicChatRequest(this, chat);
  }

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDef>;
    context: { recorder?: Recorder };
  }): Promise<AIResponse> {
    return await createGenerationRequest({ client: this.client, model: this.model, ...params });
  }

  // createStreamingRequest(params: {
  //   messages: Array<AxleMessage>;
  //   tools?: Array<ToolDef>;
  //   context: { recorder?: Recorder };
  // }): AsyncGenerator<AnyStreamChunk, void, unknown> {
  //   const { messages, tools, context } = params;
  //   return createStreamingRequest({
  //     client: this.client,
  //     model: this.model,
  //     messages,
  //     tools,
  //     runtime: context,
  //   });
  // }
}

async function createGenerationRequest(params: {
  client: Anthropic;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDef>;
  context?: { recorder?: Recorder };
}): Promise<AIResponse> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;
  const request = {
    model: model,
    max_tokens: 4096,
    messages: convertToProviderMessages(messages),
    ...(tools && { tools: convertToProviderTools(tools) }),
  };
  recorder?.debug?.log(request);

  let result: AIResponse;
  try {
    const completion = await client.messages.create(request);
    result = convertToAIResponse(completion);
  } catch (e) {
    result = {
      type: "error",
      error: {
        type: e.error.error.type ?? "Undetermined",
        message: e.error.error.message ?? "Unexpected error from Anthropic",
      },
      usage: { in: 0, out: 0 },
      raw: e,
    };
  }

  recorder?.debug?.log(result);
  return result;
}

class AnthropicChatRequest implements AIRequest {
  constructor(
    private provider: AnthropicProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<any> {
    const { recorder } = runtime;
    const { client, model } = this.provider;
    const request = {
      model: model,
      max_tokens: 4096,
      ...prepareRequest(this.chat),
    };
    recorder?.debug?.log(request);

    let result: AIResponse;
    try {
      const completion = await client.messages.create(request);
      result = convertToAIResponse(completion);
    } catch (e) {
      result = {
        type: "error",
        error: {
          type: e.error.error.type ?? "Undetermined",
          message: e.error.error.message ?? "Unexpected error from Anthropic",
        },
        usage: { in: 0, out: 0 },
        raw: e,
      };
    }

    recorder?.debug?.log(result);
    return result;
  }
}

function convertToAIResponse(completion: Anthropic.Messages.Message): AIResponse {
  const stopReason = convertStopReason(completion.stop_reason);
  if (stopReason === AxleStopReason.Error) {
    return {
      type: "error",
      error: {
        type: "Uncaught error",
        message: `Stop reason is not recognized or unhandled: ${completion.stop_reason}`,
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (stopReason === AxleStopReason.FunctionCall) {
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      reason: AxleStopReason.FunctionCall,
      message: {
        id: completion.id,
        role: completion.role,
        content: convertToAxleContentParts(completion.content),
        toolCalls: convertToAxleToolCalls(completion.content),
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (completion.type == "message") {
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      reason: stopReason,
      message: {
        role: "assistant" as const,
        id: completion.id,
        model: completion.model,
        content: convertToAxleContentParts(completion.content),
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }
}
