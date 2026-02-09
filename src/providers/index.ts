import { AxleError } from "../errors/AxleError.js";
import { DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "./anthropic/models.js";
import { anthropic } from "./anthropic/provider.js";
import { chatCompletions } from "./chatcompletions/provider.js";
import { DEFAULT_MODEL as GEMINI_DEFAULT_MODEL } from "./gemini/models.js";
import { gemini } from "./gemini/provider.js";
import { DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "./openai/models.js";
import { openai } from "./openai/provider.js";
import { AIProvider, AIProviderConfig, ChatCompletionsProviderConfig } from "./types.js";

export function getProvider<K extends keyof AIProviderConfig>(
  provider: K,
  config: AIProviderConfig[K],
): { provider: AIProvider; model: string } {
  if (!config || Object.keys(config).length === 0) {
    throw new AxleError(
      `The provider ${provider} is not configured. Please check your configuration.`,
    );
  }
  switch (provider) {
    case "openai":
      return {
        provider: openai(config["api-key"]),
        model: config.model || OPENAI_DEFAULT_MODEL,
      };
    case "anthropic":
      return {
        provider: anthropic(config["api-key"]),
        model: config.model || ANTHROPIC_DEFAULT_MODEL,
      };
    case "gemini":
      return {
        provider: gemini(config["api-key"]),
        model: config.model || GEMINI_DEFAULT_MODEL,
      };
    case "chatcompletions": {
      const cc = config as ChatCompletionsProviderConfig;
      return {
        provider: chatCompletions(cc["base-url"], cc["api-key"]),
        model: cc.model,
      };
    }
    default:
      throw new AxleError("The provider is unsupported");
  }
}

export { generate } from "./generate.js";
export { generateTurn } from "./generateTurn.js";
export { stream } from "./stream.js";
export { streamTurn } from "./streamTurn.js";
