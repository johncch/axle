import { GoogleGenAI } from "@google/genai";
import { AnyStreamChunk } from "../../messages/stream.js";
import { AIProvider, ProtocolOptions, ProviderStreamParams } from "../types.js";
import { lookupHost, requireInteger } from "../utils.js";
import { createStreamingRequest } from "./createStreamingRequest.js";

const KNOWN_HOSTS: Readonly<Record<string, { id: string }>> = {
  "generativelanguage.googleapis.com": { id: "google" },
};

/**
 * A provider speaking Google's generateContent protocol at `baseUrl`, the
 * origin the SDK appends `/v1beta/models/…` to.
 */
export function generateContent(options: ProtocolOptions): AIProvider {
  const { baseUrl } = options;
  const known = lookupHost(KNOWN_HOSTS, baseUrl);
  const client = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: {
      baseUrl,
      retryOptions: { attempts: retryAttempts(options.maxRetries) },
      ...(options.timeoutMs !== undefined
        ? { timeout: requireInteger(options.timeoutMs, "timeoutMs", { min: 1 }) }
        : {}),
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    },
  });

  return {
    protocol: "generateContent",
    id: options.id ?? known?.id,

    /** @internal */
    createStreamingRequest(
      model: string,
      params: ProviderStreamParams,
    ): AsyncGenerator<AnyStreamChunk, void, unknown> {
      return createStreamingRequest({
        client,
        model: options.resolveModel ? options.resolveModel(model) : model,
        ...params,
      });
    },
  };
}

function retryAttempts(maxRetries = 2): number {
  return requireInteger(maxRetries, "maxRetries", { min: 0 }) + 1;
}
