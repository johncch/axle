import { describe, expect, test } from "vitest";
import { chatUsageToStats } from "../../../src/protocols/chatCompletions/utils.js";

describe("chatUsageToStats", () => {
  test("reads cached tokens from prompt_tokens_details", () => {
    const stats = chatUsageToStats({
      prompt_tokens: 10,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 7, cache_write_tokens: 3 },
    });
    expect(stats).toMatchObject({ in: 10, out: 2, cachedIn: 7, cacheWriteIn: 3 });
  });

  test("reads top-level cached_tokens, as Together reports on some models", () => {
    const stats = chatUsageToStats({ prompt_tokens: 10, completion_tokens: 2, cached_tokens: 7 });
    expect(stats).toMatchObject({ in: 10, out: 2, cachedIn: 7 });
  });

  test("nested detail wins over top-level cached_tokens", () => {
    const stats = chatUsageToStats({
      prompt_tokens: 10,
      completion_tokens: 2,
      cached_tokens: 1,
      prompt_tokens_details: { cached_tokens: 7 },
    });
    expect(stats.cachedIn).toBe(7);
  });
});
