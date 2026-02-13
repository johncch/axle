import { Command } from "@commander-js/extra-typings";
import pkg from "../package.json";
import { getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import type { JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { runBatch, runSingle } from "./cli/runners.js";
import { createTools } from "./cli/tools.js";
import { getProvider } from "./providers/index.js";
import type { AIProvider } from "./providers/types.js";
import { Tool } from "./tools/index.js";
import { Tracer } from "./tracer/tracer.js";
import { SimpleWriter } from "./tracer/writers/simple.js";
import type { Stats } from "./types.js";

const program = new Command()
  .name("axle")
  .description("Axle is a CLI tool for running AI workflows")
  .version(pkg.version)
  .option("--dry-run", "Run the application without executing against the AI providers")
  .option("-c, --config <path>", "Path to the config file")
  .option("-j, --job <path>", "Path to the job file")
  .option("--no-log", "Do not write the output to a log file")
  .option("--no-warn-unused", "Do not warn about unused variables")
  .option("--no-inline", "Do not inline the console output")
  .option("-d, --debug", "Print additional debug information")
  .option(
    "--truncate <num>",
    "Truncate printed strings to a certain number of characters, 0 to disable",
    parseInt,
    100,
  )
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
  serviceConfig = await getServiceConfig(options.config ?? null, {
    tracer: rootSpan,
  });
  jobConfig = await getJobConfig(options.job ?? null, {
    tracer: rootSpan,
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
let provider: AIProvider;
let model: string;
try {
  const { type, ...otherConfig } = jobConfig.provider;
  const providerConfig = {
    ...serviceConfig[type],
    ...otherConfig,
  };
  ({ provider, model } = getProvider(type, providerConfig));
} catch (e) {
  const error = e instanceof Error ? e : new Error(String(e));
  rootSpan.error(error.message);
  rootSpan.error(error.stack ?? "");
  rootSpan.end("error");
  await tracer.flush();
  program.outputHelp();
  process.exit(1);
}

rootSpan.info("All systems operational. Running job...");
if (options.dryRun) {
  rootSpan.info("Dry run mode enabled. No API calls will be made.");
}

const sharedTools: Tool[] = jobConfig.tools?.length ? createTools(jobConfig.tools) : [];

const stats: Stats = { in: 0, out: 0 };
const startTime = performance.now();

if (jobConfig.batch) {
  await runBatch(jobConfig, provider, model, sharedTools, variables, options, stats, rootSpan);
} else {
  await runSingle(jobConfig, provider, model, sharedTools, variables, options, stats, rootSpan);
}

const duration = performance.now() - startTime;
rootSpan.info(`Total run time: ${Math.round(duration)}ms`);
rootSpan.info(`Input tokens: ${stats.in}`);
rootSpan.info(`Output tokens: ${stats.out}`);

rootSpan.info("Complete. Goodbye");
rootSpan.end();
await tracer.flush();
