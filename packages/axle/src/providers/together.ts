import {
  chatCompletions,
  type ChatCompletionsOptions,
} from "../protocols/chatCompletions/chatCompletions.js";
import { togetherDialect } from "../protocols/chatCompletions/dialects/together.js";
import type { AIProvider } from "../protocols/types.js";

export function together(
  apiKey: string,
  options: Omit<ChatCompletionsOptions, "baseUrl" | "apiKey" | "id" | "dialect"> = {},
): AIProvider {
  return chatCompletions({
    ...options,
    baseUrl: "https://api.together.xyz/v1",
    apiKey,
    id: "togetherai",
    dialect: togetherDialect,
  });
}
