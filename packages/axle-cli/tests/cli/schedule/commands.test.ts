import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeScheduleState } from "../../../src/cli/schedule/commands.js";
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
