import type {
  AgentConfig,
  AgentSession,
  AxleFailure,
  Span,
  Stats,
  Turn,
} from "@fifthrevision/axle";
import {
  addStats,
  Agent,
  AxleAgentAbortError,
  Instruct,
  loadFileContent,
  Transcript,
} from "@fifthrevision/axle";
import { ModelInfo } from "@fifthrevision/axle/models";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import type { Renderer } from "../ui/index.js";
import type { BatchConfig } from "./configs/schemas.js";
import { appendLedgerEntry, computeHash, loadLedger } from "./ledger.js";
import type { SessionStore } from "./sessions.js";

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

export interface AgentSessionSpec {
  agentConfig: AgentConfig;
  spanName: "job" | "resume" | "chat";
  /** Saved continuation state; presence means this run resumes a session. */
  session?: AgentSession;
  /** Saved turns to replay before the first send. */
  priorTurns?: readonly Turn[];
  /** The cwd recorded when the session was created, for the mismatch warning. */
  resumedFromCwd?: string;
  /** First message to send; absent drops straight into the chat loop. */
  initial?: Instruct<any> | string;
  /** Continue with the chat loop after the initial send. */
  interactive: boolean;
}

export async function runAgentSession(
  spec: AgentSessionSpec,
  stats: Stats,
  parentSpan: Span,
  renderer: Renderer,
  sessionStore?: SessionStore,
): Promise<boolean> {
  const runSpan = parentSpan.startSpan(spec.spanName, { type: "workflow" });
  const agent = new Agent(
    {
      ...spec.agentConfig,
      observability: { trace: runSpan },
    },
    spec.session,
  );

  const transcript = new Transcript(spec.priorTurns ?? []);
  agent.on((event) => {
    transcript.apply(event);
    renderer.onEvent(event, transcript);
  });

  const controller = new AbortController();
  let sigintCount = 0;
  const onInterrupt = () => {
    sigintCount += 1;
    if (sigintCount === 1 && agent.stop()) {
      renderer.warn("Finishing the current step — Ctrl-C again to cancel now");
    } else {
      controller.abort();
    }
  };
  process.on("SIGINT", onInterrupt);
  renderer.setInterruptHandler(onInterrupt);

  const saveSession = async () => {
    if (!sessionStore) return;
    try {
      await sessionStore.save(await agent.snapshot(), transcript.turns);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      parentSpan.warn(`Failed to save session: ${msg}`);
    }
  };

  if (spec.session) {
    const line = `Resuming session ${agent.sessionId}`;
    renderer.info(line);
    parentSpan.info(line);
    if (spec.resumedFromCwd && spec.resumedFromCwd !== process.cwd()) {
      const warning = `Session was started in ${spec.resumedFromCwd}; resuming from ${process.cwd()}`;
      renderer.warn(warning);
      parentSpan.warn(warning);
    }
  } else if (sessionStore) {
    const line = `Session ${agent.sessionId}`;
    renderer.info(line);
    parentSpan.info(line);
  }
  if (spec.priorTurns?.length) {
    renderer.renderPriorTurns(spec.priorTurns);
  }

  // Assumption for models the registry doesn't know.
  const ASSUMED_CONTEXT_WINDOW = 200_000;
  // Registry ids are publisher-qualified; Gemini's publisher key is "google".
  const publisher =
    agent.provider.name.toLowerCase() === "gemini" ? "google" : agent.provider.name.toLowerCase();
  const reportUsage = () => {
    const context = agent.context();
    const contextLimit =
      context.limit ??
      ModelInfo[agent.model]?.contextWindow ??
      ModelInfo[`${publisher}/${agent.model}`]?.contextWindow ??
      ASSUMED_CONTEXT_WINDOW;
    renderer.updateUsage({
      in: stats.in,
      out: stats.out,
      contextTokens: context.total,
      contextLimit,
    });
  };
  reportUsage();

  const sendMessage = async (message: Instruct<any> | string): Promise<boolean> => {
    try {
      const result = await agent.send(message as string, { signal: controller.signal }).final;

      addStats(stats, result.usage);
      reportUsage();

      if (!result.ok) {
        const msg = describeFailure(result.error);
        renderer.error(msg);
        parentSpan.error(msg);
        runSpan.error(msg);
        return false;
      }

      parentSpan.info(result.response, { markdown: true });
      return true;
    } finally {
      sigintCount = 0;
    }
  };

  try {
    if (spec.initial !== undefined) {
      const ok = await sendMessage(spec.initial);
      await saveSession();
      if (!ok) {
        runSpan.end("error");
        return false;
      }
    }

    if (spec.interactive) {
      while (true) {
        const input = await renderer.promptInput();
        if (input === null) break;
        const text = input.trim();
        if (text === "") continue;
        if (text === "/quit") break;

        try {
          await sendMessage(text);
        } catch (e) {
          if (e instanceof AxleAgentAbortError) {
            renderer.warn("Interrupted");
            parentSpan.warn("Interrupted");
            break;
          }
          const msg = e instanceof Error ? e.message : String(e);
          renderer.error(msg);
          parentSpan.error(msg);
        }
        await saveSession();
      }
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
    process.removeListener("SIGINT", onInterrupt);
    renderer.setInterruptHandler(undefined);
    await saveSession();
    if (sessionStore) {
      const line = `Resume this session:\naxle --session ${agent.sessionId}`;
      renderer.info(line);
      parentSpan.info(line);
    }
  }
}

export async function runBatch(
  input: CliJobInput,
  batchConfig: BatchConfig,
  agentConfig: AgentConfig,
  variables: Record<string, any>,
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
      renderer.success(`${batchFilePath}: done`);
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
