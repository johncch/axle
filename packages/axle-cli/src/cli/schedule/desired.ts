import { join, resolve } from "node:path";
import type { DesiredSchedule } from "./records.js";
import { scheduleLogsDir } from "./records.js";

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
  intervalSeconds: number;
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
    intervalSeconds: input.intervalSeconds,
    programArguments: occurrenceArguments(input.relaunch, input.id, input.recipePath),
    path: input.path,
    stdoutPath: join(logs, `${input.id}.out.log`),
    stderrPath: join(logs, `${input.id}.err.log`),
  };
}
