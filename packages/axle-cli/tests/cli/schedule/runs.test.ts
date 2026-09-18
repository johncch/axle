import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendScheduleRun,
  readScheduleRuns,
  scheduleRunsPath,
} from "../../../src/cli/schedule/runs.js";

const TEST_DIR = join(import.meta.dirname, "__runs_tmp__");
const HOME = join(TEST_DIR, "home");

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("schedule runs ledger", () => {
  it("appends private JSONL lines and reads them newest first", async () => {
    await appendScheduleRun(
      "abc123",
      {
        startedAt: "2026-09-12T10:00:00.000Z",
        finishedAt: "2026-09-12T10:00:05.000Z",
        status: "succeeded",
        sessionIds: ["s1"],
      },
      HOME,
    );
    await appendScheduleRun(
      "abc123",
      {
        startedAt: "2026-09-12T11:00:00.000Z",
        finishedAt: "2026-09-12T11:00:02.000Z",
        status: "failed",
        sessionIds: [],
      },
      HOME,
    );

    const path = scheduleRunsPath("abc123", HOME);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readFile(path, "utf-8")).split("\n").filter(Boolean)).toHaveLength(2);
    expect((await readScheduleRuns("abc123", HOME)).map((run) => run.status)).toEqual([
      "failed",
      "succeeded",
    ]);
  });

  it("skips unparseable lines and returns nothing for an unknown schedule", async () => {
    await mkdir(join(HOME, ".axle", "schedules"), { recursive: true });
    await writeFile(
      scheduleRunsPath("abc123", HOME),
      [
        "{not json",
        JSON.stringify({ startedAt: "x", status: "succeeded" }),
        JSON.stringify({
          startedAt: "2026-09-12T10:00:00.000Z",
          finishedAt: "2026-09-12T10:00:05.000Z",
          status: "succeeded",
          sessionIds: ["s1", "s2"],
        }),
      ].join("\n") + "\n",
    );

    expect(await readScheduleRuns("abc123", HOME)).toEqual([
      {
        startedAt: "2026-09-12T10:00:00.000Z",
        finishedAt: "2026-09-12T10:00:05.000Z",
        status: "succeeded",
        sessionIds: ["s1", "s2"],
      },
    ]);
    expect(await readScheduleRuns("nothing", HOME)).toEqual([]);
  });
});
