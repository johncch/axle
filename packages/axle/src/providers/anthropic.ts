import { messages } from "../protocols/messages/messages.js";
import { resolveFirstPartyModel } from "../protocols/model.js";
import type { AIProvider, ProviderClientOptions } from "../protocols/types.js";

export function anthropic(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  return messages({
    ...options,
    baseUrl: "https://api.anthropic.com",
    apiKey,
    id: "anthropic",
    resolveModel: (model) => resolveFirstPartyModel(model, ["anthropic"]),
  });
}
