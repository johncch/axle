import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { writeFileAtomic } from "../atomic-write.js";
import { CONFIG_FILE, CREDENTIALS_FILE, resolveConfigDirs } from "./paths.js";

/**
 * Upsert keys in `~/.axle/credentials`. The file is shared with sibling
 * tools (axle-code writes it too): existing lines — comments, other tools'
 * keys — are preserved verbatim; only the given keys are replaced in place
 * or appended. Written atomically and chmod 600.
 */
export async function upsertCredentials(
  entries: Record<string, string>,
  home?: string,
): Promise<string> {
  const dir = resolveConfigDirs({ home }).user;
  const path = join(dir, CREDENTIALS_FILE);

  let existing = "";
  try {
    existing = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const lines = existing.length > 0 ? existing.split("\n") : [];
  if (lines.at(-1) === "") lines.pop();

  const remaining = new Map(Object.entries(entries));
  const replaced = new Set<string>();
  const updated: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    const key = match?.[1];
    if (key && remaining.has(key)) {
      updated.push(`${key}=${remaining.get(key)!}`);
      remaining.delete(key);
      replaced.add(key);
    } else if (key && replaced.has(key)) {
      // dotenv is last-wins: a surviving later duplicate would shadow the
      // value just written.
    } else {
      updated.push(line);
    }
  }
  for (const [key, value] of remaining) {
    updated.push(`${key}=${value}`);
  }

  await mkdir(dir, { recursive: true });
  await writeFileAtomic(path, updated.join("\n") + "\n", { mode: 0o600 });
  return path;
}

/**
 * Update `defaults.provider` / `defaults.models.<name>` in the user
 * `~/.axle/cli.yaml`, preserving unrelated keys and comments (parsed and
 * re-emitted as a YAML document, not a plain object).
 */
export async function updateCliDefaults(
  defaults: { provider?: string; models?: Record<string, string> },
  home?: string,
): Promise<string> {
  const dir = resolveConfigDirs({ home }).user;
  const path = join(dir, CONFIG_FILE);

  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const doc = YAML.parseDocument(content);
  if (defaults.provider !== undefined) {
    doc.setIn(["defaults", "provider"], defaults.provider);
  }
  for (const [name, model] of Object.entries(defaults.models ?? {})) {
    doc.setIn(["defaults", "models", name], model);
  }

  await mkdir(dir, { recursive: true });
  await writeFileAtomic(path, doc.toString());
  return path;
}
