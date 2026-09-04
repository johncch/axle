import type {
  AgentConfig,
  AgentDefinition,
  AgentSession,
  AxleFailure,
  CompactionConfig,
  Span,
  Stats,
  Turn,
  TurnEvent,
} from "@fifthrevision/axle";
import {
  addStats,
  Agent,
  AxleAgentAbortError,
  Instruct,
  loadFileContent,
  PromptCompactor,
  Transcript,
} from "@fifthrevision/axle";
import { ModelInfo } from "@fifthrevision/axle/models";
import { glob } from "glob";
import { readFile } from "node:fs/promises";
import { capitalize } from "../ui/format.js";
import type { BatchProgress, BatchTotals, Renderer } from "../ui/index.js";
import type { LedgerEntry } from "./ledger.js";
import { appendLedgerEntry, computeHash, ledgerKey, loadLedger } from "./ledger.js";
import { SessionStore } from "./sessions.js";

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
  initial?: Instruct | string;
  /** Continue with the chat loop after the initial send. */
  interactive: boolean;
  /** Automatic context compaction; on unless the recipe says `compaction: false`. */
  compaction?: boolean;
}

const ASSUMED_CONTEXT_WINDOW = 200_000;

function contextWindowFor(agent: Agent, providerLimit?: number): number {
  const override = Number(process.env.AXLE_CONTEXT_WINDOW);
  if (Number.isInteger(override) && override > 0) return override;
  if (providerLimit) return providerLimit;
  // Registry ids are publisher-qualified; Gemini's publisher key is "google".
  const publisher =
    agent.provider.name.toLowerCase() === "gemini" ? "google" : agent.provider.name.toLowerCase();
  return (
    ModelInfo[agent.model]?.contextWindow ??
    ModelInfo[`${publisher}/${agent.model}`]?.contextWindow ??
    ASSUMED_CONTEXT_WINDOW
  );
}

const COMPACTION_THRESHOLD_FRACTION = 0.8;
const COMPACTION_SUMMARY_WORDS = 1_000;

const COMPACTION_PROMPT = [
  "You summarize an agent conversation so it can continue in a smaller context.",
  "Preserve durable facts, decisions, constraints, file paths, tool outcomes,",
  "completed work, and open tasks. Prefer concrete identifiers over prose.",
].join(" ");

/** Session compaction policy; normative in docs/architecture/cli.md. */
export function createSessionCompaction(agent: Agent): CompactionConfig {
  const window = contextWindowFor(agent);
  const compactor = new PromptCompactor({
    provider: agent.provider,
    model: agent.model,
    prompt: COMPACTION_PROMPT,
    thresholdTokens: Math.floor(window * COMPACTION_THRESHOLD_FRACTION),
    summaryWords: COMPACTION_SUMMARY_WORDS,
    reasoning: agent.requestOptions.reasoning,
  });
  return {
    compact: compactor.compact,
    shouldCompactOnTrigger: compactor.shouldCompactOnTrigger,
    triggers: { beforeTurn: true },
  };
}

class SessionRuntime {
  readonly agent: Agent;
  readonly transcript: Transcript;

  private readonly sessionStore?: SessionStore;
  private readonly span: Span;
  private persisted: boolean;

  constructor(options: {
    agentConfig: AgentConfig;
    span: Span;
    compaction?: boolean;
    session?: AgentSession;
    priorTurns?: readonly Turn[];
    sessionStore?: SessionStore;
    onEvent: (event: TurnEvent, transcript: Transcript) => void;
  }) {
    this.agent = new Agent(
      { ...options.agentConfig, observability: { trace: options.span } },
      options.session,
    );
    if (options.compaction !== false) {
      this.agent.setCompaction(createSessionCompaction(this.agent));
    }
    this.transcript = new Transcript(options.priorTurns ?? []);
    this.sessionStore = options.sessionStore;
    this.span = options.span;
    this.persisted = Boolean(options.session);
    this.agent.on((event) => {
      this.transcript.apply(event);
      options.onEvent(event, this.transcript);
    });
  }

  async save(): Promise<boolean> {
    if (!this.sessionStore) return false;
    try {
      await this.sessionStore.save(await this.agent.snapshot(), this.transcript.turns);
      this.persisted = true;
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.span.warn(`Failed to save session: ${message}`);
      return false;
    }
  }

  resumeCommand(short = false): string | undefined {
    if (!this.persisted) return undefined;
    const id = short ? this.agent.sessionId.slice(0, 8) : this.agent.sessionId;
    return `axle resume ${id}`;
  }
}

export async function runAgentSession(
  spec: AgentSessionSpec,
  stats: Stats,
  parentSpan: Span,
  renderer: Renderer,
  sessionStore?: SessionStore,
): Promise<boolean> {
  const runSpan = parentSpan.startSpan(spec.spanName, { type: "workflow" });
  const runtime = new SessionRuntime({
    agentConfig: spec.agentConfig,
    span: runSpan,
    compaction: spec.compaction,
    session: spec.session,
    priorTurns: spec.priorTurns,
    sessionStore,
    onEvent: (event, transcript) => renderer.onEvent(event, transcript),
  });
  const { agent } = runtime;

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

  // A resumed session starts clean; a new one is dirty so even a send-less
  // chat leaves a file behind (the resume hint printed on exit must be true).
  let dirty = !spec.session;
  const saveSession = async () => {
    if (!sessionStore || !dirty) return;
    if (await runtime.save()) {
      dirty = false;
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

  const reportUsage = () => {
    const context = agent.context();
    const contextLimit = contextWindowFor(agent, context.limit);
    renderer.updateUsage({
      in: stats.in,
      out: stats.out,
      contextTokens: context.total,
      contextLimit,
    });
  };
  reportUsage();
  agent.on((event) => {
    if (event.type === "compaction:complete") reportUsage();
  });

  const sendMessage = async (message: Instruct | string): Promise<boolean> => {
    dirty = true;
    try {
      const result = await agent.send(message, { signal: controller.signal }).final;

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
    const resumeCommand = runtime.resumeCommand();
    if (sessionStore && resumeCommand) {
      const line = `Resume this session:\n${resumeCommand}`;
      renderer.info(line);
      parentSpan.info(line);
    }
  }
}

export interface BatchRunSpec {
  task: string;
  files?: string[];
  definition: AgentDefinition;
  agentConfig: AgentConfig;
  /** Globs or literal paths; unioned, deduped, sorted. */
  inputs: string[];
  concurrency: number;
  /** Ledger scope; entries are keyed (job, input). */
  jobName: string;
  /** Skip completed inputs whose content is unchanged. */
  incremental: boolean;
  /** Stream full item transcripts through the renderer (concurrency 1). */
  verbose: boolean;
  /** Automatic context compaction; on unless the recipe says `compaction: false`. */
  compaction?: boolean;
  /** Session home override for tests. */
  home?: string;
}

export async function runBatch(
  spec: BatchRunSpec,
  variables: Record<string, any>,
  stats: Stats,
  parentSpan: Span,
  renderer: Renderer,
  progress?: BatchProgress,
): Promise<boolean> {
  const matched = await Promise.all(spec.inputs.map((pattern) => glob(pattern)));
  const filePaths = [...new Set(matched.flat())].sort();

  if (filePaths.length === 0) {
    const warning = `No files matched: ${spec.inputs.join(" ")}`;
    renderer.warn(warning);
    parentSpan.warn(warning);
    return true;
  }

  const header = `Batch: ${filePaths.length} input(s) matched "${spec.inputs.join(" ")}"`;
  renderer.info(header);
  parentSpan.info(header);

  const ledger: Map<string, LedgerEntry> = spec.incremental ? await loadLedger() : new Map();

  const sharedFiles = spec.files
    ? await Promise.all(spec.files.map((fp) => loadFileContent(fp)))
    : [];

  let completed = 0;
  let skipped = 0;
  let failed = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  const totals = (): BatchTotals => ({
    total: filePaths.length,
    completed,
    skipped,
    failed,
    tokensIn,
    tokensOut,
  });
  progress?.batchStarted(totals());

  const controller = new AbortController();
  const onInterrupt = () => {
    renderer.warn("Cancelling batch…");
    controller.abort();
  };
  process.on("SIGINT", onInterrupt);
  renderer.setInterruptHandler(onInterrupt);

  try {
    await runWithConcurrency(spec.concurrency, filePaths, async (batchFilePath) => {
      if (controller.signal.aborted) return;
      const itemSpan = parentSpan.startSpan(`batch:${batchFilePath}`, {
        type: "workflow",
      });

      let hash: string;
      try {
        hash = computeHash(await readFile(batchFilePath));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        renderer.error(`${batchFilePath}: failed — ${msg}`);
        itemSpan.error(`Failed: ${msg}`);
        itemSpan.end("error");
        failed++;
        progress?.itemFinished(batchFilePath, totals());
        return;
      }

      const existing = ledger.get(ledgerKey(spec.jobName, batchFilePath));
      if (spec.incremental && existing?.status === "completed" && existing.hash === hash) {
        renderer.info(`${batchFilePath}: unchanged — skipped`);
        itemSpan.info("Skipped (already completed)");
        itemSpan.end();
        skipped++;
        progress?.itemFinished(batchFilePath, totals());
        return;
      }

      // One session per input: every batch item is an ordinary resumable run.
      const sessionStore = new SessionStore(spec.definition, {
        home: spec.home,
        compaction: spec.compaction,
      });
      progress?.itemStarted(batchFilePath);
      const runtime = new SessionRuntime({
        agentConfig: spec.agentConfig,
        span: itemSpan,
        compaction: spec.compaction,
        sessionStore,
        onEvent: (event, transcript) => {
          if (spec.verbose) {
            renderer.onEvent(event, transcript);
          } else if (progress && event.type === "part:start") {
            const part = event.part;
            const phase =
              part.type === "action"
                ? capitalize(part.detail.name)
                : part.type === "thinking"
                  ? "Thinking"
                  : part.type === "text"
                    ? "Writing"
                    : undefined;
            if (phase) progress.itemPhase(batchFilePath, phase);
          }
        },
      });
      const { agent } = runtime;

      const recordFailure = async (hashValue: string, message: string) => {
        await appendLedgerEntry({
          job: spec.jobName,
          file: batchFilePath,
          hash: hashValue,
          sessionId: agent.sessionId,
          status: "failed",
          timestamp: Date.now(),
        });
        const resumeCommand = runtime.resumeCommand(true);
        renderer.error(
          `${batchFilePath}: failed — ${message}${resumeCommand ? ` (${resumeCommand})` : ""}`,
        );
        itemSpan.error(`Failed: ${message}`);
        itemSpan.end("error");
        failed++;
        progress?.itemFinished(batchFilePath, totals());
      };

      try {
        const instruct = new Instruct({ prompt: spec.task });
        for (const fi of sharedFiles) {
          instruct.addFile(fi);
        }
        instruct.addFile(await loadFileContent(batchFilePath));

        const result = await agent.send(
          instruct.withInputs({ ...variables, file: batchFilePath }),
          {
            signal: controller.signal,
          },
        ).final;

        addStats(stats, result.usage);
        tokensIn += result.usage.in;
        tokensOut += result.usage.out;
        await runtime.save();

        if (!result.ok) {
          await recordFailure(hash, describeFailure(result.error));
          return;
        }

        await appendLedgerEntry({
          job: spec.jobName,
          file: batchFilePath,
          hash,
          sessionId: agent.sessionId,
          status: "completed",
          timestamp: Date.now(),
        });
        const resumeCommand = runtime.resumeCommand(true);
        renderer.success(`${batchFilePath}: done${resumeCommand ? ` (${resumeCommand})` : ""}`);
        itemSpan.end();
        completed++;
        progress?.itemFinished(batchFilePath, totals());
      } catch (e) {
        await runtime.save();
        if (e instanceof AxleAgentAbortError) {
          itemSpan.end("cancelled");
          failed++;
          progress?.itemFinished(batchFilePath, totals());
          return;
        }
        await recordFailure(hash, e instanceof Error ? e.message : String(e));
      }
    });
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    renderer.setInterruptHandler(undefined);
  }

  const aborted = controller.signal.aborted;
  const summary = `Batch complete: ${completed} completed, ${skipped} skipped, ${failed} failed${aborted ? " (cancelled)" : ""}`;
  renderer.info(summary);
  parentSpan.info(summary);
  return failed === 0 && !aborted;
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
