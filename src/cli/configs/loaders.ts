import YAML from "yaml";
import { ZodError } from "zod";
import { Recorder } from "../../recorder/recorder.js";
import { searchAndLoadFile } from "../../utils/file.js";
import { jobConfigSchema, serviceConfigSchema } from "./schemas.js";
import { JobConfig, ServiceConfig } from "./types.js";

const DEFAULT_JOB_NAME = "ax.job";
const DEFAULT_JOB_FORMATS = ["yaml", "yml", "json"];

export async function getJobConfig(
  path: string | null,
  context: {
    recorder?: Recorder;
  },
): Promise<JobConfig> {
  const { recorder } = context;
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
  recorder?.debug?.heading.log("The Job Object");
  recorder?.debug?.log(result);

  try {
    return jobConfigSchema.parse(result);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`The job file is not valid: ${errorMessages}`);
    }
    throw error;
  }
}

const DEFAULT_CONFIG_NAME = "ax.config";
const DEFAULT_CONFIG_FORMATS = ["yaml", "yml", "json"];

export async function getServiceConfig(
  configPath: string | null,
  context: {
    recorder?: Recorder;
  },
): Promise<ServiceConfig> {
  const { recorder } = context;
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
  recorder?.debug?.heading.log("The Config Object");
  recorder?.debug?.log(result);

  try {
    return serviceConfigSchema.parse(result);
  } catch (error) {
    if (error instanceof ZodError) {
      const errorMessages = error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`The config file is not valid: ${errorMessages}`);
    }
    throw error;
  }
}
