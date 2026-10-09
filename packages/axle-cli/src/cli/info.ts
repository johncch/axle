import type { ModelCatalog } from "@fifthrevision/axle";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { resolveTarget } from "./agent-config.js";
import type { CliConfigSources, Credentials } from "./configs/loaders.js";
import { API_KEY_VARIABLES } from "./configs/loaders.js";
import type { ConfigDirs } from "./configs/paths.js";
import { CONFIG_FILE, CREDENTIALS_FILE } from "./configs/paths.js";
import type { AIProviderUse, CliConfig, ServiceConfig } from "./configs/schemas.js";
import type { ContextWindowSource } from "./context-window.js";
import { formatTokens, resolveContextWindow } from "./context-window.js";
import type { SkillEntry } from "./skills.js";
import { defaultToolNames } from "./tools.js";

const BUILT_IN_PROVIDER_TYPES = ["anthropic", "openai", "gemini"] as const;

const UNSET = "unset";
const ALIGNED_VALUE_WIDTH = 32;

export interface InfoInput {
  version: string;
  build?: string;
  dirs: ConfigDirs;
  trusted: boolean;
  cliConfig: CliConfig;
  cliConfigSources: CliConfigSources;
  serviceConfig: ServiceConfig;
  credentialSources: Record<string, string>;
  skills: SkillEntry[];
  credentials: Credentials;
  catalog: ModelCatalog;
}

interface Row {
  label: string;
  value: string;
  source?: string;
}

/**
 * `axle info`: a plain-text dump of what the CLI resolved — version, runtime,
 * config files, defaults, and providers — with the file or environment that
 * supplied each value. API keys are reported as set or unset, never printed.
 */
export function formatInfo(input: InfoInput): string[] {
  const { version, build, dirs, trusted, cliConfig, cliConfigSources, serviceConfig, skills } =
    input;
  const cwd = dirname(dirs.project);
  const home = dirname(dirs.user);

  const displayPath = (source: string | undefined): string | undefined => {
    if (source === undefined) return undefined;
    if (source.startsWith(cwd + "/")) return `./${relative(cwd, source)}`;
    if (source.startsWith(home + "/")) return `~/${relative(home, source)}`;
    return source;
  };

  const files = [dirs.user, dirs.project].flatMap((dir) =>
    [CONFIG_FILE, CREDENTIALS_FILE].map((file) => ({
      path: join(dir, file),
      gated: dir === dirs.project && !trusted,
    })),
  );

  const defaultProvider = cliConfig.defaults?.provider;
  const defaults: Row[] = [
    {
      label: "provider",
      value: defaultProvider ?? UNSET,
      source: displayPath(cliConfigSources.defaultProvider),
    },
    {
      label: "tools",
      value: (cliConfig.defaults?.tools ?? defaultToolNames).join(", "),
      source: displayPath(cliConfigSources.defaultTools) ?? "built-in default",
    },
  ];

  const profiles = cliConfig.providers ?? {};
  const builtIns = BUILT_IN_PROVIDER_TYPES.filter((type) => !(type in profiles));
  const configuredBuiltIns = builtIns.filter(
    (type) => serviceConfig[type] !== undefined || type === defaultProvider,
  );

  const providerBlocks = [
    ...Object.entries(profiles).map(([name, profile]) => ({
      title: `${name}${name === defaultProvider ? " (default)" : ""}`,
      source: displayPath(cliConfigSources.providers[name]),
      rows: describeProvider(name, profile.type, profile, input),
    })),
    ...configuredBuiltIns.map((type) => ({
      title: `${type}${type === defaultProvider ? " (default)" : ""}`,
      source: undefined,
      rows: describeProvider(type, type, undefined, input),
    })),
  ];

  const lines = [
    `axle ${version}${build ? ` · ${build}` : ""} · ${describeRuntime()} · ${process.platform} ${process.arch}`,
    `cwd ${cwd} · ${trusted ? "trusted" : "not trusted (run axle trust)"}`,
    "",
    "Config files",
    ...formatRows(
      "  ",
      files.map(({ path, gated }) => ({
        label: displayPath(path) ?? path,
        value: !existsSync(path) ? "missing" : gated ? "found, ignored" : "found",
      })),
    ),
    "",
    "Skills",
    ...(skills.length > 0
      ? formatRows(
          "  ",
          skills.map((entry) => ({
            label: displayPath(entry.dir) ?? entry.dir,
            value: describeSkillOutcome(entry, displayPath),
          })),
        )
      : ["  none"]),
    "",
    "Defaults",
    ...formatRows("  ", defaults),
    ...defaultProviderProblem(cliConfig, serviceConfig).map((problem) => `  ✖ ${problem}`),
    "",
    "Providers",
    ...providerBlocks.flatMap((block) => [
      ...formatProviderBlock(
        block.title,
        block.source,
        block.rows.map((row) => ({ ...row, source: displayPath(row.source) })),
      ),
      "",
    ]),
    ...(providerBlocks.length === 0 ? ["  none"] : []),
  ];
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

function describeSkillOutcome(
  entry: SkillEntry,
  displayPath: (source: string | undefined) => string | undefined,
): string {
  switch (entry.outcome.kind) {
    case "loaded":
      return "found";
    case "ignored":
      return "found, ignored";
    case "shadowed":
      return `shadowed by ${displayPath(entry.outcome.by) ?? entry.outcome.by}`;
    case "failed":
      return `invalid: ${entry.outcome.reason}`;
  }
}

function describeRuntime(): string {
  const bun = process.versions.bun;
  return bun === undefined ? `node ${process.version}` : `bun ${bun}`;
}

function defaultProviderProblem(cliConfig: CliConfig, serviceConfig: ServiceConfig): string[] {
  try {
    resolveTarget(undefined, cliConfig, serviceConfig);
    return [];
  } catch (e) {
    return [e instanceof Error ? e.message : String(e)];
  }
}

function describeProvider(
  name: string,
  type: AIProviderUse["type"],
  profile: AIProviderUse | undefined,
  input: InfoInput,
): Row[] {
  const { cliConfig, cliConfigSources, serviceConfig, credentialSources, credentials } = input;
  const builtIn = type === "chatcompletions" ? undefined : type;
  const service = builtIn ? serviceConfig[builtIn] : undefined;
  const rows: Row[] = [];

  if (profile) rows.push({ label: "type", value: type });

  if (profile?.type === "chatcompletions") {
    rows.push({ label: "url", value: profile.baseUrl });
  }

  const defaultModel = cliConfig.defaults?.models?.[name];
  if (defaultModel !== undefined) {
    rows.push({
      label: "model",
      value: defaultModel,
      source: cliConfigSources.defaultModels[name],
    });
  } else {
    rows.push({
      label: "model",
      value: service?.model ?? UNSET,
      source: service?.model ? credentialSources[`${type.toUpperCase()}_MODEL`] : undefined,
    });
  }

  const model = defaultModel ?? service?.model;
  if (model !== undefined) {
    const { type: _profileType, ...profileConfig } = profile ?? { type };
    const resolved = resolveContextWindow(
      { type, config: { ...service, ...profileConfig } },
      model,
      input.catalog,
    );
    rows.push({
      label: "window",
      value: formatTokens(resolved.window),
      source: describeWindowSource(resolved.source, name, input),
    });
  }

  const apiKeyEnv = profile?.apiKeyEnv;
  if (apiKeyEnv) {
    rows.push(
      credentials[apiKeyEnv]
        ? { label: "key", value: `$${apiKeyEnv}`, source: credentialSources[apiKeyEnv] }
        : { label: "key", value: `$${apiKeyEnv}`, source: UNSET },
    );
  } else if (profile?.apiKey) {
    rows.push({ label: "key", value: "set", source: cliConfigSources.providers[name] });
  } else if (builtIn === undefined) {
    rows.push({ label: "key", value: "none" });
  } else {
    const variable = API_KEY_VARIABLES[builtIn];
    rows.push({
      label: "key",
      value: `$${variable}`,
      source: service?.apiKey ? credentialSources[variable] : UNSET,
    });
  }

  return rows;
}

function describeWindowSource(
  source: ContextWindowSource,
  providerName: string,
  input: InfoInput,
): string | undefined {
  switch (source.kind) {
    case "provider":
      return input.cliConfigSources.providers[providerName];
    case "catalog":
      return `models.dev (${source.id})`;
    case "assumed":
      return input.catalog.size === 0 ? "assumed (models.dev not cached)" : "assumed";
  }
}

function formatProviderBlock(title: string, source: string | undefined, rows: Row[]): string[] {
  const { labelWidth, valueWidth } = columnWidths(rows);
  const heading = `  ${title}`;
  const rowIndent = "    ";
  const sourceColumn = rowIndent.length + labelWidth + 2 + valueWidth + 2;
  return [
    source === undefined ? heading : `${heading.padEnd(sourceColumn - 2)}  ${source}`,
    ...formatRows(rowIndent, rows),
  ];
}

function formatRows(indent: string, rows: Row[]): string[] {
  const { labelWidth, valueWidth } = columnWidths(rows);
  return rows.map((row) => {
    const label = row.label.padEnd(labelWidth);
    if (row.source === undefined) return `${indent}${label}  ${row.value}`;
    return `${indent}${label}  ${row.value.padEnd(valueWidth)}  ${row.source}`;
  });
}

function columnWidths(rows: Row[]): { labelWidth: number; valueWidth: number } {
  return {
    labelWidth: Math.max(...rows.map((row) => row.label.length)),
    valueWidth: Math.max(
      0,
      ...rows.map((row) => row.value.length).filter((length) => length <= ALIGNED_VALUE_WIDTH),
    ),
  };
}
