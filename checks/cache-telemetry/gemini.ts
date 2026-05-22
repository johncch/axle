import { GoogleGenAI } from "@google/genai";
import "dotenv/config";
import { gemini, generate } from "../../src/index.js";
import { GeminiModels } from "../../src/providers/models.js";
import type { Stats } from "../../src/types.js";
import { env, print, requiredEnv } from "./runtime.js";

const apiKey = requiredEnv("GEMINI_API_KEY");
const model = env.GEMINI_CACHE_MODEL ?? GeminiModels.GEMINI_2_5_FLASH;
const client = new GoogleGenAI({ apiKey });
const provider = gemini(apiKey);

const cache = await client.caches.create({
  model,
  config: {
    displayName: `axle-cache-telemetry-${Date.now()}`,
    ttl: "300s",
    contents: [
      {
        role: "user",
        parts: [{ text: stableContext("gemini") }],
      },
    ],
  },
});

if (!cache.name) {
  throw new Error(`Gemini cache creation did not return a cache name: ${JSON.stringify(cache)}`);
}

try {
  const usage = await run(cache.name);
  print("gemini", { model, cacheName: cache.name, cacheUsage: cache.usageMetadata, usage });

  if ((usage.cachedIn ?? 0) <= 0) {
    throw new Error(`Expected Gemini call to report cachedIn > 0. Usage: ${JSON.stringify(usage)}`);
  }
} finally {
  await client.caches.delete({ name: cache.name }).catch((error) => {
    console.warn(`Failed to delete Gemini cache ${cache.name}: ${String(error)}`);
  });
}

async function run(cachedContent: string): Promise<Stats> {
  const result = await generate({
    provider,
    model,
    messages: [
      {
        role: "user",
        content: "Using the cached context, answer with exactly this text: cache telemetry ok",
      },
    ],
    maxOutputTokens: 24,
    providerOptions: {
      cachedContent,
    },
  });

  if (!result.ok) {
    throw new Error(`Gemini cached-content call failed: ${JSON.stringify(result.error)}`);
  }
  return result.usage ?? { in: 0, out: 0 };
}

function stableContext(providerName: string): string {
  return Array.from(
    { length: 1800 },
    (_, index) =>
      `Stable ${providerName} cache line ${index}: Axle should preserve cached content token telemetry when explicit cached content is referenced.`,
  ).join("\n");
}
