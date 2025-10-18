import { AxleError } from "../errors/AxleError.js";
import { AnthropicProvider } from "./anthropic/index.js";
import { GoogleAIProvider } from "./googleai/index.js";
import { OllamaProvider } from "./ollama/index.js";
import { OpenAIProvider } from "./openai/index.js";
import { AIProviderConfig, OllamaProviderConfig } from "./types.js";

type ProviderMap = {
  ollama: OllamaProvider;
  anthropic: AnthropicProvider;
  openai: OpenAIProvider;
  googleai: GoogleAIProvider;
};

export function getProvider<K extends keyof AIProviderConfig>(
  provider: K,
  config: AIProviderConfig[K],
): ProviderMap[K] {
  if (!config || Object.keys(config).length === 0) {
    throw new AxleError(
      `The provider ${provider} is not configured. Please check your configuration.`,
    );
  }
  switch (provider) {
    case "openai":
      return new OpenAIProvider(config["api-key"], config.model) as ProviderMap[K];
    case "anthropic":
      return new AnthropicProvider(config["api-key"], config.model) as ProviderMap[K];
    case "googleai":
      return new GoogleAIProvider(config["api-key"], config.model) as ProviderMap[K];
    case "ollama": {
      const ollamaConfig = config as OllamaProviderConfig;
      return new OllamaProvider(ollamaConfig.model, ollamaConfig.url) as ProviderMap[K];
    }
    default:
      throw new AxleError("The provider is unsupported");
  }
}

export { generate } from "./generate.js";
// export { stream } from "./stream.js";
