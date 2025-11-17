import { Command } from "@commander-js/extra-typings";
import pkg from "../package.json";
import { getProvider } from "./ai/index.js";
import type { AIProvider } from "./ai/types.js";
import { getJobConfig, getServiceConfig } from "./cli/configs/loaders.js";
import type { JobConfig, ServiceConfig } from "./cli/configs/schemas.js";
import { ConsoleWriter } from "./recorder/consoleWriter.js";
import { LogWriter } from "./recorder/logWriter.js";
import { Recorder } from "./recorder/recorder.js";
import { LogLevel } from "./recorder/types.js";
import type { Stats } from "./types.js";
import { dagWorkflow } from "./workflows/dag.js";

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

const variables: Record<string, string> = {};
if (options.args) {
  options.args.forEach((arg: string) => {
    const [key, value] = arg.split("=");
    if (key && value) {
      variables[key.trim()] = value.trim();
    }
  });
}

process.on("uncaughtException", async (err) => {
  console.error("Uncaught exception:");
  console.error(err);

  if (recorder) {
    recorder.error?.log("Uncaught exception:");
    recorder.error?.log(err.message);
    recorder.error?.log(err.stack || "");
    await recorder.shutdown();
  }

  process.exit(1);
});

const recorder = new Recorder();
if (options.debug) {
  recorder.level = LogLevel.Debug;
}
const consoleWriter = new ConsoleWriter(options);
recorder.subscribe(consoleWriter);
if (options.log) {
  const logWriter = new LogWriter();
  await logWriter.initialize();
  recorder.subscribe(logWriter);
}

if (options.debug) {
  recorder.debug?.heading.log("Options");
  recorder.debug?.log(options);
  recorder.debug?.heading.log("Additional Arguments:");
  recorder.debug?.log(variables);
}

/**
 * Read and load config, job
 */
let serviceConfig: ServiceConfig;
let jobConfig: JobConfig;
try {
  serviceConfig = await getServiceConfig(options.config ?? null, {
    recorder,
  });
  jobConfig = await getJobConfig(options.job ?? null, {
    recorder,
  });
} catch (e) {
  recorder.error.log(e.message);
  recorder.debug?.log(e.stack);
  await recorder.shutdown();
  program.outputHelp();
  process.exit(1);
}

/**
 * Execute the job
 */
let provider: AIProvider;
try {
  const { engine: providerKey, ...otherConfig } = jobConfig.using;
  const providerConfig = {
    ...serviceConfig[providerKey],
    ...otherConfig,
  };
  provider = getProvider(providerKey, providerConfig);
} catch (e) {
  recorder.error.log(e.message);
  recorder.error.log(e.stack);
  await recorder.shutdown();
  program.outputHelp();
  process.exit(1);
}

recorder.info?.heading.log("All systems operational. Running job...");
const startTime = Date.now();
if (options.dryRun) {
  recorder.info?.log("Dry run mode enabled. No API calls will be made.");
}

const stats: Stats = { in: 0, out: 0 };
const response = await dagWorkflow(jobConfig.jobs).execute({
  provider,
  variables,
  options,
  stats,
  recorder,
});

if (response) {
  recorder.info?.heading.log("Response");
  recorder.info.log(response);
}

recorder.info?.heading.log("Usage");
recorder.info?.log(`Total run time: ${Date.now() - startTime}ms`);
recorder.info?.log(`Input tokens: ${stats.in} `);
recorder.info?.log(`Output tokens: ${stats.out} `);

recorder.info?.heading.log("Complete. Goodbye");

// Ensure all logs are written before exit
await recorder.shutdown();
