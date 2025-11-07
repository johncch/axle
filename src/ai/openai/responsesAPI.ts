import {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
} from "openai/resources/responses/responses.js";
import { Recorder } from "../../recorder/recorder.js";
import {
  Chat,
  getDocuments,
  getImages,
  getInstructions,
  getTextContent,
} from "../chat.js";
import { AIRequest, AIResponse, StopReason } from "../types.js";
import { OpenAIProvider } from "./provider.js";

export class OpenAIResponsesAPI implements AIRequest {
  constructor(
    private provider: OpenAIProvider,
    private chat: Chat,
  ) {}

  async execute(runtime: { recorder?: Recorder }): Promise<AIResponse> {
    const { recorder } = runtime;
    const { client, model } = this.provider;
    const request = prepareRequest(this.chat, model);
    recorder?.debug?.heading.log("[Open AI Provider] Using the Responses API");
    recorder?.debug?.log(request);

    let result: AIResponse;
    try {
      const response = await client.responses.create(request);
      result = translateResponseToAIResponse(response);
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

export function prepareRequest(
  chat: Chat,
  model: string,
): ResponseCreateParamsNonStreaming {
  const input: ResponseInput = chat.messages
    .map((msg) => {
      if (msg.role === "tool") {
        return msg.content.map((r) => ({
          type: "function_call_output" as const,
          call_id: r.id,
          output: r.content,
        }));
      }

      if (msg.role === "assistant") {
        const toolCalls = msg.toolCalls?.map((call) => {
          const id = call.id;
          return {
            type: "function",
            function: {
              name: call.name,
              arguments:
                typeof call.arguments === "string"
                  ? call.arguments
                  : JSON.stringify(call.arguments),
            },
            ...(id && { id }),
          };
        });
        return {
          role: msg.role,
          content: msg.content,
          ...(toolCalls && { toolCalls }),
        };
      }

      if (typeof msg.content === "string") {
        return {
          role: msg.role,
          content: msg.content,
        };
      } else {
        const content: any[] = [];
        const textContent = getTextContent(msg.content);
        if (textContent) {
          content.push({
            type: "input_text",
            text: textContent,
          });
        }

        const images = getImages(msg.content);
        if (images.length > 0) {
          content.push(
            ...images.map((img) => ({
              type: "input_image",
              image_url: `data:${img.mimeType};base64,${img.base64}`,
            })),
          );
        }

        const documents = getDocuments(msg.content);
        if (documents.length > 0) {
          content.push(
            ...documents.map((doc) => ({
              type: "input_file",
              filename: doc.path,
              file_data: `data:${doc.mimeType};base64,${doc.base64}`,
            })),
          );
        }

        return {
          role: msg.role,
          content,
        };
      }
    })
    .flat(1);

  const request: ResponseCreateParamsNonStreaming = {
    model,
    input,
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

function translateResponseToAIResponse(response: Response): AIResponse {
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

  const toolCalls = response.output
    ?.filter((item) => item.type === "function_call")
    ?.map((item: any) => ({
      id: item.id || "",
      name: item.function?.name || "",
      arguments: item.function?.arguments || "",
    }));

  return {
    type: "success",
    id: response.id,
    model: response.model || "",
    reason: response.incomplete_details ? StopReason.Error : StopReason.Stop,
    message: {
      content: response.output_text || "",
      role: "assistant" as const,
      ...(toolCalls?.length && { toolCalls }),
    },
    usage: {
      in: response.usage?.input_tokens ?? 0,
      out: response.usage?.output_tokens ?? 0,
    },
    raw: response,
  };
}
