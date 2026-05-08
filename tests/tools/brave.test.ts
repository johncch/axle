import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import braveSearchTool from "../../src/tools/brave.js";
import { ToolRegistry } from "../../src/tools/registry.js";

describe("braveSearchTool", () => {
  beforeEach(() => {
    braveSearchTool.configure({ "api-key": "test-key" });
    braveSearchTool.lastExecTime = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes ctx.signal and API key to fetch", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ web: { results: [] } }),
    });
    vi.stubGlobal("fetch", fetch);

    const result = await braveSearchTool.execute(
      { searchTerm: "axle" },
      {
        signal: controller.signal,
        registry: new ToolRegistry(),
        emit: () => {},
      },
    );

    expect(JSON.parse(result)).toEqual({ web: { results: [] } });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("q=axle"), {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": "test-key",
      },
    });
  });

  it("preserves abort errors instead of wrapping them as search failures", async () => {
    const controller = new AbortController();
    controller.abort("stop");

    await expect(
      braveSearchTool.execute(
        { searchTerm: "axle" },
        {
          signal: controller.signal,
          registry: new ToolRegistry(),
          emit: () => {},
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError", reason: "stop" });
  });
});
