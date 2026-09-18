import { isDeepStrictEqual } from "node:util";
import type { ScheduleBackend, ScheduleBackends } from "./backend.js";
import { unknownBackendError } from "./backend.js";
import type { DesiredSchedule, ScheduleRecord } from "./records.js";
import { deleteScheduleRecord, readScheduleRecord, writeScheduleRecord } from "./records.js";

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
