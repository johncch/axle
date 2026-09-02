import { homedir } from "node:os";
import { join } from "node:path";

export const CREDENTIALS_FILE = "credentials";
export const CONFIG_FILE = "cli.yaml";

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
