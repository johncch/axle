import type { AgentConfig, AxleFailure, Span, Stats } from "@fifthrevision/axle";
import {
  addStats,
  Agent,
  AxleAgentAbortError,
  Instruct,
  loadFileContent,
  Transcript,
} from "@fifthrevision/axle";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { BatchConfig } from "./configs/schemas.js";
import { appendLedgerEntry, computeHash, loadLedger } from "./ledger.js";
import type { CliSessionFile, SessionStore } from "./sessions.js";
import type { Renderer } from "../ui/index.js";

export interface CliJobInput {
  task: string;
  files?: string[];
}

export interface ProgramOptions {
  job?: string;
  session?: string;
  message?: string;
  log?: boolean;
  debug?: boolean;
  interactive?: boolean;
  args?: string[];
}

function describeFailure(failure: AxleFailure): string {
  switch (failure.kind) {
    case "model":
      return `Model error: ${failure.message}`;
    case "tool":
      return `Tool error (${failure.error.name}): ${failure.message}`;
    case "parse":
      return `Parse error: ${failure.message}`;
  }
}

export async function runSingle(
  input: CliJobInput,
  agentConfig: AgentConfig,
  variables: Record<string, any>,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: Span,
  renderer: Renderer,
  sessionStore?: SessionStore,
): Promise<boolean> {
  const instruct = new Instruct({ prompt: input.task });
  if (input.files) {
    for (const filePath of input.files) {
      instruct.addFile(await loadFileContent(filePath));
    }
  }

  const jobSpan = parentSpan.startSpan("job", { type: "workflow" });
  const agent = new Agent({
    ...agentConfig,
    observability: { trace: jobSpan },
  });

  const transcript = new Transcript();
  agent.on((event) => {
    transcript.apply(event);
    renderer.onEvent(event, transcript);
  });

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  const saveSession = async () => {
    if (!sessionStore) return;
    try {
      await sessionStore.save(await agent.snapshot(), transcript.turns);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      parentSpan.warn(`Failed to save session: ${msg}`);
    }
  };

  if (sessionStore) {
    const line = `Session ${agent.sessionId} — resume with: axle --session ${agent.sessionId}`;
    renderer.info(line);
    parentSpan.info(line);
  }

  try {
    const result = await agent.send(instruct.withInputs(variables), {
      signal: controller.signal,
    }).final;

    addStats(stats, result.usage);

    if (!result.ok) {
      const msg = describeFailure(result.error);
      renderer.error(msg);
      parentSpan.error(msg);
      jobSpan.error(msg);
      jobSpan.end("error");
      return false;
    }

    await saveSession();
    parentSpan.info(result.response, { markdown: true });

    if (options.interactive) {
      await runInteractiveLoop(agent, stats, parentSpan, renderer, controller, saveSession);
    }

    jobSpan.end();
    return true;
  } catch (e) {
    if (e instanceof AxleAgentAbortError) {
      renderer.warn("Interrupted");
      parentSpan.warn("Interrupted");
      jobSpan.end("cancelled");
      return false;
    }
    const msg = e instanceof Error ? e.message : String(e);
    jobSpan.error(msg);
    jobSpan.end("error");
    throw e;
  } finally {
    process.removeListener("SIGINT", onSigint);
    await saveSession();
    if (sessionStore) {
      const line = `Resume this session with: axle --session ${agent.sessionId}`;
      renderer.info(line);
      parentSpan.info(line);
    }
  }
}

export async function runResume(
  saved: CliSessionFile,
  agentConfig: AgentConfig,
  options: ProgramOptions,
  stats: Stats,
  parentSpan: Span,
  renderer: Renderer,
  sessionStore: SessionStore,
): Promise<boolean> {
  const runSpan = parentSpan.startSpan("resume", { type: "workflow" });
  const agent = new Agent(
    {
      ...agentConfig,
      observability: { trace: runSpan },
    },
    saved.session,
  );

  const transcript = new Transcript(saved.turns);
  agent.on((event) => {
    transcript.apply(event);
    renderer.onEvent(event, transcript);
  });

  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.on("SIGINT", onSigint);

  const saveSession = async () => {
    try {
      await sessionStore.save(await agent.snapshot(), transcript.turns);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      parentSpan.warn(`Failed to save session: ${msg}`);
    }
  };

  if (saved.cwd !== process.cwd()) {
    const warning = `Session was started in ${saved.cwd}; resuming from ${process.cwd()}`;
    renderer.warn(warning);
    parentSpan.warn(warning);
  }
  renderer.info(`Resuming session ${agent.sessionId}`);
  parentSpan.info(`Resuming session ${agent.sessionId}`);
  renderer.renderPriorTurns(saved.turns);

  try {
    if (options.message !== undefined) {
      const result = await agent.send(options.message, { signal: controller.signal }).final;

      addStats(stats, result.usage);

      if (!result.ok) {
        const msg = describeFailure(result.error);
        renderer.error(msg);
        parentSpan.error(msg);
        runSpan.error(msg);
        runSpan.end("error");
        return false;
      }

      parentSpan.info(result.response, { markdown: true });
    } else {
      await runInteractiveLoop(agent, stats, parentSpan, renderer, controller, saveSession);
    }

    runSpan.end();
    return true;
  } catch (e) {
    if (e instanceof AxleAgentAbortError) {
      renderer.warn("Interrupted");
      parentSpan.warn("Interrupted");
      runSpan.end("cancelled");
      return false;
    }
    const msg = e instanceof Error ? e.message : String(e);
    runSpan.error(msg);
    runSpan.end("error");
    throw e;
  } finally {
    process.removeListener("SIGINT", onSigint);
    await saveSession();
    const line = `Resume this session with: axle --session ${agent.sessionId}`;
    renderer.info(line);
    parentSpan.info(line);
  }
}

async function runInteractiveLoop(
  agent: Agent,
  stats: Stats,
  span: Span,
  renderer: Renderer,
  controller: AbortController,
  saveSession: () => Promise<void>,
): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.on("SIGINT", () => {
    controller.abort();
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
        const result = await agent.send(input.trim(), { signal: controller.signal }).final;

        addStats(stats, result.usage);

        if (result.ok) {
          span.info(result.response, { markdown: true });
        } else {
          const msg = describeFailure(result.error);
          renderer.error(msg);
          span.error(msg);
        }
      } catch (e) {
        if (e instanceof AxleAgentAbortError) {
          renderer.warn("Interrupted");
          span.warn("Interrupted");
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        renderer.error(msg);
        span.error(msg);
      }
      await saveSession();
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
  parentSpan: Span,
  renderer: Renderer,
): Promise<boolean> {
  const filePaths = await glob(batchConfig.files);

  if (filePaths.length === 0) {
    const warning = `No files matched pattern: ${batchConfig.files}`;
    renderer.warn(warning);
    parentSpan.warn(warning);
    return true;
  }

  const header = `Batch: ${filePaths.length} file(s) matched "${batchConfig.files}"`;
  renderer.info(header);
  parentSpan.info(header);

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
        renderer.info(`- ${batchFilePath}: skipped (already completed)`);
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
        observability: { trace: itemSpan },
      });
      const result = await agent.send(instruct.withInputs(itemVars)).final;

      addStats(stats, result.usage);

      if (!result.ok) {
        renderer.error(`- ${batchFilePath}: failed — ${describeFailure(result.error)}`);
        itemSpan.error(`Failed: ${describeFailure(result.error)}`);
        itemSpan.end("error");
        failed++;
        return;
      }

      await appendLedgerEntry({ file: batchFilePath, hash, timestamp: Date.now() });
      renderer.info(`- ${batchFilePath}: done`);
      itemSpan.end();
      completed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      renderer.error(`- ${batchFilePath}: failed — ${msg}`);
      itemSpan.error(`Failed: ${msg}`);
      itemSpan.end("error");
      failed++;
    }
  });

  const summary = `Batch complete: ${completed} completed, ${skipped} skipped, ${failed} failed`;
  renderer.info(summary);
  parentSpan.info(summary);
  return failed === 0;
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
