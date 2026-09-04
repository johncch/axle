import type { AgentDefinition, AgentSession, Turn } from "@fifthrevision/axle";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveConfigDirs } from "./configs/paths.js";

export interface CliSessionFile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  definition: AgentDefinition;
  /** Recipe-level compaction opt-out, carried so resume honors it. */
  compaction?: boolean;
  session: AgentSession;
  turns: Turn[];
}

export function sessionsDir(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "sessions", "cli");
}

export function sessionFilePath(sessionId: string, home?: string): string {
  return join(sessionsDir(home), `${sessionId}.json`);
}

async function resolveSessionId(sessionId: string, home?: string): Promise<string> {
  let entries: string[];
  try {
    entries = await readdir(sessionsDir(home));
  } catch {
    return sessionId;
  }
  const ids = entries.filter((e) => e.endsWith(".json")).map((e) => e.slice(0, -".json".length));
  if (ids.includes(sessionId)) return sessionId;

  const matches = ids.filter((id) => id.startsWith(sessionId));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Session id prefix "${sessionId}" is ambiguous (${matches.length} matches). Use more characters.`,
    );
  }
  return sessionId;
}

/** What `axle cleanup` needs: identity, size, age, and deletability-now. */
export interface SessionSummary {
  sessionId: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  corrupt: boolean;
}

export async function listSessionSummaries(home?: string): Promise<SessionSummary[]> {
  const dir = sessionsDir(home);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry): Promise<SessionSummary> => {
        const path = join(dir, entry);
        const sessionId = entry.slice(0, -".json".length);
        const stats = await stat(path);
        const base = {
          sessionId,
          path,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
        };
        try {
          const file = JSON.parse(await readFile(path, "utf-8")) as CliSessionFile;
          return { ...base, updatedAt: file.updatedAt ?? base.updatedAt, corrupt: false };
        } catch {
          return { ...base, corrupt: true };
        }
      }),
  );

  summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return summaries;
}

export async function loadSession(sessionId: string, home?: string): Promise<CliSessionFile> {
  const path = sessionFilePath(await resolveSessionId(sessionId, home), home);
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
  private readonly compaction?: boolean;
  private createdAt?: string;

  constructor(
    definition: AgentDefinition,
    options?: { cwd?: string; home?: string; createdAt?: string; compaction?: boolean },
  ) {
    this.definition = definition;
    this.cwd = options?.cwd ?? process.cwd();
    this.home = options?.home;
    this.compaction = options?.compaction;
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
      compaction: this.compaction,
      session,
      turns: [...turns],
    };

    await mkdir(sessionsDir(this.home), { recursive: true });
    const path = sessionFilePath(session.sessionId, this.home);
    await writeFileAtomic(path, JSON.stringify(file, null, 2));
    return path;
  }
}
