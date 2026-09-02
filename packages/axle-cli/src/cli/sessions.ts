import type { AgentDefinition, AgentSession, Turn } from "@fifthrevision/axle";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveConfigDirs } from "./configs/paths.js";

export interface CliSessionFile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  definition: AgentDefinition;
  session: AgentSession;
  turns: Turn[];
}

export function sessionsDir(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "sessions", "cli");
}

export function sessionFilePath(sessionId: string, home?: string): string {
  return join(sessionsDir(home), `${sessionId}.json`);
}

export async function loadSession(sessionId: string, home?: string): Promise<CliSessionFile> {
  const path = sessionFilePath(sessionId, home);
  let content: string;
  try {
    content = await readFile(path, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No session found with id ${sessionId}`);
    }
    throw e;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid session file at ${path}`);
  }

  const file = parsed as CliSessionFile;
  if (file?.version !== 1 || !file.definition || !file.session) {
    throw new Error(`Unsupported or corrupt session file at ${path}`);
  }
  return file;
}

/**
 * Persists resumable CLI sessions to `~/.axle/sessions/cli/<id>.json`.
 *
 * One store instance covers one run: it captures the definition and cwd at
 * construction and rewrites the whole file on every save.
 */
export class SessionStore {
  private readonly definition: AgentDefinition;
  private readonly cwd: string;
  private readonly home?: string;
  private createdAt?: string;

  constructor(
    definition: AgentDefinition,
    options?: { cwd?: string; home?: string; createdAt?: string },
  ) {
    this.definition = definition;
    this.cwd = options?.cwd ?? process.cwd();
    this.home = options?.home;
    this.createdAt = options?.createdAt;
  }

  async save(session: AgentSession, turns: readonly Turn[]): Promise<string> {
    this.createdAt ??= new Date().toISOString();
    const file: CliSessionFile = {
      version: 1,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      cwd: this.cwd,
      definition: this.definition,
      session,
      turns: [...turns],
    };

    await mkdir(sessionsDir(this.home), { recursive: true });
    const path = sessionFilePath(session.sessionId, this.home);
    // Write-then-rename so a Ctrl-C mid-save never truncates the session file.
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, JSON.stringify(file, null, 2));
    await rename(tmpPath, path);
    return path;
  }
}
