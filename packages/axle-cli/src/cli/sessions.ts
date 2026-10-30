import type { AgentSession, Stats, Turn } from "@fifthrevision/axle";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./atomic-write.js";
import { resolveConfigDirs } from "./configs/paths.js";
import type { AgentRecipe } from "./configs/schemas.js";
import { AgentRecipeSchema } from "./configs/schemas.js";

export interface CliSessionFile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  /** The recipe's agent keys as written; `{}` for chat and one-shot. */
  recipe: AgentRecipe;
  session: AgentSession;
  turns: Turn[];
  /** Lifetime usage of the session, every request row included; absent in files written before 0.35. */
  meter?: Stats;
}

// Files written before 2026-10-29 carried the recipe in core's AgentDefinition
// shape (`tools: [{ name }]`, `provider: { type, config }`), with the resolved
// provider and model filled in even when the recipe left them out.
interface LegacySessionFile {
  version: 1;
  createdAt: string;
  updatedAt: string;
  cwd: string;
  definition: {
    version: 1;
    name?: string;
    provider: { type: string; config?: Record<string, unknown> };
    model?: string;
    system?: string;
    request?: Record<string, unknown>;
    tools?: { name: string }[];
    providerTools?: { name: string }[];
    mcps?: unknown[];
  };
  compaction?: boolean;
  session: AgentSession;
  turns: Turn[];
}

const VENDOR_DIALECTS: Record<string, "openrouter" | "together"> = {
  openrouter: "openrouter",
  togetherai: "together",
};

class SessionProviderError extends Error {}

// Recipes saved before 0.35 wrote an inline provider with `type`: the
// protocol for chatcompletions, otherwise a built-in name.
function upgradeInlineProvider(
  provider: Record<string, unknown>,
): Record<string, unknown> | string {
  const { type, vendor, ...config } = provider;
  if (typeof type !== "string") return provider;
  if (type !== "chatcompletions") {
    const settings = Object.keys(provider).filter((key) => key !== "type");
    if (settings.length > 0) {
      throw new SessionProviderError(
        `This session's provider sets ${settings.join(", ")} on "${type}", which a saved session can no longer carry. Put it in providers.${type} in cli.yaml and start a new run.`,
      );
    }
    return type;
  }
  return {
    protocol: "chatCompletions",
    ...config,
    ...(typeof vendor === "string" ? { id: vendor, dialect: VENDOR_DIALECTS[vendor] } : {}),
  };
}

function fromLegacy(file: LegacySessionFile): CliSessionFile {
  const { version: _, provider, tools, providerTools, ...rest } = file.definition;
  const recipe = AgentRecipeSchema.parse({
    ...rest,
    provider: provider.config
      ? upgradeInlineProvider({ type: provider.type, ...provider.config })
      : provider.type,
    tools: tools?.map((ref) => ref.name),
    providerTools: providerTools?.map((ref) => ref.name),
    compaction: file.compaction,
  });
  return {
    version: 1,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    cwd: file.cwd,
    recipe,
    session: file.session,
    turns: file.turns,
  };
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

  const file = parsed as CliSessionFile | LegacySessionFile;
  if (file?.version !== 1 || !file.session) {
    throw new Error(`Unsupported or corrupt session file at ${path}`);
  }
  if ("definition" in file) {
    try {
      return fromLegacy(file);
    } catch (e) {
      if (e instanceof SessionProviderError) throw e;
      throw new Error(`Unsupported or corrupt session file at ${path}`);
    }
  }
  if (!file.recipe) {
    throw new Error(`Unsupported or corrupt session file at ${path}`);
  }
  const saved: unknown = file.recipe.provider;
  if (saved && typeof saved === "object" && "type" in saved) {
    const upgraded = upgradeInlineProvider({ ...saved });
    try {
      const { provider } = AgentRecipeSchema.parse({ provider: upgraded });
      return { ...file, recipe: { ...file.recipe, provider } };
    } catch {
      throw new Error(`Unsupported or corrupt session file at ${path}`);
    }
  }
  return file;
}

/**
 * Persists resumable CLI sessions to `~/.axle/sessions/cli/<id>.json`.
 *
 * One store instance covers one run: it captures the recipe and cwd at
 * construction and rewrites the whole file on every save.
 */
export class SessionStore {
  private readonly recipe: AgentRecipe;
  private readonly cwd: string;
  private readonly home?: string;
  private createdAt?: string;
  savedSessionId?: string;

  constructor(recipe: AgentRecipe, options?: { cwd?: string; home?: string; createdAt?: string }) {
    this.recipe = recipe;
    this.cwd = options?.cwd ?? process.cwd();
    this.home = options?.home;
    this.createdAt = options?.createdAt;
  }

  async save(session: AgentSession, turns: readonly Turn[], meter: Stats): Promise<string> {
    this.createdAt ??= new Date().toISOString();
    const file: CliSessionFile = {
      version: 1,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
      cwd: this.cwd,
      recipe: this.recipe,
      session,
      turns: [...turns],
      meter,
    };

    await mkdir(sessionsDir(this.home), { recursive: true });
    const path = sessionFilePath(session.sessionId, this.home);
    await writeFileAtomic(path, JSON.stringify(file, null, 2));
    this.savedSessionId = session.sessionId;
    return path;
  }
}
