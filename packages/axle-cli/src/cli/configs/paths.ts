import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const CREDENTIALS_FILE = "credentials";
export const CONFIG_FILE = "cli.yaml";

/**
 * The files a run reads from the project's `.axle/` (not what it writes
 * there), as `.axle/<file>`: the inputs folder trust gates.
 */
export async function listProjectInputs(cwd?: string): Promise<string[]> {
  const dir = resolveConfigDirs({ cwd }).project;
  const present: string[] = [];
  for (const file of [CONFIG_FILE, CREDENTIALS_FILE]) {
    const exists = await access(join(dir, file)).then(
      () => true,
      () => false,
    );
    if (exists) present.push(join(basename(dir), file));
  }
  return present;
}

export interface ConfigDirs {
  project: string;
  user: string;
}

export function resolveConfigDirs(options?: { cwd?: string; home?: string }): ConfigDirs {
  return {
    project: join(options?.cwd ?? process.cwd(), ".axle"),
    user: join(options?.home ?? homedir(), ".axle"),
  };
}
