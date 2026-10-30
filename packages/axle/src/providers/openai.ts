import { resolveFirstPartyModel } from "../protocols/model.js";
import { responses } from "../protocols/responses/responses.js";
import type { AIProvider, ProviderClientOptions } from "../protocols/types.js";

export function openai(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  return responses({
    ...options,
    baseUrl: "https://api.openai.com/v1",
    apiKey,
    id: "openai",
    resolveModel: (model) => resolveFirstPartyModel(model, ["openai"]),
  });
}
