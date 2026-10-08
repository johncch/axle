#!/usr/bin/env node

import { Command, Option } from "@commander-js/extra-typings";
import type { Stats } from "@fifthrevision/axle";
import { createStats, SimpleWriter, Tracer } from "@fifthrevision/axle";
import { mkdirSync, openSync, writeSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import pkg from "../package.json";
import { resolveAgentDefinition, resolveEndpoint } from "./cli/agent-config.js";
import { runCleanup } from "./cli/cleanup.js";
import {
  getCliConfig,
  getCliConfigSources,
  getCredentialSources,
  getJobConfig,
  getServiceConfig,
} from "./cli/configs/loaders.js";
import { resolveConfigDirs } from "./cli/configs/paths.js";
import {
  describeContextWindowSource,
  formatTokens,
  openModelCatalog,
  resolveContextWindow,
} from "./cli/context-window.js";
import { formatExplain } from "./cli/explain.js";
import { formatInfo } from "./cli/info.js";
import type { CommonOpts, Invocation } from "./cli/invocation.js";
import { buildPendingPlan, parseTemplateArgs } from "./cli/invocation.js";
import { loadLedger } from "./cli/ledger.js";
import { closeMcps } from "./cli/mcp.js";
import { runAgentSession, runBatch } from "./cli/runners.js";
import type { ScheduleContext, ScheduledJobConfig } from "./cli/schedule/commands.js";
import {
  applyRecipeSchedule,
  describeOutcome,
  describeScheduleState,
  formatScheduleList,
  formatScheduleSessions,
  removeScheduleByRecipe,
} from "./cli/schedule/commands.js";
import { createScheduleBackends } from "./cli/schedule/launchd.js";
import { appendScheduleRun } from "./cli/schedule/records.js";
import { needsSetupWizard, runSetupWizard } from "./cli/setup.js";
import type { Renderer } from "./ui/index.js";
import { createRenderer, supportsBatchProgress } from "./ui/index.js";

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

const EXPLAIN_DEFAULT_WIDTH = 80;
const EXPLAIN_MAX_WIDTH = 100;

let invocation: Invocation | undefined;

const PLATFORMS: readonly NodeJS.Platform[] = [
  "aix",
  "android",
  "cygwin",
  "darwin",
  "freebsd",
  "haiku",
  "linux",
  "netbsd",
  "openbsd",
  "sunos",
  "win32",
];

function scheduleContext(): ScheduleContext {
  const override = process.env.AXLE_SCHEDULE_PLATFORM;
  if (override !== undefined && !PLATFORMS.includes(override as NodeJS.Platform)) {
    throw new Error(
      `AXLE_SCHEDULE_PLATFORM must be one of ${PLATFORMS.join(", ")}; got "${override}".`,
    );
  }
  return {
    backends: createScheduleBackends({ launchctl: process.env.AXLE_LAUNCHCTL }),
    platform: (override as NodeJS.Platform | undefined) ?? process.platform,
  };
}

async function requireScheduleBlock(recipe: string): Promise<ScheduledJobConfig> {
  const jobConfig = await getJobConfig(recipe, {});
  if (!jobConfig.schedule) {
    throw new Error(
      `${recipe} has no schedule block. Add one, for example: schedule: { every: 1h }`,
    );
  }
  return { ...jobConfig, schedule: jobConfig.schedule };
}

// process.exit drops whatever a pipe has not accepted yet, so a slow reader
// would lose the tail of a long listing.
function exitAfterStdoutDrains(code: number): Promise<never> {
  return new Promise<never>(() => {
    process.stdout.write("", () => process.exit(code));
  });
}

async function manage(command: () => Promise<void>): Promise<never> {
  try {
    await command();
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
    return exitAfterStdoutDrains(1);
  }
  return exitAfterStdoutDrains(0);
}

program
  .option("-j, --job <path>", "Run a YAML job file instead of starting a chat")
  .option("-m, --message <text>", "Send one message and exit")
  .option("-i, --interactive", "With --job: continue the conversation interactively after the task")
  .addOption(new Option("--scheduled <id>").hideHelp())
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
    if (opts.scheduled !== undefined && !/^[0-9a-f]{16}$/.test(opts.scheduled)) {
      program.error("error: --scheduled expects a schedule id");
    }
    invocation = {
      kind: "kernel",
      job: opts.job,
      message: opts.message,
      interactive: Boolean(opts.interactive),
      scheduling:
        opts.scheduled !== undefined
          ? { kind: "occurrence", id: opts.scheduled }
          : { kind: "none" },
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

const schedule = program
  .command("schedule")
  .description("Register a recipe's recurring schedule (macOS launchd) and run it once now")
  .enablePositionalOptions()
  .option("-j, --job <path>", "Recipe with a schedule block to register and run")
  .option("--renderer <mode>", "Screen renderer: ink or plain (pipes always get plain)", "ink")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .action(async (opts) => {
    const recipe = opts.job;
    if (!recipe) return schedule.help();
    try {
      await requireScheduleBlock(recipe);
    } catch (e) {
      console.error(`✖ ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
    invocation = {
      kind: "kernel",
      job: recipe,
      interactive: false,
      scheduling: { kind: "register" },
      args: [],
      common: commonOf(opts),
    };
  });

schedule
  .command("register")
  .description("Register or update a recipe's schedule without running it")
  .requiredOption("-j, --job <path>", "Recipe with a schedule block to register")
  .action(async (opts) => {
    await manage(async () => {
      const jobConfig = await requireScheduleBlock(opts.job);
      const outcome = await applyRecipeSchedule(opts.job, jobConfig, scheduleContext());
      console.log(`✔ ${describeOutcome(outcome)}`);
    });
  });

schedule
  .command("list")
  .description("Show registered schedules")
  .action(async () => {
    await manage(async () => {
      for (const line of await formatScheduleList(scheduleContext())) console.log(line);
    });
  });

schedule
  .command("remove")
  .description("Unregister a recipe's schedule; the recipe and its sessions stay")
  .requiredOption("-j, --job <path>", "Recipe whose schedule to remove")
  .action(async (opts) => {
    await manage(async () => {
      console.log(`✔ ${await removeScheduleByRecipe(opts.job, scheduleContext())}`);
    });
  });

schedule
  .command("sessions")
  .description("List the sessions a recipe's scheduled runs produced")
  .requiredOption("-j, --job <path>", "Recipe whose runs to list")
  .action(async (opts) => {
    await manage(async () => {
      for (const line of await formatScheduleSessions(opts.job)) console.log(line);
    });
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
  .command("info")
  .description("Print version, config file locations, and resolved configuration")
  .action(async () => {
    await manage(async () => {
      const catalog = await openModelCatalog();
      if (catalog.stale) await catalog.refresh();
      const lines = formatInfo({
        version: pkg.version,
        dirs: resolveConfigDirs(),
        cliConfig: await getCliConfig({}),
        cliConfigSources: await getCliConfigSources({}),
        serviceConfig: await getServiceConfig({}),
        credentialSources: await getCredentialSources({}),
        env: process.env,
        catalog,
      });
      for (const line of lines) console.log(line);
    });
  });

program
  .command("explain")
  .description("Describe the keys a recipe or cli.yaml accepts")
  .argument("[path]", "Dotted key path, e.g. recipe.request.reasoning or config.defaults")
  .action(async (path) => {
    await manage(async () => {
      const width = Math.min(process.stdout.columns ?? EXPLAIN_DEFAULT_WIDTH, EXPLAIN_MAX_WIDTH);
      for (const line of formatExplain(path, width)) console.log(line);
    });
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
  Object.assign(variables, parseTemplateArgs(inv.args));
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
const startedAt = new Date();
let screen: Renderer | undefined;
let scheduleRunId: string | undefined;

async function recordScheduleRun(
  status: "succeeded" | "failed",
  sessionIds: string[],
): Promise<void> {
  const runId =
    inv.kind === "kernel" && inv.scheduling.kind === "occurrence"
      ? inv.scheduling.id
      : scheduleRunId;
  if (runId === undefined) return;
  await appendScheduleRun(runId, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    sessionIds,
  }).catch((e) => rootSpan.warn(`Failed to record scheduled run: ${e}`));
}

async function shutdown(): Promise<void> {
  try {
    await screen?.close();
  } finally {
    await tracer.flush();
  }
}

process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:");
  console.error(err);

  rootSpan.error("Uncaught exception:");
  rootSpan.error(err.message);
  rootSpan.error(err.stack || "");
  rootSpan.end("error");
  await shutdown();

  process.exit(1);
});

if (common.debug) {
  rootSpan.debug("Invocation: " + JSON.stringify(inv, null, 2));
  rootSpan.debug("Additional Arguments: " + JSON.stringify(variables, null, 2));
}

async function fail(e: unknown): Promise<never> {
  const error = e instanceof Error ? e : new Error(String(e));
  (screen ?? console).error(error.message);
  rootSpan.error(error.message);
  rootSpan.debug(error.stack ?? "");
  rootSpan.end("error");
  await recordScheduleRun("failed", []);
  await shutdown();
  if (!screen) program.outputHelp();
  process.exit(1);
}

/**
 * Read and load config, job
 */
let cliConfig = await getCliConfig({ span: rootSpan }).catch(fail);
let serviceConfig = await getServiceConfig({ span: rootSpan }).catch(fail);
const jobConfig =
  inv.kind !== "resume" && inv.job
    ? await getJobConfig(inv.job, { span: rootSpan }).catch(fail)
    : undefined;
const jobScope =
  inv.kind !== "resume" && inv.job && jobConfig
    ? (jobConfig.name ?? relative(process.cwd(), resolve(inv.job)))
    : "job";

const interactiveTerminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);

async function prepareSchedule(): Promise<string | undefined> {
  if (inv.kind !== "kernel") return undefined;
  if (inv.scheduling.kind === "occurrence") return inv.scheduling.id;
  if (!inv.job || !jobConfig) return undefined;

  if (inv.scheduling.kind === "register") {
    if (!jobConfig.schedule) throw new Error(`${inv.job} has no schedule block.`);
    const outcome = await applyRecipeSchedule(
      inv.job,
      { ...jobConfig, schedule: jobConfig.schedule },
      scheduleContext(),
    );
    console.log(`✔ ${describeOutcome(outcome)}`);
    rootSpan.info(describeOutcome(outcome));
    return outcome.record.desired.id;
  }

  const state = await describeScheduleState(inv.job, jobConfig, scheduleContext());
  if (state) {
    console.log(`${state.level === "warn" ? "⚠" : "ℹ"} ${state.message}`);
    rootSpan[state.level](state.message);
  }
  return undefined;
}

scheduleRunId = await prepareSchedule().catch(fail);

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
const pending = await buildPendingPlan({
  invocation: inv,
  cliConfig,
  serviceConfig,
  jobConfig,
  jobScope,
  variables,
  interactiveTerminal,
}).catch(fail);

/**
 * Phase B — the renderer owns the terminal from here; resolve runtime
 * objects (connect MCPs) and execute.
 */
const renderer = await createRenderer(common.renderer, {
  batchProgress: pending.kind === "batch" && !pending.spec.verbose,
  statusBar: pending.kind === "session" && pending.spec.interactive,
});
screen = renderer;
// Under ink, raw mode swallows SIGINT and the runners only own the interrupt
// while a run is live. Outside a run (MCP connect/close can hang), Ctrl-C
// must still kill the process.
const exitOnInterrupt = () => process.exit(130);
renderer.setInterruptHandler(exitOnInterrupt);

if (pending.definition.mcps?.length) {
  renderer.info("Connecting MCP servers…");
}
const { mcps, agentConfig } = await resolveAgentDefinition(
  pending.definition,
  cliConfig,
  serviceConfig,
  rootSpan,
).catch(fail);
const catalog = await openModelCatalog();
if (catalog.stale) void catalog.refresh();
const contextWindow = resolveContextWindow(
  resolveEndpoint(pending.definition.provider, cliConfig),
  agentConfig.model,
  catalog,
);
rootSpan.info(
  `Context window: ${formatTokens(contextWindow.window)} (${describeContextWindowSource(contextWindow.source)})`,
);

try {
  rootSpan.info("All systems operational. Running job...");

  const stats: Stats = createStats();
  const startTime = performance.now();

  let succeeded = false;
  try {
    if (pending.kind === "batch") {
      succeeded = await runBatch(
        {
          ...pending.spec,
          definition: pending.definition,
          agentConfig,
          contextWindow: contextWindow.window,
        },
        variables,
        stats,
        rootSpan,
        renderer,
        supportsBatchProgress(renderer) ? renderer : undefined,
      );
    } else {
      succeeded = await runAgentSession(
        {
          ...pending.spec,
          agentConfig,
          contextWindow: contextWindow.window,
          providerName: pending.definition.provider.type,
        },
        stats,
        rootSpan,
        renderer,
        pending.sessionStore,
      );
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
  const sessionIds =
    pending.kind === "session"
      ? pending.sessionStore.savedSessionId
        ? [pending.sessionStore.savedSessionId]
        : []
      : [...(await loadLedger()).values()]
          .filter(
            (entry) => entry.job === pending.spec.jobName && entry.timestamp >= startedAt.getTime(),
          )
          .map((entry) => entry.sessionId);
  await recordScheduleRun(succeeded ? "succeeded" : "failed", sessionIds);
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
} finally {
  await shutdown();
}
