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
    case "refusal": {
      const { text, category } = failure;
      const label = category ? `Refused (${category})` : "Refused";
      return text ? `${label}: ${text}` : label;
    }
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
  /** The model's context window in tokens; drives the compaction threshold and the usage bar. */
  contextWindow: number;
  /** The provider as the recipe named it (profile name or type), for the model line. */
  providerName?: string;
}

const COMPACTION_THRESHOLD_FRACTION = 0.8;
const COMPACTION_SUMMARY_WORDS = 1_000;

const COMPACTION_PROMPT = [
  "You summarize an agent conversation so it can continue in a smaller context.",
  "Preserve durable facts, decisions, constraints, file paths, tool outcomes,",
  "completed work, and open tasks. Prefer concrete identifiers over prose.",
].join(" ");

/** Session compaction policy; normative in docs/architecture/cli.md. */
export function createSessionCompaction(agent: Agent, contextWindow: number): CompactionConfig {
  const compactor = new PromptCompactor({
    provider: agent.provider,
    model: agent.model,
    prompt: COMPACTION_PROMPT,
    thresholdTokens: Math.floor(contextWindow * COMPACTION_THRESHOLD_FRACTION),
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
  private unsaved: boolean;
  private settledWrites: Promise<unknown> = Promise.resolve();

  constructor(options: {
    agentConfig: AgentConfig;
    span: Span;
    compaction?: boolean;
    contextWindow: number;
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
      this.agent.setCompaction(createSessionCompaction(this.agent, options.contextWindow));
    }
    this.transcript = new Transcript(options.priorTurns ?? []);
    this.sessionStore = options.sessionStore;
    this.span = options.span;
    this.persisted = Boolean(options.session);
    // A resumed session starts saved; a new one is unsaved so even a send-less
    // chat leaves a file behind (the resume hint printed on exit must be true).
    this.unsaved = !options.session;
    this.agent.on((event) => {
      this.transcript.apply(event);
      options.onEvent(event, this.transcript);
    });
  }

  async save(): Promise<boolean> {
    return this.write(await this.agent.snapshot(), this.transcript.turns);
  }

  saveOnSettle(): void {
    this.agent.onSettled((session) => {
      this.unsaved = true;
      const turns = [...this.transcript.turns];
      this.settledWrites = this.settledWrites.then(() => this.write(session, turns));
    });
  }

  async flush(): Promise<void> {
    await this.settledWrites;
  }

  async finishSaving(): Promise<void> {
    await this.settledWrites;
    if (this.unsaved) await this.save();
  }

  private async write(session: AgentSession, turns: readonly Turn[]): Promise<boolean> {
    if (!this.sessionStore) return false;
    try {
      await this.sessionStore.save(session, turns);
      this.persisted = true;
      this.unsaved = false;
      return true;
    } catch (e) {
      this.unsaved = true;
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

const CHAT_EXIT_WINDOW_MS = 1000;

type SendOutcome = "ok" | "failed" | "interrupted";

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
    contextWindow: spec.contextWindow,
    session: spec.session,
    priorTurns: spec.priorTurns,
    sessionStore,
    onEvent: (event, transcript) => renderer.onEvent(event, transcript),
  });
  const { agent } = runtime;

  const controller = new AbortController();
  const outstandingSends: { cancel: () => void }[] = [];
  let sigintCount = 0;
  let lastChatInterruptAt: number | undefined;
  const interruptRun = () => {
    sigintCount += 1;
    if (sigintCount === 1 && agent.stop()) {
      renderer.warn("Finishing the current step — Ctrl-C again to cancel now");
    } else {
      controller.abort();
    }
  };
  const interruptChat = () => {
    const activeSend = outstandingSends[0];
    const now = Date.now();
    const repeated =
      lastChatInterruptAt !== undefined && now - lastChatInterruptAt < CHAT_EXIT_WINDOW_MS;
    if (!activeSend || repeated) {
      controller.abort();
      return;
    }
    lastChatInterruptAt = now;
    activeSend.cancel();
    renderer.warn("Interrupted — Ctrl-C again to exit");
  };
  const onInterrupt = spec.interactive ? interruptChat : interruptRun;
  process.on("SIGINT", onInterrupt);
  renderer.setInterruptHandler(onInterrupt);

  runtime.saveOnSettle();

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
  const modelLine = spec.providerName
    ? `Model ${agent.model} · ${spec.providerName}`
    : `Model ${agent.model}`;
  renderer.info(modelLine);
  parentSpan.info(modelLine);
  if (spec.priorTurns?.length) {
    renderer.renderPriorTurns(spec.priorTurns);
  }

  const reportUsage = () => {
    renderer.updateUsage({
      in: stats.in,
      out: stats.out,
      contextTokens: agent.context().total,
      contextLimit: spec.contextWindow,
    });
  };
  reportUsage();
  agent.on((event) => {
    if (event.type === "compaction:complete") reportUsage();
  });

  const sendMessage = async (message: Instruct | string): Promise<SendOutcome> => {
    const handle = agent.send(message, { signal: controller.signal });
    outstandingSends.push(handle);
    try {
      const result = await handle.final;

      addStats(stats, result.usage);
      reportUsage();

      if (!result.ok) {
        const msg = describeFailure(result.error);
        renderer.error(msg);
        parentSpan.error(msg);
        runSpan.error(msg);
        return "failed";
      }

      parentSpan.info(result.response, { markdown: true });
      return "ok";
    } catch (e) {
      const chatInterrupt =
        spec.interactive && e instanceof AxleAgentAbortError && !controller.signal.aborted;
      if (chatInterrupt) return "interrupted";
      throw e;
    } finally {
      outstandingSends.splice(outstandingSends.indexOf(handle), 1);
      sigintCount = 0;
    }
  };

  try {
    if (spec.initial !== undefined) {
      const outcome = await sendMessage(spec.initial);
      await runtime.flush();
      if (outcome === "failed") {
        runSpan.end("error");
        return false;
      }
    }

    if (spec.interactive) {
      const sessionAborted = new Promise<null>((resolve) => {
        controller.signal.addEventListener("abort", () => resolve(null), { once: true });
      });
      const chatSend = async (text: string): Promise<void> => {
        try {
          await sendMessage(text);
        } catch (e) {
          if (e instanceof AxleAgentAbortError) return;
          const msg = e instanceof Error ? e.message : String(e);
          renderer.error(msg);
          parentSpan.error(msg);
        }
        await runtime.flush();
      };
      const inFlight = new Set<Promise<void>>();

      while (!controller.signal.aborted) {
        const input = await Promise.race([renderer.promptInput(), sessionAborted]);
        if (input === null) break;
        const text = input.trim();
        if (text === "") continue;
        if (text === "/quit" || ["exit", "quit"].includes(text.toLowerCase())) break;

        const sent = chatSend(text);
        if (renderer.acceptsInputDuringTurn) {
          inFlight.add(sent);
          void sent.finally(() => inFlight.delete(sent));
        } else {
          await sent;
        }
      }

      await Promise.all(inFlight);
      if (controller.signal.aborted) {
        renderer.warn("Interrupted");
        parentSpan.warn("Interrupted");
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
    await runtime.finishSaving();
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
  /** The model's context window in tokens; drives the compaction threshold. */
  contextWindow: number;
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
        contextWindow: spec.contextWindow,
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
