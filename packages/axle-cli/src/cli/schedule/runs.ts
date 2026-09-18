import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { schedulesDir } from "./records.js";

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
