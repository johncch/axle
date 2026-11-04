import {
  chatCompletions,
  type ChatCompletionsOptions,
} from "../protocols/chatCompletions/chatCompletions.js";
import { togetheraiDialect } from "../protocols/chatCompletions/dialects/togetherai.js";
import type { AIProvider } from "../protocols/types.js";

export function togetherai(
  apiKey: string,
  options: Omit<ChatCompletionsOptions, "baseUrl" | "apiKey" | "id" | "dialect"> = {},
): AIProvider {
  return chatCompletions({
    ...options,
    baseUrl: "https://api.together.xyz/v1",
    apiKey,
    id: "togetherai",
    dialect: togetheraiDialect,
  });
}
