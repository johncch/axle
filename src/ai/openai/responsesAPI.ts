import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseFunctionToolCall,
} from "openai/resources/responses/responses.js";
import { Chat, getInstructions, getTextContent } from "../../messages/chat.js";
import { Recorder } from "../../recorder/recorder.js";
import { AIRequest, AxleStopReason, GenerationResult } from "../types.js";
import { OpenAIProvider } from "./provider.js";
import { convertAxleMessageToResponseInput } from "./utils/responsesAPI.js";

export class OpenAIResponsesAPI implements AIRequest {
  constructor(
    private provider: OpenAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<GenerationResult> {
    const { recorder } = runtime;
    const { client, model } = this.provider;
    const request = prepareRequest(this.chat, model);
    recorder?.debug?.heading.log("[Open AI Provider] Using the Responses API");
    recorder?.debug?.log(request);

    let result: GenerationResult;
    try {
      const response = await client.responses.create(request);
      result = fromModelResponse(response);
    } catch (e) {
      recorder?.error?.log(e);
      result = {
        type: "error",
        error: {
          type: e.type ?? "Undetermined",
          message: e.message ?? "Unexpected error from OpenAI",
        },
        usage: {
          in: 0,
          out: 0,
        },
        raw: e,
      };
    }
    recorder?.debug?.log(result);
    return result;
  }
}

export function prepareRequest(chat: Chat, model: string): ResponseCreateParamsNonStreaming {
  const request: ResponseCreateParamsNonStreaming = {
    model,
    input: convertAxleMessageToResponseInput(chat.messages),
  };

  const mostRecentMessage = chat.latest();
  if (mostRecentMessage && mostRecentMessage.role === "user") {
    let instructions = "";
    const msgInstructions = getInstructions(mostRecentMessage.content);
    if (chat.system) {
      instructions = chat.system;
    }
    if (msgInstructions) {
      instructions = instructions ? `${instructions}\n\n${msgInstructions}` : msgInstructions;
    }
    if (instructions) {
      request.instructions = instructions;
    }
  }

  if (chat.tools.length > 0) {
    request.tools = chat.tools.map((schema) => ({
      type: "function",
      strict: true,
      ...schema,
    }));
  }

  return request;
}

export function fromModelResponse(response: Response): GenerationResult {
  if (response.error) {
    return {
      type: "error",
      error: {
        type: response.error.code || "undetermined",
        message: response.error.message || "Response generation failed",
      },
      usage: {
        in: response.usage?.input_tokens ?? 0,
        out: response.usage?.output_tokens ?? 0,
      },
      raw: response,
    };
  }

  // TODO: Refactor Messages to hold function calls
  const toolCalls = response.output
    ?.filter((item) => item.type === "function_call")
    ?.map((item: ResponseFunctionToolCall) => ({
      type: "tool-call" as const,
      id: item.id || "",
      name: item.name || "",
      arguments: item.arguments || "",
    }));

  const contentParts = [{ type: "text" as const, text: response.output_text || "" }];
  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    role: "assistant" as const,
    reason: response.incomplete_details ? AxleStopReason.Error : AxleStopReason.Stop,
    content: contentParts,
    text: getTextContent(contentParts) ?? "",
    ...(toolCalls?.length && { toolCalls }),
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
