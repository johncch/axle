import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScheduleRecord } from "../../../src/cli/schedule/records.js";
import {
  deleteScheduleRecord,
  listScheduleRecords,
  readScheduleRecord,
  resolveScheduleId,
  scheduleRecordPath,
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
      intervalSeconds: 3600,
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

  it("resolves full ids and unique prefixes", async () => {
    await writeScheduleRecord(record("abc123"), HOME);
    await writeScheduleRecord(record("abd456"), HOME);

    expect(await resolveScheduleId("abc123", HOME)).toBe("abc123");
    expect(await resolveScheduleId("abd", HOME)).toBe("abd456");
    await expect(resolveScheduleId("ab", HOME)).rejects.toThrow(/ambiguous \(2 matches\)/);
    await expect(resolveScheduleId("zzz", HOME)).rejects.toThrow(/No schedule found with id zzz/);
  });
});
