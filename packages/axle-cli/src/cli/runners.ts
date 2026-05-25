import type { AgentConfig, Stats, TracingContext } from "@fifthrevision/axle";
import { addStats, Agent, Instruct, loadFileContent } from "@fifthrevision/axle";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { BatchConfig } from "./configs/schemas.js";
import { appendLedgerEntry, computeHash, loadLedger } from "./ledger.js";

export interface CliJobInput {
  task: string;
  files?: string[];
}

export interface ProgramOptions {
  job?: string;
  log?: boolean;
  debug?: boolean;
  interactive?: boolean;
  args?: string[];
}

export async function runSingle(
  input: CliJobInput,
  agentConfig: AgentConfig,
  variables: Record<string, any>,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: TracingContext,
) {
  const instruct = new Instruct({ prompt: input.task });
  if (input.files) {
    for (const filePath of input.files) {
      instruct.addFile(await loadFileContent(filePath));
    }
  }

  const jobSpan = parentSpan.startSpan("job", { type: "workflow" });
  const agent = new Agent({
    ...agentConfig,
    tracer: jobSpan,
  });

  try {
    const result = await agent.send(instruct.withInputs(variables)).final;

    addStats(stats, result.usage);

    if (result.response) {
      const text = result.response;
      parentSpan.info(text, { markdown: true });
    }

    if (options.interactive) {
      await runInteractiveLoop(agent, stats, parentSpan);
    }

    jobSpan.end();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    jobSpan.error(msg);
    jobSpan.end("error");
    throw e;
  }
}

async function runInteractiveLoop(
  agent: Agent,
  stats: Stats,
  tracer: TracingContext,
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("SIGINT", () => {
    rl.close();
  });

  const prompt = (query: string): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question(query, resolve);
      rl.once("close", () => resolve(null));
    });

  try {
    while (true) {
      const input = await prompt("\n> ");
      if (input === null || input.trim() === "") break;

      try {
        const result = await agent.send(input.trim()).final;

        addStats(stats, result.usage);

        if (result.response) {
          const text = result.response;
          tracer.info(text, { markdown: true });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        tracer.error(msg);
      }
    }
  } finally {
    rl.close();
  }
}

export async function runBatch(
  input: CliJobInput,
  batchConfig: BatchConfig,
  agentConfig: AgentConfig,
  variables: Record<string, any>,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: TracingContext,
) {
  const filePaths = await glob(batchConfig.files);

  if (filePaths.length === 0) {
    parentSpan.warn(`No files matched pattern: ${batchConfig.files}`);
    return;
  }

  parentSpan.info(`Batch: ${filePaths.length} file(s) matched "${batchConfig.files}"`);

  const ledger = batchConfig.resume ? await loadLedger() : new Map();

  const sharedFiles = input.files
    ? await Promise.all(input.files.map((fp) => loadFileContent(fp)))
    : [];

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  const concurrency = batchConfig.concurrency ?? 3;

  await runWithConcurrency(concurrency, filePaths, async (batchFilePath) => {
    const itemSpan = parentSpan.startSpan(`batch:${batchFilePath}`, { type: "workflow" });

    try {
      const rawContent = await readFile(batchFilePath);
      const hash = computeHash(input.task, rawContent);

      const existing = ledger.get(batchFilePath);
      if (batchConfig.resume && existing && existing.hash === hash) {
        itemSpan.info(`Skipped (already completed)`);
        itemSpan.end();
        skipped++;
        return;
      }

      const instruct = new Instruct({ prompt: input.task });

      for (const fi of sharedFiles) {
        instruct.addFile(fi);
      }

      instruct.addFile(await loadFileContent(batchFilePath));

      const itemVars = { ...variables, file: batchFilePath };

      const agent = new Agent({
        ...agentConfig,
        tracer: itemSpan,
      });
      const result = await agent.send(instruct.withInputs(itemVars)).final;

      addStats(stats, result.usage);

      await appendLedgerEntry({ file: batchFilePath, hash, timestamp: Date.now() });
      itemSpan.end();
      completed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      itemSpan.error(`Failed: ${msg}`);
      itemSpan.end("error");
      failed++;
    }
  });

  parentSpan.info(`Batch complete: ${completed} completed, ${skipped} skipped, ${failed} failed`);
}

async function runWithConcurrency<T>(
  limit: number,
  items: T[],
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
}
