import type { Span } from "@fifthrevision/axle";
import { config as loadDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import YAML from "yaml";
import * as z from "zod";
import { JobConfig, JobConfigSchema, ServiceConfig } from "./schemas.js";

export async function getJobConfig(
  path: string,
  context: {
    span?: Span;
  },
): Promise<JobConfig> {
  const { span } = context;
  const format = extname(path).slice(1);
  if (format !== "yaml" && format !== "yml") {
    throw new Error("Invalid job file format. Expected .yaml or .yml");
  }

  let content: string;
  try {
    content = await readFile(path, { encoding: "utf-8" });
  } catch (e) {
    throw new Error("Job File not found, see --help for details");
  }

  const result = YAML.parse(content);
  span?.debug("Job config: " + JSON.stringify(result, null, 2));

  const parsed = JobConfigSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`The job file is not valid:\n${formatZodError(parsed.error)}`);
  }

  if (!parsed.data.name) {
    parsed.data.name = basename(path, extname(path));
  }

  return parsed.data;
}

export async function getServiceConfig(context: { span?: Span }): Promise<ServiceConfig> {
  const { span } = context;
  loadDotenv({ quiet: true });

  const envConfig = getEnvServiceConfig();
  span?.debug("Service config: " + JSON.stringify(redactConfig(envConfig), null, 2));
  return envConfig;
}

function getEnvServiceConfig(): ServiceConfig {
  return compactServiceConfig({
    openai: process.env.OPENAI_API_KEY
      ? {
          "api-key": process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL,
        }
      : undefined,
    anthropic: process.env.ANTHROPIC_API_KEY
      ? {
          "api-key": process.env.ANTHROPIC_API_KEY,
          model: process.env.ANTHROPIC_MODEL,
        }
      : undefined,
    gemini: process.env.GEMINI_API_KEY
      ? {
          "api-key": process.env.GEMINI_API_KEY,
          model: process.env.GEMINI_MODEL,
        }
      : undefined,
    chatcompletions:
      process.env.CHATCOMPLETIONS_BASE_URL && process.env.CHATCOMPLETIONS_MODEL
        ? {
            "base-url": process.env.CHATCOMPLETIONS_BASE_URL,
            model: process.env.CHATCOMPLETIONS_MODEL,
            "api-key": process.env.CHATCOMPLETIONS_API_KEY,
          }
        : undefined,
  });
}

function compactServiceConfig(config: ServiceConfig): ServiceConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value && Object.keys(value).length > 0),
  ) as ServiceConfig;
}

function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfig(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSecretKey(key) && entry ? "[redacted]" : redactConfig(entry),
    ]),
  );
}

function isSecretKey(key: string): boolean {
  return key === "api-key" || key.toLowerCase().includes("secret");
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
