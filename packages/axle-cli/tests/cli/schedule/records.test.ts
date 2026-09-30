import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScheduleRecord } from "../../../src/cli/schedule/records.js";
import {
  appendScheduleRun,
  deleteScheduleRecord,
  displayNameFor,
  listScheduleRecords,
  readScheduleRecord,
  readScheduleRuns,
  resolveScheduleIdentity,
  scheduleRecordPath,
  scheduleRunsPath,
  schedulesDir,
  writeScheduleRecord,
} from "../../../src/cli/schedule/records.js";

const TEST_DIR = join(import.meta.dirname, "__records_tmp__");
const HOME = join(TEST_DIR, "home");

function record(id: string, overrides: Partial<ScheduleRecord["desired"]> = {}): ScheduleRecord {
  return {
    version: 1,
    desired: {
      id,
      name: "monitor",
      recipePath: `/recipes/${id}.yml`,
      cwd: "/recipes",
      trigger: { kind: "interval", seconds: 3600 },
      programArguments: ["/usr/local/bin/node", "/opt/axle/cli.js", "-j", `/recipes/${id}.yml`],
      path: "/usr/bin:/bin",
      stdoutPath: `/home/.axle/logs/schedules/${id}.out.log`,
      stderrPath: `/home/.axle/logs/schedules/${id}.err.log`,
      ...overrides,
    },
    binding: {
      kind: "launchd",
      label: `dev.fifthrevision.axle.${id}`,
      plistPath: `/la/${id}.plist`,
    },
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  };
}

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("schedule records", () => {
  it("writes a private record and reads it back", async () => {
    const path = await writeScheduleRecord(record("abc123"), HOME);

    expect(path).toBe(scheduleRecordPath("abc123", HOME));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(schedulesDir(HOME))).mode & 0o077).toBe(0);
    expect(await readdir(schedulesDir(HOME))).toEqual(["abc123.json"]);
    expect(await readScheduleRecord("abc123", HOME)).toEqual(record("abc123"));
    expect(JSON.parse(await readFile(path, "utf-8"))).not.toHaveProperty("task");
  });

  it("returns undefined for a missing record", async () => {
    expect(await readScheduleRecord("nope", HOME)).toBeUndefined();
  });

  it("deletes a record and tolerates a missing one", async () => {
    await writeScheduleRecord(record("abc123"), HOME);
    await deleteScheduleRecord("abc123", HOME);
    await deleteScheduleRecord("abc123", HOME);
    expect(await readScheduleRecord("abc123", HOME)).toBeUndefined();
  });

  it("lists records sorted by id with unreadable ones flagged", async () => {
    await writeScheduleRecord(record("bbb"), HOME);
    await writeScheduleRecord(record("aaa"), HOME);
    await writeFile(join(schedulesDir(HOME), "corrupt.json"), "{not json");
    await writeFile(
      join(schedulesDir(HOME), "future.json"),
      JSON.stringify({ ...record("future"), version: 99 }),
    );
    await writeFile(
      join(schedulesDir(HOME), "systemd.json"),
      JSON.stringify({
        ...record("systemd"),
        binding: { kind: "systemd", unit: "axle-systemd.timer" },
      }),
    );
    await writeFile(join(schedulesDir(HOME), "notes.txt"), "ignored");

    const listed = await listScheduleRecords(HOME);

    expect(listed.map((entry) => [entry.kind, entry.id])).toEqual([
      ["record", "aaa"],
      ["record", "bbb"],
      ["unreadable", "corrupt"],
      ["unreadable", "future"],
      ["unreadable", "systemd"],
    ]);
    const reasons = listed.flatMap((entry) => (entry.kind === "unreadable" ? [entry.reason] : []));
    expect(reasons).toEqual([
      "corrupt record (not valid JSON)",
      "unsupported record version 99",
      'unknown backend "systemd"',
    ]);
  });

  it("returns an empty list when no schedules were ever written", async () => {
    expect(await listScheduleRecords(HOME)).toEqual([]);
  });
});

describe("resolveScheduleIdentity", () => {
  it("derives a stable id from the canonical recipe path", async () => {
    const recipe = join(TEST_DIR, "monitor.yml");
    await writeFile(recipe, "task: x\n");

    const first = await resolveScheduleIdentity(recipe);
    const second = await resolveScheduleIdentity(join(TEST_DIR, ".", "monitor.yml"));

    expect(first.id).toMatch(/^[0-9a-f]{16}$/);
    expect(second).toEqual(first);
  });

  it("resolves symlinks to one identity", async () => {
    const recipe = join(TEST_DIR, "monitor.yml");
    const link = join(TEST_DIR, "alias.yml");
    await writeFile(recipe, "task: x\n");
    await symlink(recipe, link);

    expect(await resolveScheduleIdentity(link)).toEqual(await resolveScheduleIdentity(recipe));
  });

  it("gives a moved recipe a new identity", async () => {
    const a = join(TEST_DIR, "a.yml");
    const b = join(TEST_DIR, "b.yml");
    await writeFile(a, "task: x\n");
    await writeFile(b, "task: x\n");

    expect((await resolveScheduleIdentity(a)).id).not.toBe((await resolveScheduleIdentity(b)).id);
  });

  it("requires the recipe to exist", async () => {
    await expect(resolveScheduleIdentity(join(TEST_DIR, "missing.yml"))).rejects.toThrow(/ENOENT/);
  });
});

describe("displayNameFor", () => {
  it("prefers the recipe name and falls back to the file stem", () => {
    expect(displayNameFor("hourly-monitor", "/x/monitor.yml")).toBe("hourly-monitor");
    expect(displayNameFor(undefined, "/x/monitor.yml")).toBe("monitor");
  });
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
