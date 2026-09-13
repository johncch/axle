import type { BackendBinding, DesiredSchedule } from "./records.js";

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
}

export interface ScheduleBackends {
  forPlatform(platform: NodeJS.Platform): ScheduleBackend | undefined;
  forKind(kind: string): ScheduleBackend | undefined;
}

export function unsupportedPlatformError(platform: NodeJS.Platform): Error {
  return new Error(
    `Recurring schedules are not supported on ${platform} yet (macOS only). Run the recipe once with --once instead.`,
  );
}

export function unknownBackendError(kind: string): Error {
  return new Error(
    `Schedule record uses backend "${kind}", which this build of axle does not implement.`,
  );
}
