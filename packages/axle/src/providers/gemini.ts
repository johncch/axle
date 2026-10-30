import { generateContent } from "../protocols/generateContent/generateContent.js";
import { resolveFirstPartyModel } from "../protocols/model.js";
import type { AIProvider, ProviderClientOptions } from "../protocols/types.js";

export function gemini(apiKey: string, options: ProviderClientOptions = {}): AIProvider {
  return generateContent({
    ...options,
    baseUrl: "https://generativelanguage.googleapis.com",
    apiKey,
    id: "google",
    resolveModel: (model) => resolveFirstPartyModel(model, ["gemini", "google"]),
  });
}
