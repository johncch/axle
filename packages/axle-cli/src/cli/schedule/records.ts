import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.js";
import { resolveConfigDirs } from "../configs/paths.js";

export interface ScheduleIdentity {
  id: string;
  recipePath: string;
}

/**
 * A schedule's identity is its recipe's canonical absolute path: the same
 * file applied again is an update, a moved file is a new schedule. The path
 * must exist so symlinks and case collapse to one identity.
 */
export async function resolveScheduleIdentity(recipe: string): Promise<ScheduleIdentity> {
  const recipePath = await realpath(recipe);
  return { id: scheduleIdFor(recipePath), recipePath };
}

export function scheduleIdFor(recipePath: string): string {
  return createHash("sha256").update(recipePath).digest("hex").slice(0, 16);
}

export function displayNameFor(recipeName: string | undefined, recipePath: string): string {
  return recipeName ?? basename(recipePath, extname(recipePath));
}

export const SCHEDULE_RECORD_VERSION = 1;

export const ScheduleTriggerSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("interval"), seconds: z.number().int().positive() }),
  z.strictObject({
    kind: z.literal("calendar"),
    times: z
      .array(
        z.strictObject({
          hour: z.number().int().min(0).max(23),
          minute: z.number().int().min(0).max(59),
        }),
      )
      .min(1),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).optional(),
  }),
]);

export const DesiredScheduleSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  recipePath: z.string(),
  cwd: z.string(),
  trigger: ScheduleTriggerSchema,
  programArguments: z.array(z.string()).min(1),
  path: z.string(),
  stdoutPath: z.string(),
  stderrPath: z.string(),
});

export type DesiredSchedule = z.infer<typeof DesiredScheduleSchema>;

export const BackendBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("launchd"),
    label: z.string(),
    plistPath: z.string(),
  }),
]);

export type BackendBinding = z.infer<typeof BackendBindingSchema>;

export const ScheduleRecordSchema = z.strictObject({
  version: z.literal(SCHEDULE_RECORD_VERSION),
  desired: DesiredScheduleSchema,
  binding: BackendBindingSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ScheduleRecord = z.infer<typeof ScheduleRecordSchema>;

export type ScheduleListEntry =
  | { kind: "record"; id: string; record: ScheduleRecord }
  | { kind: "unreadable"; id: string; reason: string };

export function schedulesDir(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "schedules");
}

export function scheduleLogsDir(home?: string): string {
  return join(resolveConfigDirs({ home }).user, "logs", "schedules");
}

export function scheduleRecordPath(id: string, home?: string): string {
  return join(schedulesDir(home), `${id}.json`);
}

export async function readScheduleRecord(
  id: string,
  home?: string,
): Promise<ScheduleRecord | undefined> {
  let content: string;
  try {
    content = await readFile(scheduleRecordPath(id, home), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  return parseScheduleRecord(content);
}

export async function writeScheduleRecord(record: ScheduleRecord, home?: string): Promise<string> {
  const dir = schedulesDir(home);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = scheduleRecordPath(record.desired.id, home);
  await writeFileAtomic(path, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  return path;
}

export async function deleteScheduleRecord(id: string, home?: string): Promise<void> {
  await rm(scheduleRecordPath(id, home), { force: true });
}

export async function listScheduleRecords(home?: string): Promise<ScheduleListEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(schedulesDir(home));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }

  const listed: ScheduleListEntry[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    const id = entry.slice(0, -".json".length);
    try {
      const content = await readFile(join(schedulesDir(home), entry), "utf-8");
      listed.push({ kind: "record", id, record: parseScheduleRecord(content) });
    } catch (e) {
      listed.push({ kind: "unreadable", id, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return listed;
}

function parseScheduleRecord(content: string): ScheduleRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    throw new Error("corrupt record (not valid JSON)");
  }
  const version = (raw as { version?: unknown })?.version;
  if (version !== SCHEDULE_RECORD_VERSION) {
    throw new Error(`unsupported record version ${JSON.stringify(version)}`);
  }
  const kind = (raw as { binding?: { kind?: unknown } })?.binding?.kind;
  const parsed = ScheduleRecordSchema.safeParse(raw);
  if (!parsed.success) {
    if (typeof kind === "string" && kind !== "launchd") {
      throw new Error(`unknown backend "${kind}"`);
    }
    throw new Error("corrupt record (schema mismatch)");
  }
  return parsed.data;
}

export const ScheduleRunSchema = z.strictObject({
  startedAt: z.string(),
  finishedAt: z.string(),
  status: z.enum(["succeeded", "failed"]),
  sessionIds: z.array(z.string()),
});

export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;

export function scheduleRunsPath(id: string, home?: string): string {
  return join(schedulesDir(home), `${id}.runs.jsonl`);
}

export async function appendScheduleRun(
  id: string,
  run: ScheduleRun,
  home?: string,
): Promise<void> {
  await mkdir(schedulesDir(home), { recursive: true, mode: 0o700 });
  await appendFile(scheduleRunsPath(id, home), JSON.stringify(run) + "\n", { mode: 0o600 });
}

/** Newest first. Lines that fail to parse are skipped. */
export async function readScheduleRuns(id: string, home?: string): Promise<ScheduleRun[]> {
  let content: string;
  try {
    content = await readFile(scheduleRunsPath(id, home), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const runs: ScheduleRun[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = ScheduleRunSchema.safeParse(JSON.parse(line));
      if (parsed.success) runs.push(parsed.data);
    } catch {
      continue;
    }
  }
  return runs.reverse();
}
