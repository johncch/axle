#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import type { AgentConfig, MCP, Stats } from "@fifthrevision/axle";
import { createStats, SimpleWriter, Tracer } from "@fifthrevision/axle";
import { mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import { resolveConfigDirs } from "./cli/configs/paths.js";
import { createCliAgentConfig, resolveAgentDefinition } from "./cli/agent-config.js";
import { getCliConfig, getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import type { JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { closeMcps } from "./cli/mcp.js";
import { runBatch, runResume, runSingle } from "./cli/runners.js";
import type { CliSessionFile } from "./cli/sessions.js";
import { loadSession, SessionStore } from "./cli/sessions.js";
import { createRenderer } from "./ui/index.js";

const program = new Command()
  .name("axle")
  .description("Axle is a CLI tool for running AI workflows")
  .version(pkg.version)
  .option("-j, --job <path>", "Path to the YAML job file")
  .option("-s, --session <id>", "Resume a saved session")
  .option("-m, --message <text>", "Send one message to the resumed session and exit")
  .option("--renderer <mode>", "Screen renderer: plain or ink", "plain")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .option("-i, --interactive", "Continue the conversation interactively after the initial task")
  .option("--args <args...>", "Additional arguments in the form key=value");

program.parse(process.argv);
const options = program.opts();

if (!options.job && !options.session) {
  program.error("error: provide --job <path> or --session <id>");
}
if (options.job && options.session) {
  program.error("error: --job and --session are mutually exclusive");
}
if (options.message !== undefined && !options.session) {
  program.error("error: --message requires --session");
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

if (options.renderer !== "plain" && options.renderer !== "ink") {
  program.error(`error: unknown renderer "${options.renderer}" (expected plain or ink)`);
}
const renderer = await createRenderer(options.renderer as "plain" | "ink");

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

/**
 * Read and load config, job
 */
let serviceConfig: ServiceConfig;
let jobConfig: JobConfig | undefined;
try {
  await getCliConfig({ span: rootSpan });
  serviceConfig = await getServiceConfig({
    span: rootSpan,
  });
  if (options.job) {
    jobConfig = await getJobConfig(options.job, {
      span: rootSpan,
    });
  }
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  renderer.error(error.message);
  rootSpan.error(error.message);
  rootSpan.debug(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
  process.exit(1);
}

/**
 * Resolve what to run: a job from a file, or a resumed session
 */
type RunPlan =
  | { kind: "job"; jobConfig: JobConfig; agentConfig: AgentConfig; sessionStore: SessionStore }
  | { kind: "resume"; saved: CliSessionFile; agentConfig: AgentConfig; sessionStore: SessionStore };

let mcps: MCP[] = [];
let plan: RunPlan | undefined;
try {
  if (options.session) {
    const saved = await loadSession(options.session);
    const resolved = await resolveAgentDefinition(saved.definition, serviceConfig, rootSpan);
    mcps = resolved.mcps;
    plan = {
      kind: "resume",
      saved,
      agentConfig: resolved.agentConfig,
      sessionStore: new SessionStore(saved.definition, {
        cwd: saved.cwd,
        createdAt: saved.createdAt,
      }),
    };
  } else if (jobConfig) {
    const resolved = await createCliAgentConfig(jobConfig, serviceConfig, rootSpan);
    mcps = resolved.mcps;
    plan = {
      kind: "job",
      jobConfig,
      agentConfig: resolved.agentConfig,
      sessionStore: new SessionStore(resolved.definition),
    };
  }
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  renderer.error(error.message);
  rootSpan.error(error.message);
  rootSpan.error(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
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
  if (plan.kind === "resume") {
    succeeded = await runResume(
      plan.saved,
      plan.agentConfig,
      options,
      stats,
      rootSpan,
      renderer,
      plan.sessionStore,
    );
  } else {
    const input = {
      task: plan.jobConfig.task,
      files: plan.jobConfig.files,
    };
    if (plan.jobConfig.batch) {
      succeeded = await runBatch(
        input,
        plan.jobConfig.batch,
        plan.agentConfig,
        variables,
        options,
        stats,
        rootSpan,
        renderer,
      );
    } else {
      succeeded = await runSingle(
        input,
        plan.agentConfig,
        variables,
        options,
        stats,
        rootSpan,
        renderer,
        plan.sessionStore,
      );
    }
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

renderer.info(`${(duration / 1000).toFixed(1)}s · ${stats.in} in / ${stats.out} out tokens`);

if (succeeded) {
  rootSpan.info("Complete. Goodbye");
  rootSpan.end();
} else {
  renderer.error("Job failed");
  rootSpan.error("Job failed");
  rootSpan.end("error");
  process.exitCode = 1;
}
renderer.close();
await tracer.flush();
