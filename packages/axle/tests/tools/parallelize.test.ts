import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { AxleAbortError } from "../../src/errors/AxleAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import type { ToolResultPart } from "../../src/messages/message.js";
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
    const result = await batch.execute({ items: [{ id: "a" }, { id: "b" }] }, testCtx);

    expect(batch.name).toBe("lookup_batch");
    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart("value:a"),
      textPart('<<result {"index":1,"ok":true}>>\n'),
      textPart("value:b"),
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
    const result = await batch.execute(
      {
        items: [
          { id: "slow", delay: 20 },
          { id: "fast", delay: 1 },
        ],
      },
      testCtx,
    );

    expect(textParts(result)).toEqual([
      '<<result {"index":0,"ok":true}>>\n',
      "slow",
      '<<result {"index":1,"ok":true}>>\n',
      "fast",
    ]);
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
    const result = await batch.execute({ items: [{ id: "good" }, { id: "bad" }] }, testCtx);

    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart("ok:good"),
      textPart(
        '<<result {"index":1,"ok":false,"error":{"type":"execution","message":"bad item"}}>>\n',
      ),
    ]);
  });

  test("preserves structured file parts returned by child tools", async () => {
    const schema = z.object({ id: z.string() });
    const filePart: ToolResultPart = {
      type: "file",
      file: {
        kind: "image",
        mimeType: "image/png",
        name: "pixel.png",
        size: 4,
        source: { type: "base64", data: "abcd" },
      },
    };
    const tool: ExecutableTool<typeof schema> = {
      name: "read_image",
      description: "Read an image",
      schema,
      async execute() {
        return [textPart("image:"), filePart];
      },
    };

    const batch = parallelize(tool);
    const result = await batch.execute({ items: [{ id: "a" }] }, testCtx);

    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart("image:"),
      filePart,
    ]);
  });

  test("omits structured child output when it exceeds maxResultBytes", async () => {
    const schema = z.object({ id: z.string() });
    const filePart: ToolResultPart = {
      type: "file",
      file: {
        kind: "document",
        mimeType: "application/pdf",
        name: "large.pdf",
        size: 100,
        source: { type: "base64", data: "x".repeat(100) },
      },
    };
    const tool: ExecutableTool<typeof schema> = {
      name: "read_pdf",
      description: "Read a PDF",
      schema,
      async execute() {
        return [filePart];
      },
    };

    const batch = parallelize(tool, { maxResultBytes: 90 });
    const result = await batch.execute({ items: [{ id: "a" }] }, testCtx);

    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart(
        '<<result 0 omitted: output 100 bytes exceeds remaining budget 57 bytes of 90 bytes; input {"id":"a"}>>',
      ),
    ]);
  });

  test("continues after omitting an oversized child output", async () => {
    const schema = z.object({ id: z.string() });
    const filePart: ToolResultPart = {
      type: "file",
      file: {
        kind: "document",
        mimeType: "application/pdf",
        name: "large.pdf",
        size: 100,
        source: { type: "base64", data: "x".repeat(100) },
      },
    };
    const tool: ExecutableTool<typeof schema> = {
      name: "read_mixed",
      description: "Read mixed output sizes",
      schema,
      async execute(input) {
        if (input.id === "big") return [filePart];
        return input.id;
      },
    };

    const batch = parallelize(tool, { maxResultBytes: 101 });
    const result = await batch.execute(
      { items: [{ id: "a" }, { id: "big" }, { id: "c" }] },
      testCtx,
    );

    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart("a"),
      textPart('<<result {"index":1,"ok":true}>>\n'),
      textPart(
        '<<result 1 omitted: output 100 bytes exceeds remaining budget 34 bytes of 101 bytes; input {"id":"big"}>>',
      ),
      textPart('<<result {"index":2,"ok":true}>>\n'),
      textPart("c"),
    ]);
  });

  test("omits text output when it exceeds maxResultBytes", async () => {
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "large_text",
      description: "Large text",
      schema,
      async execute() {
        return "abcdef";
      },
    };

    const batch = parallelize(tool, { maxResultBytes: 34 });
    const result = await batch.execute({ items: [{ id: "a" }] }, testCtx);

    expect(result).toEqual([
      textPart('<<result {"index":0,"ok":true}>>\n'),
      textPart(
        '<<result 0 omitted: output 6 bytes exceeds remaining budget 1 byte of 34 bytes; input {"id":"a"}>>',
      ),
    ]);
  });

  test("omits a result when its header exceeds maxResultBytes", async () => {
    const schema = z.object({ id: z.string() });
    const tool: ExecutableTool<typeof schema> = {
      name: "tiny_budget",
      description: "Tiny budget",
      schema,
      async execute(input) {
        return input.id;
      },
    };

    const batch = parallelize(tool, { maxResultBytes: 1 });
    const result = await batch.execute({ items: [{ id: "a" }] }, testCtx);

    expect(result).toEqual([
      textPart(
        '<<result 0 omitted: header 33 bytes exceeds remaining budget 1 byte of 1 byte; input {"id":"a"}>>',
      ),
    ]);
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

function textPart(text: string): ToolResultPart {
  return { type: "text", text };
}

function textParts(result: string | ToolResultPart[]): string[] {
  if (typeof result === "string") return [result];
  return result.filter((part) => part.type === "text").map((part) => part.text);
}
