import Anthropic from "@anthropic-ai/sdk";
import { Recorder } from "../../recorder/recorder.js";

import { getTextContent } from "../../messages/chat.js";
import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { ToolDefinition } from "../../tools/types.js";
import { AIProvider, AxleStopReason, GenerationResult } from "../types.js";
import { getUndefinedError } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";
import { DEFAULT_MODEL } from "./models.js";
import {
  convertStopReason,
  convertToAxleContentParts,
  convertToAxleToolCalls,
  convertToProviderMessages,
  convertToProviderTools,
} from "./utils.js";

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

  async createGenerationRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): Promise<GenerationResult> {
    return await createGenerationRequest({ client: this.client, model: this.model, ...params });
  }

  createStreamingRequest(params: {
    messages: Array<AxleMessage>;
    tools?: Array<ToolDefinition>;
    context: { recorder?: Recorder };
  }): AsyncGenerator<AnyStreamChunk, void, unknown> {
    const { messages, tools, context } = params;
    return createStreamingRequest({
      client: this.client,
      model: this.model,
      messages,
      tools,
      runtime: context,
    });
  }
}

async function createGenerationRequest(params: {
  client: Anthropic;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  context?: { recorder?: Recorder };
}): Promise<GenerationResult> {
  const { client, model, messages, tools, context } = params;
  const { recorder } = context;
  const request = {
    model: model,
    max_tokens: 4096,
    messages: convertToProviderMessages(messages),
    ...(tools && { tools: convertToProviderTools(tools) }),
  };
  recorder?.debug?.log(request);

  let result: GenerationResult;
  try {
    const completion = await client.messages.create(request);
    result = convertToAIResponse(completion);
  } catch (e) {
    result = getUndefinedError(e);
  }

  recorder?.debug?.log(result);
  return result;
}

function convertToAIResponse(completion: Anthropic.Messages.Message): GenerationResult {
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
    const content = convertToAxleContentParts(completion.content);
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: completion.role,
      reason: AxleStopReason.FunctionCall,
      content,
      text: getTextContent(content) ?? "",
      toolCalls: convertToAxleToolCalls(completion.content),
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (completion.type == "message") {
    const content = convertToAxleContentParts(completion.content);
    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      role: "assistant" as const,
      reason: stopReason,
      content,
      text: getTextContent(content) ?? "",
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }
}
