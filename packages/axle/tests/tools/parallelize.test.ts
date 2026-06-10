import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import { parallelize } from "../../src/tools/parallelize.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ExecutableTool, ToolContext } from "../../src/tools/types.js";

const testCtx: ToolContext = {
  registry: new ToolRegistry(),
  signal: new AbortController().signal,
  emit: () => {},
};

describe("parallelize", () => {
  test("creates a parallel-safe batch tool with a default name", async () => {
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "lookup",
      description: "Lookup a value",
      schema,
      async execute(input) {
        return `value:${input.id}`;
      },
    };

    const batch = parallelize(tool);
    const result = JSON.parse(
      String(await batch.execute({ items: [{ id: "a" }, { id: "b" }] }, testCtx)),
    );

    expect(batch.name).toBe("lookup_batch");
    expect(result.results).toEqual([
      { index: 0, input: { id: "a" }, ok: true, output: "value:a" },
      { index: 1, input: { id: "b" }, ok: true, output: "value:b" },
    ]);
  });

  test("preserves input order when inner calls complete out of order", async () => {
    const schema = z.object({ id: z.string(), delay: z.number() });
    const tool: ExecutableTool<typeof schema> = {
      name: "delayed",
      description: "Delayed lookup",
      schema,
      async execute(input) {
        await delay(input.delay);
        return input.id;
      },
    };

    const batch = parallelize(tool, { maxConcurrency: 2 });
    const result = JSON.parse(
      String(
        await batch.execute(
          {
            items: [
              { id: "slow", delay: 20 },
              { id: "fast", delay: 1 },
            ],
          },
          testCtx,
        ),
      ),
    );

    expect(result.results.map((item: { output: string }) => item.output)).toEqual(["slow", "fast"]);
  });

  test("returns per-item errors without failing the whole batch", async () => {
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "maybe_fail",
      description: "Maybe fail",
      schema,
      async execute(input) {
        if (input.id === "bad") throw new Error("bad item");
        return `ok:${input.id}`;
      },
    };

    const batch = parallelize(tool);
    const result = JSON.parse(
      String(await batch.execute({ items: [{ id: "good" }, { id: "bad" }] }, testCtx)),
    );

    expect(result.results[0]).toMatchObject({ ok: true, output: "ok:good" });
    expect(result.results[1]).toMatchObject({
      ok: false,
      error: { type: "execution", message: "bad item" },
    });
  });

  test("respects maxConcurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const execute = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
      return "ok";
    });
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "limited",
      description: "Limited",
      schema,
      execute,
    };

    const batch = parallelize(tool, { maxConcurrency: 2 });
    await batch.execute({ items: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }, testCtx);

    expect(maxActive).toBe(2);
    expect(execute).toHaveBeenCalledTimes(4);
  });

  test("rethrows fatal errors instead of demoting them to per-item failures", async () => {
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "fatal",
      description: "Fatal",
      schema,
      async execute(input) {
        if (input.id === "boom") {
          throw new AxleToolFatalError("credentials revoked", { toolName: "fatal" });
        }
        return `ok:${input.id}`;
      },
    };

    const batch = parallelize(tool, { maxConcurrency: 1 });

    await expect(
      batch.execute({ items: [{ id: "a" }, { id: "boom" }, { id: "c" }] }, testCtx),
    ).rejects.toBeInstanceOf(AxleToolFatalError);
  });

  test("stops starting items once the signal aborts", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "abortable",
      description: "Abortable",
      schema,
      async execute(input) {
        started.push(input.id);
        if (input.id === "a") controller.abort("stop");
        return input.id;
      },
    };
    const ctx: ToolContext = { ...testCtx, signal: controller.signal };

    const batch = parallelize(tool, { maxConcurrency: 1 });

    await expect(
      batch.execute({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] }, ctx),
    ).rejects.toBeInstanceOf(AxleAbortError);
    expect(started).toEqual(["a"]);
  });

  test("inherits the wrapped tool's kind", () => {
    const schema = z.object({ q: z.string() });
    const agentBacked: ExecutableTool<typeof schema> = {
      kind: "agent",
      name: "research",
      description: "Agent-backed",
      schema,
      execute: async () => "x",
    };
    const plain: ExecutableTool<typeof schema> = {
      name: "lookup",
      description: "Plain",
      schema,
      execute: async () => "x",
    };

    expect(parallelize(agentBacked).kind).toBe("agent");
    expect(parallelize(plain).kind).toBeUndefined();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
