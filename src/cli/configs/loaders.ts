import YAML from "yaml";
import * as z from "zod";
import type { TracingContext } from "../../tracer/types.js";
import { searchAndLoadFile } from "../../utils/file.js";
import { JobConfig, JobConfigSchema, ServiceConfig, ServiceConfigSchema } from "./schemas.js";

const DEFAULT_JOB_NAME = "ax.job";
const DEFAULT_JOB_FORMATS = ["yaml", "yml", "json"];

export async function getJobConfig(
  path: string | null,
  context: {
    tracer?: TracingContext;
  },
): Promise<JobConfig> {
  const { tracer } = context;
  const { content, format } = await searchAndLoadFile(path, {
    defaults: {
      name: DEFAULT_JOB_NAME,
      formats: DEFAULT_JOB_FORMATS,
    },
    tag: "Job File",
  });

  let result: any = null;
  if (format === "json") {
    result = JSON.parse(content);
  } else if (format === "yaml" || format === "yml") {
    result = YAML.parse(content);
  } else {
    throw new Error("Invalid job file format");
  }
  tracer?.debug("Job config: " + JSON.stringify(result, null, 2));

  const parsed = JobConfigSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`The job file is not valid:\n${formatZodError(parsed.error)}`);
  }
  return parsed.data;
}

const DEFAULT_CONFIG_NAME = "ax.config";
const DEFAULT_CONFIG_FORMATS = ["yaml", "yml", "json"];

export async function getServiceConfig(
  configPath: string | null,
  context: {
    tracer?: TracingContext;
  },
): Promise<ServiceConfig> {
  const { tracer } = context;
  const { content, format } = await searchAndLoadFile(configPath, {
    defaults: {
      name: DEFAULT_CONFIG_NAME,
      formats: DEFAULT_CONFIG_FORMATS,
    },
    tag: "Config File",
  });

  let result: any = null;
  if (format === "json") {
    result = JSON.parse(content);
  } else if (format === "yaml" || format === "yml") {
    result = YAML.parse(content);
  } else {
    throw new Error("Invalid config file format");
  }
  tracer?.debug("Service config: " + JSON.stringify(result, null, 2));

  const parsed = ServiceConfigSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`The config file is not valid:\n${formatZodError(parsed.error)}`);
  }

  return parsed.data;
}

/**
 * Formats a Zod error into a readable string
 */
function formatZodError(error: z.ZodError<any>): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path || "root"}: ${issue.message}`;
    })
    .join("\n");
}
