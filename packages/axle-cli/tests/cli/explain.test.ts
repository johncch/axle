import { describe, expect, it } from "vitest";
import { CliConfigSchema, JobConfigSchema } from "../../src/cli/configs/schemas.js";
import { formatExplain } from "../../src/cli/explain.js";

const WIDE = 1000;

function keysOf(lines: string[]): string[] {
  return lines.filter((line) => /^  \S/.test(line)).map((line) => line.trim().split(/\s+/)[0]);
}

function fieldsOf(lines: string[]): string[] {
  const firstField = lines.indexOf("");
  return firstField === -1 ? [] : lines.slice(firstField + 1);
}

describe("formatExplain", () => {
  it("lists the top-level keys of both config files", () => {
    const lines = formatExplain(undefined, WIDE);
    const split = lines.findIndex((line) => line.startsWith("config  "));

    expect(lines.slice(0, 3)).toEqual([
      "Run axle explain <path> for one key, e.g. axle explain recipe.batch",
      "",
      "recipe  a recipe file, run with axle -j",
    ]);
    expect(keysOf(lines.slice(0, split))).toEqual(Object.keys(JobConfigSchema.shape));
    expect(keysOf(lines.slice(split))).toEqual(Object.keys(CliConfigSchema.shape));
  });

  it("describes every key at every depth", () => {
    const undescribed: string[] = [];
    const visit = (path: string): void => {
      const lines = formatExplain(path, WIDE);
      if (path.includes(".") && !/^  \S/.test(lines[1] ?? "")) undescribed.push(path);
      for (const key of keysOf(fieldsOf(lines))) visit(`${path}.${key}`);
    };
    visit("recipe");
    visit("config");

    expect(undescribed).toEqual([]);
  });

  it("describes one key with its type, default, and description", () => {
    expect(formatExplain("recipe.batch.concurrency", WIDE)).toEqual([
      "recipe.batch.concurrency  integer  (default 3)",
      "  Inputs processed in parallel.",
    ]);
  });

  it("lists the keys beneath a key, marking required ones", () => {
    expect(formatExplain("recipe.batch", WIDE).slice(0, 5)).toEqual([
      "recipe.batch  object",
      "  Run the recipe once per input file, each in its own session.",
      "",
      "  files  string  (required)",
      "    Glob of input files. Each match runs as its own session, available as {{file}}.",
    ]);
    expect(keysOf(fieldsOf(formatExplain("recipe.batch", WIDE)))).toEqual([
      "files",
      "concurrency",
      "incremental",
    ]);
  });

  it("names the keys that can be explained one level down", () => {
    const lines = formatExplain("config", WIDE);

    expect(lines[lines.indexOf("  defaults  object") + 2]).toBe(
      "    keys: provider, models, tools",
    );
  });

  it("shows the literal values of a union alongside its object form", () => {
    const lines = formatExplain("recipe.request.reasoning", WIDE);

    expect(lines[0]).toBe("recipe.request.reasoning  default | off | on | object");
    expect(keysOf(fieldsOf(lines))).toEqual(["effort", "display"]);
  });

  it("walks through lists and names the variant a key belongs to", () => {
    const lines = formatExplain("recipe.mcps", WIDE);

    expect(lines).toContain("  transport  stdio | http  (required)");
    expect(lines).toContain("  command  string  (required; only with transport: stdio)");
    expect(formatExplain("recipe.mcps.url", WIDE)[0]).toBe(
      "recipe.mcps.url  string  (required; only with transport: http)",
    );
  });

  it("walks through maps", () => {
    expect(formatExplain("config.providers.vendor", WIDE)[0]).toBe(
      "config.providers.vendor  openrouter | together  (only with type: chatcompletions)",
    );
  });

  it("does not mark keys of alternative shapes as required", () => {
    const lines = formatExplain("recipe.schedule", WIDE);

    expect(lines).toContain("  every  string");
    expect(lines).toContain("  at  string | list of string");
  });

  it("wraps descriptions and key lists at the given width", () => {
    const lines = formatExplain(undefined, 60);

    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(60);
    expect(lines).toContain("    keys: reasoning, maxOutputTokens, toolChoice,");
    expect(lines).toContain("    parallelToolCalls, providerOptions");
  });

  it("names the valid keys when a path segment is unknown", () => {
    expect(() => formatExplain("recipe.batch.nope", WIDE)).toThrow(
      'Unknown key "nope" in recipe.batch. Keys: files, concurrency, incremental.',
    );
    expect(() => formatExplain("nope", WIDE)).toThrow(
      'Unknown config "nope". Expected recipe or config.',
    );
    expect(() => formatExplain("recipe.model.nope", WIDE)).toThrow(
      "recipe.model has no keys beneath it.",
    );
  });
});
