import type { AgentDefinition, AIProvider } from "@fifthrevision/axle";
import { AxleStopReason, createStats, Tracer } from "@fifthrevision/axle";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLedger } from "../../src/cli/ledger.js";
import { runBatch } from "../../src/cli/runners.js";
import type { Renderer } from "../../src/ui/index.js";

const TEST_DIR = join(import.meta.dirname, "__batch_tmp__");
const HOME = join(TEST_DIR, "home");
const INPUTS = join(TEST_DIR, "inputs");
const ORIGINAL_CWD = process.cwd();

const definition: AgentDefinition = {
  version: 1,
  provider: { type: "anthropic" },
  model: "anthropic/test-model",
};

function createRecordingRenderer() {
  const lines: string[] = [];
  const renderer: Renderer = {
    renderPriorTurns() {},
    onEvent() {},
    info: (m) => void lines.push(m),
    success: (m) => void lines.push(m),
    warn: (m) => void lines.push(m),
    error: (m) => void lines.push(m),
    promptInput: () => Promise.resolve(null),
    updateUsage() {},
    setInterruptHandler() {},
    close() {},
  };
  return { renderer, lines };
}

function createMockProvider(options?: { failOnCall?: number }): AIProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest() {
      callIndex += 1;
      if (callIndex === options?.failOnCall) {
        throw new Error("boom");
      }
      yield {
        type: "start" as const,
        id: `mock-${callIndex}`,
        data: { model: "mock", timestamp: 0 },
      };
      yield { type: "text-start" as const, data: { index: 0 } };
      yield { type: "text-delta" as const, data: { index: 0, text: "ok" } };
      yield { type: "text-complete" as const, data: { index: 0 } };
      yield {
        type: "complete" as const,
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
      };
    },
  };
}

function batchSpec(provider: AIProvider, options?: { incremental?: boolean }) {
  return {
    task: "Process {{file}}",
    definition,
    agentConfig: { provider, model: "test-model" },
    inputs: [join(INPUTS, "*.md")],
    concurrency: 1,
    jobName: "test-job",
    incremental: options?.incremental ?? false,
    home: HOME,
  };
}

beforeEach(async () => {
  await mkdir(INPUTS, { recursive: true });
  await mkdir(join(TEST_DIR, "cwd"), { recursive: true });
  process.chdir(join(TEST_DIR, "cwd"));
  await writeFile(join(INPUTS, "a.md"), "alpha content");
  await writeFile(join(INPUTS, "b.md"), "beta content");
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("runBatch (--each fan-out)", () => {
  it("runs one session per input and indexes them in the ledger", async () => {
    const { renderer } = createRecordingRenderer();
    const tracer = new Tracer();

    const succeeded = await runBatch(
      batchSpec(createMockProvider()),
      {},
      createStats(),
      tracer.startSpan("batch"),
      renderer,
    );

    expect(succeeded).toBe(true);

    const ledger = await loadLedger();
    expect(ledger.size).toBe(2);
    const entries = [...ledger.values()];
    expect(entries.every((e) => e.status === "completed")).toBe(true);
    expect(new Set(entries.map((e) => e.sessionId)).size).toBe(2);

    const sessionFiles = await readdir(join(HOME, ".axle", "sessions", "cli"));
    expect(sessionFiles.sort()).toEqual(entries.map((e) => `${e.sessionId}.json`).sort());

    const saved = JSON.parse(
      await readFile(join(HOME, ".axle", "sessions", "cli", sessionFiles[0]), "utf-8"),
    );
    expect(saved.definition).toEqual(definition);
    expect(saved.session.messages).toHaveLength(2);
  });

  it("--incremental skips unchanged completed inputs on re-run", async () => {
    const tracer = new Tracer();
    await runBatch(
      batchSpec(createMockProvider()),
      {},
      createStats(),
      tracer.startSpan("first"),
      createRecordingRenderer().renderer,
    );

    const { renderer, lines } = createRecordingRenderer();
    const succeeded = await runBatch(
      batchSpec(createMockProvider(), { incremental: true }),
      {},
      createStats(),
      tracer.startSpan("second"),
      renderer,
    );

    expect(succeeded).toBe(true);
    expect(lines.filter((l) => l.includes("unchanged — skipped"))).toHaveLength(2);
    expect(lines.at(-1)).toContain("0 completed, 2 skipped, 0 failed");
  });

  it("a plain re-run skips nothing — it is the force-fresh gesture", async () => {
    const tracer = new Tracer();
    await runBatch(
      batchSpec(createMockProvider()),
      {},
      createStats(),
      tracer.startSpan("first"),
      createRecordingRenderer().renderer,
    );

    const { renderer, lines } = createRecordingRenderer();
    const succeeded = await runBatch(
      batchSpec(createMockProvider()),
      {},
      createStats(),
      tracer.startSpan("second"),
      renderer,
    );

    expect(succeeded).toBe(true);
    expect(lines.at(-1)).toContain("2 completed, 0 skipped, 0 failed");
  });

  it("--incremental re-runs an input whose content changed", async () => {
    const tracer = new Tracer();
    await runBatch(
      batchSpec(createMockProvider()),
      {},
      createStats(),
      tracer.startSpan("first"),
      createRecordingRenderer().renderer,
    );
    await writeFile(join(INPUTS, "a.md"), "alpha content, revised");

    const { renderer, lines } = createRecordingRenderer();
    const succeeded = await runBatch(
      batchSpec(createMockProvider(), { incremental: true }),
      {},
      createStats(),
      tracer.startSpan("second"),
      renderer,
    );

    expect(succeeded).toBe(true);
    expect(lines.at(-1)).toContain("1 completed, 1 skipped, 0 failed");
  });

  it("--incremental does not skip another job's entries", async () => {
    const tracer = new Tracer();
    await runBatch(
      { ...batchSpec(createMockProvider()), jobName: "other-job" },
      {},
      createStats(),
      tracer.startSpan("first"),
      createRecordingRenderer().renderer,
    );

    const { renderer, lines } = createRecordingRenderer();
    const succeeded = await runBatch(
      batchSpec(createMockProvider(), { incremental: true }),
      {},
      createStats(),
      tracer.startSpan("second"),
      renderer,
    );

    expect(succeeded).toBe(true);
    expect(lines.at(-1)).toContain("2 completed, 0 skipped, 0 failed");
  });

  it("records a failed item with its session id for resumption", async () => {
    const { renderer, lines } = createRecordingRenderer();
    const tracer = new Tracer();

    const succeeded = await runBatch(
      batchSpec(createMockProvider({ failOnCall: 2 })),
      {},
      createStats(),
      tracer.startSpan("batch"),
      renderer,
    );

    expect(succeeded).toBe(false);

    const ledger = await loadLedger();
    const failedEntry = [...ledger.values()].find((e) => e.status === "failed");
    expect(failedEntry).toBeDefined();
    expect(lines.some((l) => l.includes(`axle resume ${failedEntry!.sessionId.slice(0, 8)}`))).toBe(
      true,
    );
    expect(lines.at(-1)).toContain("1 completed, 0 skipped, 1 failed");

    // The failed item's session is on disk, resumable like any other run.
    const sessionFiles = await readdir(join(HOME, ".axle", "sessions", "cli"));
    expect(sessionFiles).toContain(`${failedEntry!.sessionId}.json`);
  });
});
