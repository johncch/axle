#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import type { AgentConfig, AgentDefinition, MCP, Stats } from "@fifthrevision/axle";
import { createStats, Instruct, loadFileContent, SimpleWriter, Tracer } from "@fifthrevision/axle";
import { mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import {
  createAgentDefinition,
  createDefaultAgentDefinition,
  resolveAgentDefinition,
} from "./cli/agent-config.js";
import { getCliConfig, getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import { resolveConfigDirs } from "./cli/configs/paths.js";
import type { BatchConfig, CliConfig, JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { closeMcps } from "./cli/mcp.js";
import type { AgentSessionSpec } from "./cli/runners.js";
import { runAgentSession, runBatch } from "./cli/runners.js";
import type { CliSessionFile } from "./cli/sessions.js";
import { loadSession, SessionStore } from "./cli/sessions.js";
import { runCleanup } from "./cli/cleanup.js";
import { hasAnyCredentials, promptForMissingModel, runSetupWizard } from "./cli/setup.js";
import { createRenderer } from "./ui/index.js";

const program = new Command()
  .name("axle")
  .description("Axle is a CLI tool for running AI workflows")
  .version(pkg.version)
  .argument(
    "[command]",
    'Subcommand: "setup" configures providers/defaults, "cleanup" deletes sessions',
  )
  .option("-j, --job <path>", "Run a YAML job file instead of starting a chat")
  .option("-s, --session <id>", "Resume a saved session")
  .option(
    "-m, --message <text>",
    "Send one message and exit (with --session: continue that session)",
  )
  .option("--renderer <mode>", "Screen renderer: ink or plain (pipes always get plain)", "ink")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .option("-i, --interactive", "With --job: continue the conversation interactively after the task")
  .option("--args <args...>", "Additional arguments in the form key=value");

program.parse(process.argv);
const options = program.opts();
const [command] = program.args;

if (command !== undefined && command !== "setup" && command !== "cleanup") {
  program.error(`error: unknown command "${command}"`);
}
if (options.job && options.session) {
  program.error("error: --job and --session are mutually exclusive");
}
if (options.job && options.message !== undefined) {
  program.error("error: --message cannot be combined with --job");
}
if (options.renderer !== "plain" && options.renderer !== "ink") {
  program.error(`error: unknown renderer "${options.renderer}" (expected plain or ink)`);
}

if (command === "setup") {
  const serviceConfig = await getServiceConfig({});
  await runSetupWizard(serviceConfig);
  process.exit(0);
}
if (command === "cleanup") {
  await runCleanup();
  process.exit(0);
}

const variables: Record<string, string> = {
  date: new Date().toISOString().split("T")[0],
  datetime: new Date().toISOString(),
  cwd: process.cwd(),
};

if (options.args) {
  options.args.forEach((arg: string) => {
    const [key, value] = arg.split("=");
    if (key && value) {
      variables[key.trim()] = value.trim();
    }
  });
}

const tracer = new Tracer();
if (options.debug) {
  tracer.minLevel = "debug";
}

// The screen belongs to the renderer; the tracer writes to it only in debug.
if (options.debug) {
  const debugWriter = new SimpleWriter({
    minLevel: "debug",
    showInternal: true,
    showTimestamp: true,
    markdown: true,
  });
  tracer.addWriter(debugWriter);
}

if (options.log) {
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

if (options.debug) {
  rootSpan.debug("Options: " + JSON.stringify(options, null, 2));
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
try {
  cliConfig = await getCliConfig({ span: rootSpan });
  serviceConfig = await getServiceConfig({ span: rootSpan });
  if (options.job) {
    jobConfig = await getJobConfig(options.job, { span: rootSpan });
  }
} catch (e) {
  await failBeforeRender(e instanceof Error ? e : new Error(String(e)));
}

const interactiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);

// First run with no credentials resolvable anywhere → onboarding wizard.
if (!options.session && interactiveTerminal && !hasAnyCredentials(serviceConfig)) {
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
  | { kind: "batch"; jobConfig: JobConfig; batchConfig: BatchConfig; definition: AgentDefinition }
  | {
      kind: "session";
      definition: AgentDefinition;
      saved?: CliSessionFile;
      initial?: Instruct | string;
      interactive: boolean;
      spanName: AgentSessionSpec["spanName"];
      sessionStore: SessionStore;
    };

let pending: PendingPlan | undefined;
try {
  if (options.session) {
    const saved = await loadSession(options.session);
    pending = {
      kind: "session",
      definition: saved.definition,
      saved,
      initial: options.message,
      interactive: options.message === undefined,
      spanName: "resume",
      sessionStore: new SessionStore(saved.definition, {
        cwd: saved.cwd,
        createdAt: saved.createdAt,
      }),
    };
  } else if (jobConfig) {
    const definition = createAgentDefinition(jobConfig, cliConfig, serviceConfig);
    if (jobConfig.batch) {
      pending = { kind: "batch", jobConfig, batchConfig: jobConfig.batch, definition };
    } else {
      const instruct = new Instruct({ prompt: jobConfig.task });
      for (const filePath of jobConfig.files ?? []) {
        instruct.addFile(await loadFileContent(filePath));
      }
      pending = {
        kind: "session",
        definition,
        initial: instruct.withInputs(variables),
        interactive: Boolean(options.interactive),
        spanName: "job",
        sessionStore: new SessionStore(definition),
      };
    }
  } else {
    const definition = createDefaultAgentDefinition(cliConfig, serviceConfig);
    pending = {
      kind: "session",
      definition,
      initial: options.message,
      interactive: options.message === undefined,
      spanName: "chat",
      sessionStore: new SessionStore(definition),
    };
  }

  // Any run that can't resolve a model falls into the picker.
  if (!pending.definition.model && interactiveTerminal) {
    pending.definition.model = await promptForMissingModel(pending.definition.provider.type, {
      offerSave: pending.kind !== "session" || pending.spanName !== "resume",
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
const renderer = await createRenderer(options.renderer as "plain" | "ink");

type RunPlan =
  | { kind: "batch"; jobConfig: JobConfig; batchConfig: BatchConfig; agentConfig: AgentConfig }
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
      jobConfig: pending.jobConfig,
      batchConfig: pending.batchConfig,
      agentConfig: resolved.agentConfig,
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
      { task: plan.jobConfig.task, files: plan.jobConfig.files },
      plan.batchConfig,
      plan.agentConfig,
      variables,
      stats,
      rootSpan,
      renderer,
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

renderer.success(`Done in ${(duration / 1000).toFixed(1)}s · ↑ ${stats.in} ↓ ${stats.out} tokens`);

if (succeeded) {
  rootSpan.info("Complete. Goodbye");
  rootSpan.end();
} else {
  renderer.error("Job failed");
  rootSpan.error("Job failed");
  rootSpan.end("error");
  process.exitCode = 1;
}
await renderer.close();
await tracer.flush();
