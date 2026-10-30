import {
  chatCompletions,
  type ChatCompletionsOptions,
} from "../protocols/chatCompletions/chatCompletions.js";
import { openrouterDialect } from "../protocols/chatCompletions/dialects/openrouter.js";
import type { AIProvider } from "../protocols/types.js";

export function openrouter(
  apiKey: string,
  options: Omit<ChatCompletionsOptions, "baseUrl" | "apiKey" | "id" | "dialect"> & {
    baseUrl?: string;
  } = {},
): AIProvider {
  return chatCompletions({
    ...options,
    baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
    apiKey,
    id: "openrouter",
    dialect: openrouterDialect,
  });
}
