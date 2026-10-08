import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";

export const CREDENTIALS_FILE = "credentials";
export const CONFIG_FILE = "cli.yaml";
export const SKILL_FILE = "SKILL.md";

/**
 * What a run reads from the project (not what it writes there), relative
 * to cwd: `.axle/cli.yaml`, `.axle/credentials`, and each skills directory
 * that holds at least one skill. These are the inputs folder trust gates.
 */
export async function listProjectInputs(cwd?: string): Promise<string[]> {
  const base = cwd ?? process.cwd();
  const dir = resolveConfigDirs({ cwd: base }).project;
  const present: string[] = [];
  for (const file of [CONFIG_FILE, CREDENTIALS_FILE]) {
    if (await exists(join(dir, file))) present.push(join(basename(dir), file));
  }
  for (const root of resolveSkillRoots({ cwd: base }).project) {
    if ((await listSkillDirs(root)).length > 0) present.push(relative(base, root));
  }
  return present;
}

export interface SkillRoots {
  /** Earlier roots win within a scope. */
  user: string[];
  project: string[];
}

/**
 * Where skills are looked for: our own `skills/` under each `.axle/`, and
 * the cross-client `.agents/skills/` convention beside it.
 */
export function resolveSkillRoots(options?: { cwd?: string; home?: string }): SkillRoots {
  const cwd = options?.cwd ?? process.cwd();
  const home = options?.home ?? homedir();
  return {
    user: [join(home, ".axle", "skills"), join(home, ".agents", "skills")],
    project: [join(cwd, ".axle", "skills"), join(cwd, ".agents", "skills")],
  };
}

/** The directories under `root` that hold a `SKILL.md`, sorted; none when `root` is absent. */
export async function listSkillDirs(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    if (await exists(join(dir, SKILL_FILE))) dirs.push(dir);
  }
  return dirs.sort();
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
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
