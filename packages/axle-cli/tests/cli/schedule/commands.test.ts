import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeScheduleState,
  resolveScheduleByName,
  selectorFrom,
} from "../../../src/cli/schedule/commands.js";
import type { ScheduleBackends } from "../../../src/cli/schedule/reconcile.js";
import {
  resolveScheduleIdentity,
  scheduleRunsPath,
  schedulesDir,
} from "../../../src/cli/schedule/records.js";

const TEST_DIR = join(import.meta.dirname, "__commands_tmp__");
const HOME = join(TEST_DIR, "home");
const noBackends: ScheduleBackends = { forPlatform: () => undefined, forKind: () => undefined };

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("describeScheduleState", () => {
  it("degrades to a warning instead of throwing when schedule state is unreadable", async () => {
    const recipe = join(TEST_DIR, "monitor.yml");
    await writeFile(recipe, "task: x\nschedule:\n  every: 1h\n");
    const { id } = await resolveScheduleIdentity(recipe);
    await mkdir(schedulesDir(HOME), { recursive: true });
    await writeFile(
      join(schedulesDir(HOME), `${id}.json`),
      JSON.stringify({
        version: 1,
        desired: {
          id,
          name: "monitor",
          recipePath: recipe,
          cwd: TEST_DIR,
          trigger: { kind: "interval", seconds: 3600 },
          programArguments: ["/bin/node", "/axle/cli.js"],
          path: "/bin",
          stdoutPath: "/dev/null",
          stderrPath: "/dev/null",
        },
        binding: { kind: "launchd", label: "x", plistPath: "/x.plist" },
        createdAt: "2026-09-18T00:00:00.000Z",
        updatedAt: "2026-09-18T00:00:00.000Z",
      }),
    );
    await mkdir(scheduleRunsPath(id, HOME));

    const line = await describeScheduleState(
      recipe,
      { task: "x", schedule: { every: "1h" } },
      { backends: noBackends, platform: "linux", home: HOME },
    );

    expect(line?.level).toBe("warn");
    expect(line?.message).toMatch(/unreadable.*EISDIR/);
  });
});

describe("selectorFrom", () => {
  it("takes a recipe or a name, and refuses both or neither", () => {
    expect(selectorFrom({ job: "a.yml" })).toEqual({ kind: "recipe", recipe: "a.yml" });
    expect(selectorFrom({ name: "advisor" })).toEqual({ kind: "name", name: "advisor" });
    expect(() => selectorFrom({ job: "a.yml", name: "advisor" })).toThrow(/not both/);
    expect(() => selectorFrom({})).toThrow(/-n <name> or -j <recipe>/);
  });
});

describe("resolveScheduleByName", () => {
  async function writeRecord(id: string, name: string, recipePath: string) {
    await mkdir(schedulesDir(HOME), { recursive: true });
    await writeFile(
      join(schedulesDir(HOME), `${id}.json`),
      JSON.stringify({
        version: 1,
        desired: {
          id,
          name,
          recipePath,
          cwd: TEST_DIR,
          trigger: { kind: "interval", seconds: 3600 },
          programArguments: ["/bin/node", "/axle/cli.js"],
          path: "/bin",
          stdoutPath: "/dev/null",
          stderrPath: "/dev/null",
        },
        binding: { kind: "launchd", label: id, plistPath: `/${id}.plist` },
        createdAt: "2026-10-08T00:00:00.000Z",
        updatedAt: "2026-10-08T00:00:00.000Z",
      }),
    );
  }

  it("finds the one record with that name", async () => {
    await writeRecord("1111111111111111", "advisor", "/a/advisor.yml");
    await writeRecord("2222222222222222", "digest", "/b/digest.yml");

    const target = await resolveScheduleByName("advisor", HOME);

    expect(target.kind).toBe("record");
    if (target.kind === "record") expect(target.record.desired.recipePath).toBe("/a/advisor.yml");
  });

  it("names both recipes when two schedules share the name", async () => {
    await writeRecord("1111111111111111", "advisor", "/a/advisor.yml");
    await writeRecord("2222222222222222", "advisor", "/b/advisor.yml");

    await expect(resolveScheduleByName("advisor", HOME)).rejects.toThrow(
      "2 schedules are named advisor; pick one with -j:\n  /a/advisor.yml\n  /b/advisor.yml",
    );
  });

  it("points at the list when nothing matches", async () => {
    await expect(resolveScheduleByName("advisor", HOME)).rejects.toThrow(
      "No schedule named advisor. See: axle schedule list",
    );
  });
});
