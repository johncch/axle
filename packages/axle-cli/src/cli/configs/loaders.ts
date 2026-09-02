import type { Span } from "@fifthrevision/axle";
import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import YAML from "yaml";
import * as z from "zod";
import { CONFIG_FILE, CREDENTIALS_FILE, resolveConfigDirs } from "./paths.js";
import {
  CliConfig,
  CliConfigSchema,
  JobConfig,
  JobConfigSchema,
  ServiceConfig,
} from "./schemas.js";

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

export async function getServiceConfig(context: {
  span?: Span;
  cwd?: string;
  home?: string;
}): Promise<ServiceConfig> {
  const { span } = context;
  loadDotenv({ quiet: true });

  const dirs = resolveConfigDirs(context);
  const layers: Record<string, string | undefined>[] = [process.env];
  for (const dir of [dirs.project, dirs.user]) {
    const parsed = await readCredentialsFile(join(dir, CREDENTIALS_FILE));
    if (parsed) layers.push(parsed);
  }

  const lookup = (key: string): string | undefined => {
    for (const layer of layers) {
      if (layer[key]) return layer[key];
    }
    return undefined;
  };

  const config = buildServiceConfig(lookup);
  span?.debug("Service config: " + JSON.stringify(redactConfig(config), null, 2));
  return config;
}

export async function getCliConfig(context: {
  span?: Span;
  cwd?: string;
  home?: string;
}): Promise<CliConfig> {
  const { span } = context;
  const dirs = resolveConfigDirs(context);

  let merged: CliConfig = {};
  for (const dir of [dirs.user, dirs.project]) {
    const path = join(dir, CONFIG_FILE);
    const content = await readOptionalFile(path);
    if (content === null) continue;

    let raw: unknown;
    try {
      raw = YAML.parse(content) ?? {};
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid config file at ${path}:\n  ${message}`);
    }

    const parsed = CliConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Invalid config file at ${path}:\n${formatZodError(parsed.error)}`);
    }
    merged = mergeCliConfig(merged, parsed.data);
  }

  span?.debug("CLI config: " + JSON.stringify(merged, null, 2));
  return merged;
}

// Provider profiles replace wholesale across layers; field-merging two
// profiles can produce a shape neither file's validation would accept.
function mergeCliConfig(base: CliConfig, override: CliConfig): CliConfig {
  const merged: CliConfig = {};

  const providers = { ...base.providers, ...override.providers };
  if (Object.keys(providers).length > 0) merged.providers = providers;

  if (base.defaults || override.defaults) {
    merged.defaults = { ...base.defaults, ...override.defaults };
    const models = { ...base.defaults?.models, ...override.defaults?.models };
    if (Object.keys(models).length > 0) merged.defaults.models = models;
  }

  return merged;
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, { encoding: "utf-8" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

async function readCredentialsFile(path: string): Promise<Record<string, string> | null> {
  const content = await readOptionalFile(path);
  return content === null ? null : parseDotenv(content);
}

function buildServiceConfig(lookup: (key: string) => string | undefined): ServiceConfig {
  return compactServiceConfig({
    openai: lookup("OPENAI_API_KEY")
      ? {
          apiKey: lookup("OPENAI_API_KEY"),
          model: lookup("OPENAI_MODEL"),
        }
      : undefined,
    anthropic: lookup("ANTHROPIC_API_KEY")
      ? {
          apiKey: lookup("ANTHROPIC_API_KEY"),
          model: lookup("ANTHROPIC_MODEL"),
        }
      : undefined,
    gemini: lookup("GEMINI_API_KEY")
      ? {
          apiKey: lookup("GEMINI_API_KEY"),
          model: lookup("GEMINI_MODEL"),
        }
      : undefined,
    chatcompletions: lookup("CHATCOMPLETIONS_BASE_URL")
      ? {
          baseUrl: lookup("CHATCOMPLETIONS_BASE_URL"),
          model: lookup("CHATCOMPLETIONS_MODEL"),
          apiKey: lookup("CHATCOMPLETIONS_API_KEY"),
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
  return key === "apiKey" || key.toLowerCase().includes("secret");
}

/**
 * Formats a Zod error into a readable string
 */
function formatZodError(error: z.ZodError<any>): string {
  return error.issues
    .flatMap((issue) => flattenIssue(issue, issue.path))
    .map(({ path, message }) => `  - ${path.join(".") || "root"}: ${message}`)
    .join("\n");
}

function flattenIssue(
  issue: z.core.$ZodIssue,
  path: PropertyKey[],
): { path: PropertyKey[]; message: string }[] {
  if (issue.code === "invalid_union") {
    const branches = issue.errors.flatMap((branch) =>
      branch.flatMap((sub) => flattenIssue(sub, [...path, ...sub.path])),
    );
    if (!branches.length) return [{ path, message: issue.message }];
    const deeper = branches.filter((entry) => entry.path.length > path.length);
    return deeper.length ? deeper : branches;
  }
  return [{ path, message: issue.message }];
}
