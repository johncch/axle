import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { Agent } from "../core/Agent.js";
import { Instruct } from "../core/Instruct.js";
import type { AIProvider } from "../providers/types.js";
import type { Tool } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { loadFileContent } from "../utils/file.js";
import type { JobConfig } from "./configs/schemas.js";
import { appendLedgerEntry, computeHash, loadLedger } from "./ledger.js";

export async function runSingle(
  jobConfig: JobConfig,
  provider: AIProvider,
  model: string,
  tools: Tool[],
  variables: Record<string, any>,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: TracingContext,
) {
  const instruct = new Instruct(jobConfig.task);
  if (tools.length > 0) instruct.addTools(tools);
  if (jobConfig.files) {
    for (const filePath of jobConfig.files) {
      instruct.addFile(await loadFileContent(filePath));
    }
  }

  const jobSpan = parentSpan.startSpan("job", { type: "workflow" });
  const agent = new Agent(instruct, { provider, model, tracer: jobSpan });
  const result = await agent.start(variables).final;
  jobSpan.end();

  stats.in += result.usage.in;
  stats.out += result.usage.out;

  if (result.response) {
    parentSpan.info("Response: " + JSON.stringify(result.response, null, 2));
  }
}

export async function runBatch(
  jobConfig: JobConfig,
  provider: AIProvider,
  model: string,
  tools: Tool[],
  variables: Record<string, any>,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: TracingContext,
) {
  const batchConfig = jobConfig.batch!;
  const filePaths = await glob(batchConfig.files);

  if (filePaths.length === 0) {
    parentSpan.warn(`No files matched pattern: ${batchConfig.files}`);
    return;
  }

  parentSpan.info(`Batch: ${filePaths.length} file(s) matched "${batchConfig.files}"`);

  const ledger = batchConfig.resume ? await loadLedger() : new Map();

  const sharedFiles = jobConfig.files
    ? await Promise.all(jobConfig.files.map((fp) => loadFileContent(fp)))
    : [];

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  const concurrency = batchConfig.concurrency ?? 3;

  await runWithConcurrency(concurrency, filePaths, async (batchFilePath) => {
    const itemSpan = parentSpan.startSpan(`batch:${batchFilePath}`, { type: "workflow" });

    try {
      const rawContent = await readFile(batchFilePath);
      const hash = computeHash(jobConfig.task, rawContent);

      const existing = ledger.get(batchFilePath);
      if (batchConfig.resume && existing && existing.hash === hash) {
        itemSpan.info(`Skipped (already completed)`);
        itemSpan.end();
        skipped++;
        return;
      }

      const instruct = new Instruct(jobConfig.task);
      if (tools.length > 0) instruct.addTools(tools);

      for (const fi of sharedFiles) {
        instruct.addFile(fi);
      }

      instruct.addFile(await loadFileContent(batchFilePath));

      const itemVars = { ...variables, file: batchFilePath };

      const agent = new Agent(instruct, { provider, model, tracer: itemSpan });
      const result = await agent.start(itemVars).final;

      stats.in += result.usage.in;
      stats.out += result.usage.out;

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
