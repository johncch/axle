import { generate, type Stats } from "@fifthrevision/axle";
import { GoogleGenAI } from "@google/genai";
import { fail } from "./helpers.js";
import type { BaselineCase } from "./types.js";

// Cache counters that silently read as zero are indistinguishable from a
// provider that never cached, so this is the only place the mapping from
// provider usage fields to `cachedIn` / `cacheWriteIn` is exercised for real.
// Every provider here needs a prefix above its minimum cacheable size.
const stableContext = Array.from(
  { length: 400 },
  (_, index) =>
    `Stable cache line ${index}: Axle should preserve provider cache telemetry for repeated identical prompt prefixes.`,
).join("\n");

export const cacheCases: BaselineCase[] = [
  {
    group: "extended",
    id: "cache-prompt-reuse",
    description: "Repeating a long prompt reports cached input tokens on the second call.",
    providers: ["openai", "anthropic"],
    async run({ provider, model, providerId, requestOptions }) {
      const providerOptions =
        providerId === "openai"
          ? {
              prompt_cache_key: `axle-baseline-cache-${Date.now()}`,
              prompt_cache_retention: "in_memory",
            }
          : { cache_control: { type: "ephemeral" } };

      const call = async (): Promise<Stats | { error: unknown }> => {
        const result = await generate({
          provider,
          model,
          ...requestOptions,
          messages: [
            {
              role: "user",
              content: `${stableContext}\n\nAnswer with exactly this text: cache telemetry ok`,
            },
          ],
          maxOutputTokens: 24,
          providerOptions,
        });
        return result.ok ? (result.usage ?? { in: 0, out: 0 }) : { error: result.error };
      };

      const first = await call();
      if ("error" in first) return fail({ call: "first", error: first.error });
      const second = await call();
      if ("error" in second) return fail({ call: "second", error: second.error });

      const failureReasons = [
        ...((second.cachedIn ?? 0) > 0 ? [] : ["Second call did not report cachedIn > 0."]),
        ...(providerId === "anthropic" && (first.cacheWriteIn ?? 0) <= 0
          ? ["First Anthropic call did not report cacheWriteIn > 0."]
          : []),
      ];
      return {
        ok: failureReasons.length === 0,
        ...(failureReasons.length > 0 ? { failureReasons } : {}),
        details: { first, second, usage: second },
      };
    },
  },
  {
    group: "extended",
    id: "cache-gemini-cached-content",
    description:
      "Referencing an explicit Gemini cached-content resource reports cached input tokens.",
    providers: ["gemini"],
    async run({ provider, model, requestOptions }) {
      const client = new GoogleGenAI({ apiKey: getEnv("GEMINI_API_KEY") });
      // The raw client wants the bare model id; Axle's provider strips the
      // registry's vendor prefix itself.
      const cache = await client.caches.create({
        model: model.replace(/^google\//, ""),
        config: {
          displayName: `axle-baseline-cache-${Date.now()}`,
          ttl: "300s",
          contents: [{ role: "user", parts: [{ text: stableContext }] }],
        },
      });
      if (!cache.name) return fail({ error: "Gemini cache creation returned no name.", cache });

      try {
        const result = await generate({
          provider,
          model,
          ...requestOptions,
          messages: [
            {
              role: "user",
              content:
                "Using the cached context, answer with exactly this text: cache telemetry ok",
            },
          ],
          maxOutputTokens: 24,
          providerOptions: { cachedContent: cache.name },
        });
        if (!result.ok) return fail({ error: result.error, cacheName: cache.name });
        const cachedIn = result.usage?.cachedIn ?? 0;
        return {
          ok: cachedIn > 0,
          ...(cachedIn > 0 ? {} : { failureReasons: ["Call did not report cachedIn > 0."] }),
          details: { cacheName: cache.name, cacheUsage: cache.usageMetadata, usage: result.usage },
        };
      } finally {
        await client.caches.delete({ name: cache.name }).catch(() => {});
      }
    },
  },
];

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
