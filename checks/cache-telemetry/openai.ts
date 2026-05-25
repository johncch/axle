import type { Stats } from "@fifthrevision/axle";
import { generate, openai } from "@fifthrevision/axle";
import { OpenAIModels } from "@fifthrevision/axle/models";
import "dotenv/config";
import { env, print, requiredEnv } from "./runtime.js";

const apiKey = requiredEnv("OPENAI_API_KEY");
const model = env.OPENAI_CACHE_MODEL ?? OpenAIModels.GPT_5_4_MINI;
const provider = openai(apiKey);
const cacheKey = env.OPENAI_CACHE_KEY ?? "axle-cache-telemetry-openai";
const prompt = [
  stableContext("openai"),
  "",
  "Answer with exactly this text: cache telemetry ok",
].join("\n");

const first = await run("first");
const second = await run("second");

print("openai", { model, cacheKey, first, second });

if ((second.cachedIn ?? 0) <= 0) {
  throw new Error(
    `Expected second OpenAI call to report cachedIn > 0. Usage: ${JSON.stringify(second)}`,
  );
}

async function run(label: string): Promise<Stats> {
  const result = await generate({
    provider,
    model,
    messages: [{ role: "user", content: prompt }],
    maxOutputTokens: 24,
    providerOptions: {
      prompt_cache_key: cacheKey,
      prompt_cache_retention: "in_memory",
    },
  });

  if (!result.ok) {
    throw new Error(`${label} call failed: ${JSON.stringify(result.error)}`);
  }
  return result.usage ?? { in: 0, out: 0 };
}

function stableContext(providerName: string): string {
  return Array.from(
    { length: 1800 },
    (_, index) =>
      `Stable ${providerName} cache line ${index}: Axle should preserve repeated provider usage telemetry for long identical prompt prefixes.`,
  ).join("\n");
}
