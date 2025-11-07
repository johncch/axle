import Anthropic from "@anthropic-ai/sdk";
import { Recorder } from "../../recorder/recorder.js";

import {
  DocumentBlockParam,
  ImageBlockParam,
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from "@anthropic-ai/sdk/resources";
import {
  Chat,
  getDocuments,
  getImages,
  getTextAndInstructions,
} from "../chat.js";
import {
  AIProvider,
  AIRequest,
  AIResponse,
  StopReason,
  ToolCall,
} from "../types.js";
import { Models, MULTIMODAL_MODELS } from "./models.js";

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

  createChatRequest(
    chat: Chat,
    context: { recorder?: Recorder } = {},
  ): AIRequest {
    const { recorder } = context;
    if (chat.hasFiles() && !MULTIMODAL_MODELS.includes(this.model as any)) {
      recorder?.warn?.log(
        `Model ${this.model} may not support multimodal content. Use one of: ${MULTIMODAL_MODELS.join(", ")}`,
      );
    }
    return new AnthropicChatRequest(this, chat);
  }
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
      result = translate(completion);
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

function getStopReason(reason: string) {
  switch (reason) {
    case "max_tokens":
      return StopReason.Length;
    case "end_turn":
      return StopReason.Stop;
    case "stop_sequence":
      return StopReason.Stop;
    case "tool_use":
      return StopReason.FunctionCall;
    default:
      return StopReason.Error;
  }
}

export function prepareRequest(chat: Chat) {
  const messages = chat.messages.map((msg) => {
    if (msg.role === "assistant") {
      const content: Array<TextBlockParam | ToolUseBlockParam> = [];
      content.push({ type: "text", text: msg.content });
      if (msg.toolCalls) {
        content.push(
          ...msg.toolCalls.map(
            (call) =>
              ({
                type: "tool_use",
                id: call.id,
                name: call.name,
                input: call.arguments,
              }) satisfies ToolUseBlockParam,
          ),
        );
      }
      return {
        role: "assistant",
        content,
      };
    }

    if (msg.role === "tool") {
      return {
        role: "user",
        content: msg.content.map((r) => ({
          type: "tool_result",
          tool_use_id: r.id,
          content: r.content,
        })) satisfies Array<ToolResultBlockParam>,
      } satisfies MessageParam;
    }

    if (typeof msg.content === "string") {
      return {
        role: "user",
        content: msg.content,
      } satisfies MessageParam;
    } else {
      const content: Array<
        TextBlockParam | ImageBlockParam | DocumentBlockParam
      > = [];

      const text = getTextAndInstructions(msg.content);
      if (text) {
        content.push({
          type: "text",
          text,
        } satisfies TextBlockParam);
      }

      const images = getImages(msg.content);
      if (images.length > 0) {
        content.push(
          ...images.map(
            (img) =>
              ({
                type: "image" as const,
                source: {
                  type: "base64",
                  media_type: img.mimeType as
                    | "image/jpeg"
                    | "image/png"
                    | "image/gif"
                    | "image/webp",
                  data: img.base64,
                },
              }) satisfies ImageBlockParam,
          ),
        );
      }

      const documents = getDocuments(msg.content);
      if (documents.length > 0) {
        content.push(
          ...documents
            .filter((doc) => doc.mimeType === "application/pdf")
            .map(
              (doc) =>
                ({
                  type: "document" as const,
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: doc.base64,
                  },
                }) satisfies DocumentBlockParam,
            ),
        );
      }

      return {
        role: "user",
        content,
      } satisfies MessageParam;
    }
  }) satisfies Array<MessageParam>;

  const tools = chat.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  return {
    system: chat.system,
    messages: messages,
    tools: tools,
  };
}

function translate(completion: Anthropic.Messages.Message): AIResponse {
  const stopReason = getStopReason(completion.stop_reason);
  if (stopReason === StopReason.Error) {
    return {
      type: "error",
      error: {
        type: "Uncaught error",
        message: "Stop reason is not recognized.",
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (stopReason === StopReason.FunctionCall) {
    const content = completion.content[0];
    const contentText = content.type === "text" ? content.text : "";

    const toolCalls = completion.content
      .slice(1)
      .map((toolUse) => {
        if (toolUse.type === "tool_use") {
          return {
            id: toolUse.id,
            name: toolUse.name,
            arguments: toolUse.input,
          };
        }
      })
      .filter((v): v is ToolCall => v !== null);

    return {
      type: "success",
      id: completion.id,
      model: completion.model,
      reason: StopReason.FunctionCall,
      message: {
        role: completion.role,
        content: contentText,
        toolCalls: toolCalls,
      },
      usage: {
        in: completion.usage.input_tokens,
        out: completion.usage.output_tokens,
      },
      raw: completion,
    };
  }

  if (completion.type == "message") {
    const content = completion.content[0];
    if (content.type == "text") {
      return {
        type: "success",
        id: completion.id,
        model: completion.model,
        reason: getStopReason(completion.stop_reason),
        message: {
          role: completion.role,
          content: content.text,
        },
        usage: {
          in: completion.usage.input_tokens,
          out: completion.usage.output_tokens,
        },
        raw: completion,
      };
    }
  }
}
