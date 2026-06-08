#!/usr/bin/env node

import { Command } from "@commander-js/extra-typings";
import type { AgentConfig, MCP, Stats } from "@fifthrevision/axle";
import { createStats, SimpleWriter, Tracer } from "@fifthrevision/axle";
import pkg from "../package.json";
import { createCliAgentConfig } from "./cli/agent-config.js";
import { getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import type { JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { closeMcps } from "./cli/mcp.js";
import { runBatch, runSingle } from "./cli/runners.js";

const program = new Command()
  .name("axle")
  .description("Axle is a CLI tool for running AI workflows")
  .version(pkg.version)
  .requiredOption("-j, --job <path>", "Path to the YAML job file")
  .option("--no-log", "Do not write the output to a log file")
  .option("-d, --debug", "Print additional debug information")
  .option("-i, --interactive", "Continue the conversation interactively after the initial task")
  .option("--args <args...>", "Additional arguments in the form key=value");

program.parse(process.argv);
const options = program.opts();

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

const logWriter = new SimpleWriter({
  minLevel: options.debug ? "debug" : "info",
  showInternal: options.debug,
  showTimestamp: true,
  markdown: true,
});
tracer.addWriter(logWriter);

if (options.log) {
  const fileWriter = new SimpleWriter({
    minLevel: "debug",
    showInternal: true,
    showTimestamp: true,
    output: (line) => {
      // TODO: Write to file instead of console
      // For now, SimpleWriter outputs to console by default
    },
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
let jobConfig: JobConfig;
try {
  serviceConfig = await getServiceConfig({
    span: rootSpan,
  });
  jobConfig = await getJobConfig(options.job, {
    span: rootSpan,
  });
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  rootSpan.error(error.message);
  rootSpan.debug(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
  process.exit(1);
}

/**
 * Execute the job
 */
let mcps: MCP[] = [];
let agentConfig: AgentConfig | undefined;
try {
  const cliConfig = await createCliAgentConfig(jobConfig, serviceConfig, rootSpan);
  agentConfig = cliConfig.agentConfig;
  mcps = cliConfig.mcps;
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  rootSpan.error(error.message);
  rootSpan.error(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
  process.exit(1);
}

if (!agentConfig) {
  throw new Error("Failed to create agent config.");
}

rootSpan.info("All systems operational. Running job...");

const stats: Stats = createStats();
const startTime = performance.now();
const input = {
  task: jobConfig.task,
  files: jobConfig.files,
};

try {
  if (jobConfig.batch) {
    await runBatch(input, jobConfig.batch, agentConfig, variables, options, stats, rootSpan);
  } else {
    await runSingle(input, agentConfig, variables, options, stats, rootSpan);
  }
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
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

rootSpan.info("Complete. Goodbye");
rootSpan.end();
await tracer.flush();
