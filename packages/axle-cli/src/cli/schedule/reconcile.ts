import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { BackendBinding, DesiredSchedule, ScheduleRecord } from "./records.js";
import {
  deleteScheduleRecord,
  readScheduleRecord,
  scheduleLogsDir,
  writeScheduleRecord,
} from "./records.js";
import type { ScheduleTrigger } from "./trigger.js";

export type BackendKind = BackendBinding["kind"];

/**
 * The OS-specific half of scheduling. A backend owns its own artifacts (a
 * plist, a unit file) and must leave them as it found them when `apply`
 * throws; the controller never commits a record for a failed apply.
 */
export interface ScheduleBackend {
  readonly kind: BackendKind;
  apply(desired: DesiredSchedule, previous?: BackendBinding): Promise<BackendBinding>;
  remove(binding: BackendBinding): Promise<void>;
  isLoaded(binding: BackendBinding): Promise<boolean>;
  /** The binding this backend would have produced for `id`; lets a schedule whose record is unreadable still be removed. */
  bindingFor(id: string): BackendBinding;
}

export interface ScheduleBackends {
  forPlatform(platform: NodeJS.Platform): ScheduleBackend | undefined;
  forKind(kind: string): ScheduleBackend | undefined;
}

export function unsupportedPlatformError(platform: NodeJS.Platform): Error {
  return new Error(
    `Recurring schedules are not supported on ${platform} yet (macOS only). Run the recipe once with axle -j instead.`,
  );
}

export function unknownBackendError(kind: string): Error {
  return new Error(
    `Schedule record uses backend "${kind}", which this build of axle does not implement.`,
  );
}

export const SCHEDULED_OCCURRENCE_FLAG = "--scheduled";

/**
 * The shell-free command that re-enters this same CLI build: the running
 * node binary, its loader flags (tsx in development), and the entry script.
 * Captured at apply time so the job never depends on launchd's PATH.
 */
export function resolveRelaunchArgv(
  process_: Pick<NodeJS.Process, "execPath" | "execArgv" | "argv"> = process,
): string[] {
  return [process_.execPath, ...process_.execArgv, resolve(process_.argv[1])];
}

export function occurrenceArguments(
  relaunch: readonly string[],
  id: string,
  recipePath: string,
): string[] {
  return [
    ...relaunch,
    "-j",
    recipePath,
    "--renderer",
    "plain",
    "--no-log",
    SCHEDULED_OCCURRENCE_FLAG,
    id,
  ];
}

export function buildDesiredSchedule(input: {
  id: string;
  name: string;
  recipePath: string;
  cwd: string;
  trigger: ScheduleTrigger;
  relaunch: readonly string[];
  path: string;
  home?: string;
}): DesiredSchedule {
  const logs = scheduleLogsDir(input.home);
  return {
    id: input.id,
    name: input.name,
    recipePath: input.recipePath,
    cwd: input.cwd,
    trigger: input.trigger,
    programArguments: occurrenceArguments(input.relaunch, input.id, input.recipePath),
    path: input.path,
    stdoutPath: join(logs, `${input.id}.out.log`),
    stderrPath: join(logs, `${input.id}.err.log`),
  };
}

export type ReconcileOutcome =
  | { kind: "created"; record: ScheduleRecord }
  | { kind: "updated"; record: ScheduleRecord; previous: ScheduleRecord }
  | { kind: "restored"; record: ScheduleRecord }
  | { kind: "unchanged"; record: ScheduleRecord };

/**
 * Bring the OS registration and the stored record in line with `desired`.
 * Ordering is apply-then-commit: the backend mutates first and the record
 * is written only once the backend reports success, so a failed first
 * apply leaves nothing behind and a failed update keeps the previous record
 * authoritative. A matching record whose OS registration has gone missing
 * is re-applied rather than trusted.
 */
export async function reconcileSchedule(
  desired: DesiredSchedule,
  backend: ScheduleBackend,
  options?: { home?: string; now?: () => Date },
): Promise<ReconcileOutcome> {
  const now = options?.now ?? (() => new Date());
  const previous = await readScheduleRecord(desired.id, options?.home);

  const matchesRecord =
    previous !== undefined &&
    previous.binding.kind === backend.kind &&
    isDeepStrictEqual(previous.desired, desired);
  if (previous && matchesRecord && (await backend.isLoaded(previous.binding))) {
    return { kind: "unchanged", record: previous };
  }

  const binding = await backend.apply(desired, previous?.binding);
  const timestamp = now().toISOString();
  const record: ScheduleRecord = {
    version: 1,
    desired,
    binding,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };

  try {
    await writeScheduleRecord(record, options?.home);
  } catch (e) {
    if (previous) await backend.apply(previous.desired, binding).catch(() => {});
    else await backend.remove(binding).catch(() => {});
    throw e;
  }

  if (!previous) return { kind: "created", record };
  return matchesRecord ? { kind: "restored", record } : { kind: "updated", record, previous };
}

export async function removeSchedule(
  id: string,
  backends: ScheduleBackends,
  options?: { home?: string },
): Promise<ScheduleRecord> {
  const record = await readScheduleRecord(id, options?.home);
  if (!record) throw new Error(`No schedule found with id ${id}`);

  const backend = backends.forKind(record.binding.kind);
  if (!backend) throw unknownBackendError(record.binding.kind);

  await backend.remove(record.binding);
  await deleteScheduleRecord(id, options?.home);
  return record;
}
