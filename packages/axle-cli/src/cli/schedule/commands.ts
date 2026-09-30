import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { JobConfig } from "../configs/schemas.js";
import type { ReconcileOutcome, ScheduleBackends } from "./reconcile.js";
import {
  buildDesiredSchedule,
  reconcileSchedule,
  removeSchedule,
  resolveRelaunchArgv,
  unknownBackendError,
  unsupportedPlatformError,
} from "./reconcile.js";
import type { DesiredSchedule, ScheduleRecord, ScheduleRun } from "./records.js";
import {
  deleteScheduleRecord,
  displayNameFor,
  listScheduleRecords,
  readScheduleRecord,
  readScheduleRuns,
  resolveScheduleIdentity,
  scheduleIdFor,
} from "./records.js";
import { describeNextFiring, formatTrigger, parseScheduleTrigger } from "./trigger.js";

export interface ScheduleContext {
  backends: ScheduleBackends;
  platform: NodeJS.Platform;
  home?: string;
}

export type ScheduledJobConfig = JobConfig & { schedule: NonNullable<JobConfig["schedule"]> };

export async function applyRecipeSchedule(
  recipe: string,
  jobConfig: ScheduledJobConfig,
  context: ScheduleContext,
): Promise<ReconcileOutcome> {
  const backend = context.backends.forPlatform(context.platform);
  if (!backend) throw unsupportedPlatformError(context.platform);

  const identity = await resolveScheduleIdentity(recipe);
  const desired = buildDesiredSchedule({
    id: identity.id,
    name: displayNameFor(jobConfig.name, identity.recipePath),
    recipePath: identity.recipePath,
    cwd: process.cwd(),
    trigger: parseScheduleTrigger(jobConfig.schedule),
    relaunch: resolveRelaunchArgv(),
    path: process.env.PATH ?? "",
    home: context.home,
  });
  return reconcileSchedule(desired, backend, { home: context.home });
}

export function describeOutcome(outcome: ReconcileOutcome): string {
  const { desired } = outcome.record;
  const when = formatTrigger(desired.trigger);
  const next = `Next firing ${describeNextFiring(desired.trigger, new Date())}.`;
  switch (outcome.kind) {
    case "created":
      return `Scheduled ${desired.name} ${when}. ${next}`;
    case "updated":
      return `Updated schedule ${desired.name}: ${describeChanges(outcome.previous.desired, desired).join(", ")}. ${next}`;
    case "restored":
      return `Restored schedule ${desired.name} ${when}: its registration was missing. ${next}`;
    case "unchanged":
      return `Schedule ${desired.name} is current: ${when}`;
  }
}

function describeChanges(before: DesiredSchedule, after: DesiredSchedule): string[] {
  const changes: string[] = [];
  if (!isDeepStrictEqual(before.trigger, after.trigger)) {
    changes.push(`${formatTrigger(before.trigger)} → ${formatTrigger(after.trigger)}`);
  }
  if (before.name !== after.name) changes.push(`name ${before.name} → ${after.name}`);
  if (before.cwd !== after.cwd) changes.push(`cwd ${before.cwd} → ${after.cwd}`);
  if (before.path !== after.path) changes.push("PATH changed");
  if (!isDeepStrictEqual(before.programArguments, after.programArguments)) {
    changes.push("relaunch command changed");
  }
  return changes.length > 0 ? changes : ["registration refreshed"];
}

export type ScheduleStateLine = { level: "info" | "warn"; message: string };

/**
 * What a plain `axle -j` says about the recipe's schedule. Read-only and
 * never throws: it compares the recipe's declaration with the stored
 * record, never consults or changes the OS registration, and degrades to
 * a warning when its own state files cannot be read.
 */
export async function describeScheduleState(
  recipe: string,
  jobConfig: JobConfig,
  context: ScheduleContext,
): Promise<ScheduleStateLine | undefined> {
  try {
    return await scheduleState(recipe, jobConfig, context);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { level: "warn", message: `Schedule state for ${recipe} is unreadable: ${reason}` };
  }
}

async function scheduleState(
  recipe: string,
  jobConfig: JobConfig,
  context: ScheduleContext,
): Promise<ScheduleStateLine | undefined> {
  const { id } = await resolveScheduleIdentity(recipe);
  let record: ScheduleRecord | undefined;
  try {
    record = await readScheduleRecord(id, context.home);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { level: "warn", message: `The schedule record for ${recipe} is unreadable: ${reason}` };
  }

  const declared = jobConfig.schedule ? parseScheduleTrigger(jobConfig.schedule) : undefined;
  if (declared === undefined && !record) return undefined;

  if (declared !== undefined && !record) {
    const when = formatTrigger(declared);
    return context.backends.forPlatform(context.platform)
      ? {
          level: "info",
          message: `Declares a schedule (${when}), not registered. Register and run with: axle schedule -j ${recipe}`,
        }
      : {
          level: "info",
          message: `Declares a schedule (${when}); schedules are not supported on ${context.platform} yet.`,
        };
  }

  const registered = formatTrigger(record!.desired.trigger);
  if (declared === undefined) {
    return {
      level: "warn",
      message: `Registered ${registered}, but the recipe no longer declares a schedule. Remove with: axle schedule remove -j ${recipe}`,
    };
  }
  if (!isDeepStrictEqual(declared, record!.desired.trigger)) {
    return {
      level: "warn",
      message: `Registered ${registered}, but the recipe now says ${formatTrigger(declared)}. Re-apply with: axle schedule register -j ${recipe}`,
    };
  }
  const last = (await readScheduleRuns(id, context.home))[0];
  return {
    level: "info",
    message: `Scheduled ${registered}, ${describeLastRun(last)}`,
  };
}

export async function formatScheduleList(context: ScheduleContext): Promise<string[]> {
  const entries = await listScheduleRecords(context.home);
  if (entries.length === 0) return ["No schedules registered."];

  const lines: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "unreadable") {
      lines.push(`⚠ ${entry.id}.json  skipped: ${entry.reason}`);
      continue;
    }
    const { desired, binding } = entry.record;
    const last = (await readScheduleRuns(desired.id, context.home))[0];
    lines.push(
      `${desired.name}  ${formatTrigger(desired.trigger)}  ${binding.kind}  ${describeLastRun(last)}`,
    );
    lines.push(`  ${desired.recipePath}`);
    if (desired.cwd !== process.cwd()) lines.push(`  cwd ${desired.cwd}`);
    const backend = context.backends.forKind(binding.kind);
    if (backend && !(await backend.isLoaded(binding))) {
      lines.push(
        `  ⚠ not loaded in ${binding.kind}. Re-apply with: axle schedule register -j ${desired.recipePath}`,
      );
    }
  }
  return lines;
}

export type ScheduleTarget =
  { kind: "record"; record: ScheduleRecord } | { kind: "unreadable"; id: string; reason: string };

/**
 * A schedule is addressed by its recipe. A recipe that no longer exists is
 * matched against the path recorded at registration, and a record that
 * cannot be parsed still resolves to its id so it can be removed.
 */
export async function resolveScheduleByRecipe(
  recipe: string,
  home?: string,
): Promise<ScheduleTarget> {
  let id: string;
  let recipePath: string;
  try {
    ({ id, recipePath } = await resolveScheduleIdentity(recipe));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    recipePath = resolve(recipe);
    id = scheduleIdFor(recipePath);
  }

  try {
    const record = await readScheduleRecord(id, home);
    if (record) return { kind: "record", record };
  } catch (e) {
    return { kind: "unreadable", id, reason: e instanceof Error ? e.message : String(e) };
  }
  for (const entry of await listScheduleRecords(home)) {
    if (entry.kind === "record" && entry.record.desired.recipePath === recipePath) {
      return entry;
    }
  }
  throw new Error(`${recipe} is not scheduled. See: axle schedule list`);
}

export async function formatScheduleSessions(recipe: string, home?: string): Promise<string[]> {
  let id: string;
  try {
    id = (await resolveScheduleIdentity(recipe)).id;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    id = scheduleIdFor(resolve(recipe));
  }
  const runs = await readScheduleRuns(id, home);
  if (runs.length === 0) return [`No runs recorded for ${recipe}.`];

  return runs.map((run) => {
    const glyph = run.status === "succeeded" ? "✔" : "✖";
    const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
    const duration = Number.isFinite(seconds) ? `${seconds.toFixed(1)}s` : "?";
    const resume =
      run.sessionIds.length === 0
        ? "no session saved"
        : run.sessionIds.map((id) => `axle resume ${id.slice(0, 8)}`).join(", ");
    return `${glyph} ${formatTimestamp(run.finishedAt)}  ${duration}  ${resume}`;
  });
}

export async function removeScheduleByRecipe(
  recipe: string,
  context: ScheduleContext,
): Promise<string> {
  const target = await resolveScheduleByRecipe(recipe, context.home);
  if (target.kind === "unreadable") {
    const backend = context.backends.forPlatform(context.platform);
    if (!backend) throw unsupportedPlatformError(context.platform);
    await backend.remove(backend.bindingFor(target.id));
    await deleteScheduleRecord(target.id, context.home);
    return `Removed schedule for ${recipe} (its record was unreadable: ${target.reason})`;
  }
  if (!context.backends.forKind(target.record.binding.kind)) {
    throw unknownBackendError(target.record.binding.kind);
  }
  const record = await removeSchedule(target.record.desired.id, context.backends, {
    home: context.home,
  });
  return `Removed schedule ${record.desired.name}`;
}

function describeLastRun(last: ScheduleRun | undefined): string {
  if (!last) return "never run";
  return `last run ${last.status === "succeeded" ? "✔" : "✖"} ${formatTimestamp(last.finishedAt)}`;
}

function formatTimestamp(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
