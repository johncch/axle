import type { Span } from "@fifthrevision/axle";
import { parse as parseDotenv } from "dotenv";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
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

  return parsed.data;
}

/**
 * Where a loader looks. `trusted: false` confines it to the user home; the
 * project's `.axle/` is never read (see cli.md, folder trust).
 */
export interface ConfigContext {
  trusted: boolean;
  cwd?: string;
  home?: string;
}

export async function getServiceConfig(
  context: ConfigContext & { span?: Span },
): Promise<ServiceConfig> {
  const { span } = context;
  const layers = await loadCredentialLayers(context);

  const lookup = (key: string): string | undefined => {
    for (const layer of layers) {
      if (layer.values[key]) return layer.values[key];
    }
    return undefined;
  };

  const config = buildServiceConfig(lookup);
  span?.debug("Service config: " + JSON.stringify(redactConfig(config), null, 2));
  return config;
}

export const ENVIRONMENT_SOURCE = "environment";

export const API_KEY_VARIABLES = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  chatcompletions: "CHATCOMPLETIONS_API_KEY",
} as const;

/**
 * Maps each credential variable to where its effective value comes from:
 * "environment" or a `credentials` file path.
 */
export async function getCredentialSources(
  context: ConfigContext,
): Promise<Record<string, string>> {
  const layers = await loadCredentialLayers(context);
  const sources: Record<string, string> = {};
  for (const layer of layers.toReversed()) {
    for (const [key, value] of Object.entries(layer.values)) {
      if (value) sources[key] = layer.source;
    }
  }
  return sources;
}

interface CredentialLayer {
  source: string;
  values: Record<string, string | undefined>;
}

async function loadCredentialLayers(context: ConfigContext): Promise<CredentialLayer[]> {
  const layers: CredentialLayer[] = [{ source: ENVIRONMENT_SOURCE, values: process.env }];

  const dirs = resolveConfigDirs(context);
  for (const dir of context.trusted ? [dirs.project, dirs.user] : [dirs.user]) {
    const path = join(dir, CREDENTIALS_FILE);
    const parsed = await readCredentialsFile(path);
    if (parsed) layers.push({ source: path, values: parsed });
  }
  return layers;
}

export async function getCliConfig(context: ConfigContext & { span?: Span }): Promise<CliConfig> {
  const { span } = context;

  let merged: CliConfig = {};
  for (const layer of await loadCliConfigLayers(context)) {
    merged = mergeCliConfig(merged, layer.config);
  }

  span?.debug("CLI config: " + JSON.stringify(merged, null, 2));
  return merged;
}

export interface CliConfigSources {
  providers: Record<string, string>;
  defaultProvider?: string;
  defaultTools?: string;
  defaultModels: Record<string, string>;
}

/**
 * Names the `cli.yaml` path that supplies each merged value, following the
 * same precedence as `getCliConfig`.
 */
export async function getCliConfigSources(context: ConfigContext): Promise<CliConfigSources> {
  const sources: CliConfigSources = { providers: {}, defaultModels: {} };
  for (const { path, config } of await loadCliConfigLayers(context)) {
    for (const name of Object.keys(config.providers ?? {})) sources.providers[name] = path;
    if (config.defaults?.provider !== undefined) sources.defaultProvider = path;
    if (config.defaults?.tools !== undefined) sources.defaultTools = path;
    for (const name of Object.keys(config.defaults?.models ?? {})) {
      sources.defaultModels[name] = path;
    }
  }
  return sources;
}

interface CliConfigLayer {
  path: string;
  config: CliConfig;
}

async function loadCliConfigLayers(context: ConfigContext): Promise<CliConfigLayer[]> {
  const dirs = resolveConfigDirs(context);

  const layers: CliConfigLayer[] = [];
  for (const dir of context.trusted ? [dirs.user, dirs.project] : [dirs.user]) {
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
    layers.push({ path, config: parsed.data });
  }
  return layers;
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
    openai: lookup(API_KEY_VARIABLES.openai)
      ? {
          apiKey: lookup(API_KEY_VARIABLES.openai),
          model: lookup("OPENAI_MODEL"),
        }
      : undefined,
    anthropic: lookup(API_KEY_VARIABLES.anthropic)
      ? {
          apiKey: lookup(API_KEY_VARIABLES.anthropic),
          model: lookup("ANTHROPIC_MODEL"),
        }
      : undefined,
    gemini: lookup(API_KEY_VARIABLES.gemini)
      ? {
          apiKey: lookup(API_KEY_VARIABLES.gemini),
          model: lookup("GEMINI_MODEL"),
        }
      : undefined,
    chatcompletions: lookup("CHATCOMPLETIONS_BASE_URL")
      ? {
          baseUrl: lookup("CHATCOMPLETIONS_BASE_URL"),
          model: lookup("CHATCOMPLETIONS_MODEL"),
          apiKey: lookup(API_KEY_VARIABLES.chatcompletions),
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
