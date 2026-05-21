import "dotenv/config";
import { chatCompletions, generate } from "../../src/index.js";
import { ChatCompletionsModels } from "../../src/providers/models.js";
import type { Stats } from "../../src/types.js";
import { env, print, requiredEnv } from "./runtime.js";

const apiKey = requiredEnv("OPENROUTER_API_KEY");
const baseUrl = env.CHAT_COMPLETIONS_CACHE_BASE_URL ?? "https://openrouter.ai/api/v1";
const model = env.CHAT_COMPLETIONS_CACHE_MODEL ?? ChatCompletionsModels.QWEN_3_6_35B_A3B;
const requireCachedIn = env.CHAT_COMPLETIONS_CACHE_REQUIRE === "true";
const provider = chatCompletions(baseUrl, apiKey);
const prompt = [
  stableContext("chatcompletions"),
  "",
  "Answer with exactly this text: cache telemetry ok",
].join("\n");

const first = await run("first");
const second = await run("second");

print("chatcompletions", {
  baseUrl,
  model,
  first,
  second,
  observedCachedIn: (second.cachedIn ?? 0) > 0,
});

if (requireCachedIn && (second.cachedIn ?? 0) <= 0) {
  throw new Error(
    [
      "Expected second ChatCompletions-compatible call to report cachedIn > 0.",
      "This depends on the upstream service returning prompt_tokens_details.cached_tokens.",
      `Usage: ${JSON.stringify(second)}`,
    ].join(" "),
  );
}

if ((second.cachedIn ?? 0) <= 0) {
  console.warn(
    [
      "ChatCompletions-compatible endpoint did not report cachedIn.",
      "Set CHAT_COMPLETIONS_CACHE_REQUIRE=true to make this a hard failure for endpoints expected to support it.",
    ].join(" "),
  );
}

async function run(label: string): Promise<Stats> {
  const result = await generate({
    provider,
    model,
    messages: [{ role: "user", content: prompt }],
    options: {
      max_tokens: 24,
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
      `Stable ${providerName} cache line ${index}: Axle should preserve OpenAI-compatible cached token telemetry when an upstream service reports it.`,
  ).join("\n");
}
