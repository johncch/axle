import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeFileAtomic } from "../atomic-write.js";
import { resolveConfigDirs } from "../configs/paths.js";

export const SCHEDULE_RECORD_VERSION = 1;

export const DesiredScheduleSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  recipePath: z.string(),
  cwd: z.string(),
  intervalSeconds: z.number().int().positive(),
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

export async function resolveScheduleId(idOrPrefix: string, home?: string): Promise<string> {
  const ids = (await listScheduleRecords(home)).map((entry) => entry.id);
  if (ids.includes(idOrPrefix)) return idOrPrefix;

  const matches = ids.filter((id) => id.startsWith(idOrPrefix));
  if (matches.length === 0) {
    throw new Error(`No schedule found with id ${idOrPrefix}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Schedule id prefix "${idOrPrefix}" is ambiguous (${matches.length} matches). Use more characters.`,
    );
  }
  return matches[0];
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
