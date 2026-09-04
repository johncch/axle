#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import type { AgentConfig, AgentDefinition, MCP, Stats } from "@fifthrevision/axle";
import { createStats, Instruct, loadFileContent, SimpleWriter, Tracer } from "@fifthrevision/axle";
import { mkdirSync, openSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pkg from "../package.json";
import {
  createAgentDefinition,
  createDefaultAgentDefinition,
  resolveAgentDefinition,
  resolveTarget,
} from "./cli/agent-config.js";
import { getCliConfig, getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import { resolveConfigDirs } from "./cli/configs/paths.js";
import type { CliConfig, JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { closeMcps } from "./cli/mcp.js";
import type { AgentSessionSpec, BatchRunSpec } from "./cli/runners.js";
import { runAgentSession, runBatch } from "./cli/runners.js";
import type { CliSessionFile } from "./cli/sessions.js";
import { loadSession, SessionStore } from "./cli/sessions.js";
import { runCleanup } from "./cli/cleanup.js";
import {
  needsSetupWizard,
  promptForInputs,
  promptForMissingModel,
  runSetupWizard,
} from "./cli/setup.js";
import { createRenderer, supportsBatchProgress } from "./ui/index.js";

interface CommonOpts {
  renderer: "plain" | "ink";
  log: boolean;
  debug: boolean;
}

type Invocation =
  | {
      kind: "kernel";
      job?: string;
      message?: string;
      interactive: boolean;
      args: string[];
      common: CommonOpts;
    }
  | {
      kind: "batch";
      job: string;
      inputs: string[];
      incremental?: boolean;
      verbose: boolean;
      args: string[];
      common: CommonOpts;
    }
  | { kind: "resume"; id: string; message?: string; common: CommonOpts };

const program = new Command()
  .name("axle")
  .description("Axle is a CLI tool for running AI workflows")
  .version(pkg.version)
  // Kernel and subcommands share flag names (-j, -m); positional parsing
  // keeps each command's flags its own.
  .enablePositionalOptions()
  .helpCommand(true);

function commonOf(opts: { renderer?: string; log: boolean; debug?: boolean }): CommonOpts {
  const renderer = opts.renderer ?? "ink";
  if (renderer !== "plain" && renderer !== "ink") {
    program.error(`error: unknown renderer "${renderer}" (expected plain or ink)`);
  }
  return { renderer: renderer as "plain" | "ink", log: opts.log, debug: Boolean(opts.debug) };
}

let invocation: Invocation | undefined;

program
  .option("-j, --job <path>", "Run a YAML job file instead of starting a chat")
  .option("-m, --message <text>", "Send one message and exit")
  .option("-i, --interactive", "With --job: continue the conversation interactively after the task")
  .option("--args <args...>", "Template variables in the form key=value")
  .option("--renderer <mode>", "Screen renderer: ink or plain (pipes always get plain)", "ink")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .addHelpText(
    "after",
    `
Run a session (default):
  axle                    Interactive chat from configured defaults
  axle -m "..."           One-shot message
  axle -j <recipe>        Run a job file (batch if the recipe has a batch block)`,
  )
  .action((opts) => {
    if (opts.job && opts.message !== undefined) {
      program.error("error: --message cannot be combined with --job");
    }
    invocation = {
      kind: "kernel",
      job: opts.job,
      message: opts.message,
      interactive: Boolean(opts.interactive),
      args: opts.args ?? [],
      common: commonOf(opts),
    };
  });

program
  .command("batch")
  .description("Run a recipe once per input, one isolated session each")
  .argument("[inputs...]", "Globs or paths; defaults to the recipe's batch block, else prompts")
  .requiredOption("-j, --job <path>", "Recipe to run")
  .option("--incremental", "Skip completed inputs whose content is unchanged")
  .option("--no-incremental", "Run every input even if the recipe sets incremental")
  .option("--verbose", "Stream full item transcripts instead of progress rows (concurrency 1)")
  .option("--args <args...>", "Template variables in the form key=value")
  .option("--renderer <mode>", "Screen renderer: ink or plain (pipes always get plain)", "ink")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .action((inputs, opts) => {
    invocation = {
      kind: "batch",
      job: opts.job,
      inputs,
      incremental: opts.incremental,
      verbose: Boolean(opts.verbose),
      args: opts.args ?? [],
      common: commonOf(opts),
    };
  });

program
  .command("resume")
  .description("Re-enter a saved session")
  .argument("<id>", "Session id (unique prefixes accepted)")
  .option("-m, --message <text>", "Send one message and exit")
  .option("--renderer <mode>", "Screen renderer: ink or plain (pipes always get plain)", "ink")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .action((id, opts) => {
    invocation = { kind: "resume", id, message: opts.message, common: commonOf(opts) };
  });

program
  .command("setup")
  .description("Configure providers, credentials, and defaults")
  .action(async () => {
    const serviceConfig = await getServiceConfig({});
    await runSetupWizard(serviceConfig);
    process.exit(0);
  });

program
  .command("cleanup")
  .description("Delete saved sessions by age window")
  .action(async () => {
    await runCleanup();
    process.exit(0);
  });

await program.parseAsync(process.argv);

if (!invocation) {
  process.exit(0);
}
const inv = invocation;
const common = inv.common;

const variables: Record<string, string> = {
  date: new Date().toISOString().split("T")[0],
  datetime: new Date().toISOString(),
  cwd: process.cwd(),
};

if ("args" in inv) {
  for (const arg of inv.args) {
    const [key, value] = arg.split("=");
    if (key && value) {
      variables[key.trim()] = value.trim();
    }
  }
}

const tracer = new Tracer();
if (common.debug) {
  tracer.minLevel = "debug";
}

// The screen belongs to the renderer; the tracer writes to it only in debug.
if (common.debug) {
  const debugWriter = new SimpleWriter({
    minLevel: "debug",
    showInternal: true,
    showTimestamp: true,
    markdown: true,
  });
  tracer.addWriter(debugWriter);
}

if (common.log) {
  const logsDir = join(resolveConfigDirs().user, "logs", "cli");
  mkdirSync(logsDir, { recursive: true });
  const logFile = join(logsDir, `${new Date().toISOString().replace(/:/g, "-")}.log`);
  const logFd = openSync(logFile, "a");
  const fileWriter = new SimpleWriter({
    minLevel: "debug",
    showInternal: true,
    showTimestamp: true,
    output: (line) => writeSync(logFd, line + "\n"),
  });
  tracer.addWriter(fileWriter);
}

// Create root span for the entire CLI execution
const rootSpan = tracer.startSpan("cli", { type: "root" });

process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:");
  console.error(err);

  rootSpan.error("Uncaught exception:");
  rootSpan.error(err.message);
  rootSpan.error(err.stack || "");
  rootSpan.end("error");
  await tracer.flush();

  process.exit(1);
});

if (common.debug) {
  rootSpan.debug("Invocation: " + JSON.stringify(inv, null, 2));
  rootSpan.debug("Additional Arguments: " + JSON.stringify(variables, null, 2));
}

async function failBeforeRender(error: Error): Promise<never> {
  console.error(error.message);
  rootSpan.error(error.message);
  rootSpan.debug(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
  process.exit(1);
}

/**
 * Read and load config, job
 */
let cliConfig!: CliConfig;
let serviceConfig!: ServiceConfig;
let jobConfig: JobConfig | undefined;
let jobScope = "job";
try {
  cliConfig = await getCliConfig({ span: rootSpan });
  serviceConfig = await getServiceConfig({ span: rootSpan });
  if (inv.kind !== "resume" && inv.job) {
    jobConfig = await getJobConfig(inv.job, { span: rootSpan });
    jobScope = jobConfig.name ?? relative(process.cwd(), resolve(inv.job));
  }
} catch (e) {
  await failBeforeRender(e instanceof Error ? e : new Error(String(e)));
}

const interactiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);

// First run with no configuration resolvable anywhere → onboarding wizard.
if (
  inv.kind !== "resume" &&
  interactiveTerminal &&
  needsSetupWizard(serviceConfig, cliConfig, jobConfig)
) {
  await runSetupWizard(serviceConfig);
  cliConfig = await getCliConfig({ span: rootSpan });
  serviceConfig = await getServiceConfig({ span: rootSpan });
}

/**
 * Phase A — decide what to run and build the serializable definition.
 * Interactive prompts (model picker) happen here, before the renderer owns
 * the terminal.
 */
type PendingPlan =
  | {
      kind: "batch";
      jobConfig: JobConfig;
      inputs: string[];
      concurrency: number;
      incremental: boolean;
      verbose: boolean;
      definition: AgentDefinition;
    }
  | {
      kind: "session";
      definition: AgentDefinition;
      saved?: CliSessionFile;
      initial?: Instruct | string;
      interactive: boolean;
      spanName: AgentSessionSpec["spanName"];
      sessionStore: SessionStore;
      compaction?: boolean;
    };

let pending: PendingPlan | undefined;
try {
  if (inv.kind === "resume") {
    const saved = await loadSession(inv.id);
    pending = {
      kind: "session",
      definition: saved.definition,
      saved,
      initial: inv.message,
      interactive: inv.message === undefined,
      spanName: "resume",
      sessionStore: new SessionStore(saved.definition, {
        cwd: saved.cwd,
        createdAt: saved.createdAt,
        compaction: saved.compaction,
      }),
      compaction: saved.compaction,
    };
  } else if (jobConfig) {
    const definition = createAgentDefinition(jobConfig, cliConfig, serviceConfig);
    if (inv.kind === "batch" || jobConfig.batch) {
      if (inv.kind === "kernel" && inv.interactive) {
        throw new Error("A batch run cannot be combined with --interactive.");
      }
      // Inputs: verb positionals → recipe batch block → prompt (verb only).
      let inputs: string[];
      if (inv.kind === "batch" && inv.inputs.length > 0) {
        inputs = inv.inputs;
      } else if (jobConfig.batch) {
        inputs = [jobConfig.batch.files];
      } else if (interactiveTerminal) {
        inputs = [await promptForInputs()];
      } else {
        throw new Error(
          "batch needs inputs: pass globs/paths after the recipe, or add a batch: block to it.",
        );
      }
      const verbose =
        (inv.kind === "batch" && inv.verbose) || (jobConfig.batch?.concurrency ?? 3) === 1;
      pending = {
        kind: "batch",
        jobConfig,
        inputs,
        verbose,
        concurrency: verbose ? 1 : (jobConfig.batch?.concurrency ?? 3),
        incremental:
          (inv.kind === "batch" ? inv.incremental : undefined) ??
          jobConfig.batch?.incremental ??
          false,
        definition,
      };
    } else {
      const instruct = new Instruct({ prompt: jobConfig.task });
      for (const filePath of jobConfig.files ?? []) {
        instruct.addFile(await loadFileContent(filePath));
      }
      pending = {
        kind: "session",
        definition,
        initial: instruct.withInputs(variables),
        interactive: inv.kind === "kernel" && inv.interactive,
        spanName: "job",
        sessionStore: new SessionStore(definition, { compaction: jobConfig.compaction }),
        compaction: jobConfig.compaction,
      };
    }
  } else {
    const definition = createDefaultAgentDefinition(cliConfig, serviceConfig);
    pending = {
      kind: "session",
      definition,
      initial: inv.kind === "kernel" ? inv.message : undefined,
      interactive: inv.kind !== "kernel" || inv.message === undefined,
      spanName: "chat",
      sessionStore: new SessionStore(definition),
    };
  }

  // Any run that can't resolve a model falls into the picker.
  if (!pending.definition.model && interactiveTerminal) {
    const offerSave = pending.kind !== "session" || pending.spanName !== "resume";
    pending.definition.model = await promptForMissingModel(pending.definition.provider.type, {
      offerSave,
      saveAs: offerSave
        ? resolveTarget(jobConfig, cliConfig, serviceConfig).providerName
        : undefined,
    });
  }
} catch (e) {
  await failBeforeRender(e instanceof Error ? e : new Error(String(e)));
}

if (!pending) {
  throw new Error("Failed to plan the run.");
}

/**
 * Phase B — the renderer owns the terminal from here; resolve runtime
 * objects (connect MCPs) and execute.
 */
const renderer = await createRenderer(common.renderer, {
  batchProgress: pending.kind === "batch" && !pending.verbose,
});
// Under ink, raw mode swallows SIGINT and the runners only own the interrupt
// while a run is live. Outside a run (MCP connect/close can hang), Ctrl-C
// must still kill the process.
const exitOnInterrupt = () => process.exit(130);
renderer.setInterruptHandler(exitOnInterrupt);

type RunPlan =
  | { kind: "batch"; spec: BatchRunSpec }
  | { kind: "session"; spec: AgentSessionSpec; sessionStore: SessionStore };

let mcps: MCP[] = [];
let plan: RunPlan | undefined;
try {
  if (pending.definition.mcps?.length) {
    renderer.info("Connecting MCP servers…");
  }
  const resolved = await resolveAgentDefinition(pending.definition, serviceConfig, rootSpan);
  mcps = resolved.mcps;

  if (pending.kind === "batch") {
    plan = {
      kind: "batch",
      spec: {
        task: pending.jobConfig.task,
        files: pending.jobConfig.files,
        definition: pending.definition,
        agentConfig: resolved.agentConfig,
        inputs: pending.inputs,
        concurrency: pending.concurrency,
        jobName: jobScope,
        incremental: pending.incremental,
        verbose: pending.verbose,
        compaction: pending.jobConfig.compaction,
      },
    };
  } else {
    plan = {
      kind: "session",
      spec: {
        agentConfig: resolved.agentConfig,
        spanName: pending.spanName,
        session: pending.saved?.session,
        priorTurns: pending.saved?.turns,
        resumedFromCwd: pending.saved?.cwd,
        initial: pending.initial,
        interactive: pending.interactive,
        compaction: pending.compaction,
      },
      sessionStore: pending.sessionStore,
    };
  }
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  renderer.error(error.message);
  rootSpan.error(error.message);
  rootSpan.error(error.stack ?? "");
  rootSpan.end("error");
  await renderer.close();
  await tracer.flush();
  process.exit(1);
}

if (!plan) {
  throw new Error("Failed to create agent config.");
}

rootSpan.info("All systems operational. Running job...");

const stats: Stats = createStats();
const startTime = performance.now();

let succeeded = false;
try {
  if (plan.kind === "batch") {
    succeeded = await runBatch(
      plan.spec,
      variables,
      stats,
      rootSpan,
      renderer,
      supportsBatchProgress(renderer) ? renderer : undefined,
    );
  } else {
    succeeded = await runAgentSession(plan.spec, stats, rootSpan, renderer, plan.sessionStore);
  }
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  renderer.error(error.message);
  rootSpan.error(error.message);
  rootSpan.debug(error.stack ?? "");
} finally {
  renderer.setInterruptHandler(exitOnInterrupt);
  if (mcps.length > 0) {
    await closeMcps(mcps, rootSpan);
  }
}

const duration = performance.now() - startTime;
rootSpan.info(`Total run time: ${Math.round(duration)}ms`);
rootSpan.info(`Input tokens: ${stats.in}`);
rootSpan.info(`Output tokens: ${stats.out}`);
if (stats.cachedIn !== undefined) rootSpan.info(`Cached input tokens: ${stats.cachedIn}`);
if (stats.cacheWriteIn !== undefined)
  rootSpan.info(`Cache write input tokens: ${stats.cacheWriteIn}`);
if (stats.reasoningOut !== undefined)
  rootSpan.info(`Reasoning output tokens: ${stats.reasoningOut}`);

const runSummary = `in ${(duration / 1000).toFixed(1)}s · ↑ ${stats.in} ↓ ${stats.out} tokens`;
if (succeeded) {
  renderer.success(`Done ${runSummary}`);
  rootSpan.info("Complete. Goodbye");
  rootSpan.end();
} else {
  renderer.error(`Failed ${runSummary}`);
  rootSpan.error("Job failed");
  rootSpan.end("error");
  process.exitCode = 1;
}
await renderer.close();
await tracer.flush();
