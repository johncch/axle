import { chatCompletions } from "../protocols/chatCompletions/chatCompletions.js";
import { messages } from "../protocols/messages/messages.js";
import { responses } from "../protocols/responses/responses.js";
import type { AIProvider, ProviderClientOptions } from "../protocols/types.js";

export interface BedrockOptions extends ProviderClientOptions {
  /**
   * The protocol to speak, which follows the model: `messages` for Claude,
   * `responses` or `chatCompletions` for the models Mantle serves.
   */
  protocol: "messages" | "responses" | "chatCompletions";
  /** AWS region of the Bedrock endpoint, such as `us-east-1`. */
  region: string;
}

export function bedrock(apiKey: string, options: BedrockOptions): AIProvider {
  const { protocol, region, ...clientOptions } = options;
  const id = "amazon-bedrock";
  const mantleUrl = `https://bedrock-mantle.${region}.api.aws/v1`;
  switch (protocol) {
    case "messages":
      return messages({
        ...clientOptions,
        baseUrl: `https://bedrock-runtime.${region}.amazonaws.com/anthropic`,
        apiKey,
        id,
      });
    case "responses":
      return responses({ ...clientOptions, baseUrl: mantleUrl, apiKey, id });
    case "chatCompletions":
      return chatCompletions({ ...clientOptions, baseUrl: mantleUrl, apiKey, id });
  }
}
