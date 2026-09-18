import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ScheduleBackend, ScheduleBackends } from "../../../src/cli/schedule/backend.js";
import { unsupportedPlatformError } from "../../../src/cli/schedule/backend.js";
import { reconcileSchedule, removeSchedule } from "../../../src/cli/schedule/reconcile.js";
import type { BackendBinding, DesiredSchedule } from "../../../src/cli/schedule/records.js";
import {
  readScheduleRecord,
  schedulesDir,
  writeScheduleRecord,
} from "../../../src/cli/schedule/records.js";

const TEST_DIR = join(import.meta.dirname, "__reconcile_tmp__");
const HOME = join(TEST_DIR, "home");

type Call =
  | { op: "apply"; desired: DesiredSchedule; previous?: BackendBinding }
  | { op: "remove"; binding: BackendBinding };

class FakeBackend implements ScheduleBackend {
  readonly kind = "launchd" as const;
  calls: Call[] = [];
  failNextApply?: Error;
  failNextRemove?: Error;
  loaded = true;

  async apply(desired: DesiredSchedule, previous?: BackendBinding): Promise<BackendBinding> {
    this.calls.push({ op: "apply", desired, previous });
    if (this.failNextApply) {
      const error = this.failNextApply;
      this.failNextApply = undefined;
      throw error;
    }
    return { kind: "launchd", label: `test.${desired.id}`, plistPath: `/la/${desired.id}.plist` };
  }

  async isLoaded(): Promise<boolean> {
    return this.loaded;
  }

  async remove(binding: BackendBinding): Promise<void> {
    this.calls.push({ op: "remove", binding });
    if (this.failNextRemove) {
      const error = this.failNextRemove;
      this.failNextRemove = undefined;
      throw error;
    }
  }
}

function desired(overrides: Partial<DesiredSchedule> = {}): DesiredSchedule {
  return {
    id: "abc123",
    name: "monitor",
    recipePath: "/recipes/monitor.yml",
    cwd: "/recipes",
    intervalSeconds: 3600,
    programArguments: ["/bin/node", "/axle/cli.js", "-j", "/recipes/monitor.yml"],
    path: "/usr/bin:/bin",
    stdoutPath: `${HOME}/.axle/logs/schedules/abc123.out.log`,
    stderrPath: `${HOME}/.axle/logs/schedules/abc123.err.log`,
    ...overrides,
  };
}

function backendsOf(backend: ScheduleBackend): ScheduleBackends {
  return {
    forPlatform: (platform) => (platform === "darwin" ? backend : undefined),
    forKind: (kind) => (kind === backend.kind ? backend : undefined),
  };
}

const clock = { now: () => new Date("2026-09-12T10:00:00.000Z") };

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("reconcileSchedule", () => {
  it("creates a registration and commits the record after the backend succeeds", async () => {
    const backend = new FakeBackend();

    const outcome = await reconcileSchedule(desired(), backend, { home: HOME, ...clock });

    expect(outcome.kind).toBe("created");
    expect(backend.calls).toEqual([{ op: "apply", desired: desired(), previous: undefined }]);
    expect(await readScheduleRecord("abc123", HOME)).toEqual({
      version: 1,
      desired: desired(),
      binding: { kind: "launchd", label: "test.abc123", plistPath: "/la/abc123.plist" },
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T10:00:00.000Z",
    });
  });

  it("is a no-op when the desired state matches the record", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    backend.calls = [];

    const outcome = await reconcileSchedule(desired(), backend, { home: HOME });

    expect(outcome.kind).toBe("unchanged");
    expect(backend.calls).toEqual([]);
  });

  it("updates through the previous binding when the interval or cwd changes", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    backend.calls = [];
    const later = { now: () => new Date("2026-09-12T11:00:00.000Z") };

    const outcome = await reconcileSchedule(
      desired({ intervalSeconds: 900, cwd: "/elsewhere" }),
      backend,
      { home: HOME, ...later },
    );

    expect(outcome).toMatchObject({
      kind: "updated",
      previous: { desired: { intervalSeconds: 3600, cwd: "/recipes" } },
    });
    expect(backend.calls).toEqual([
      {
        op: "apply",
        desired: desired({ intervalSeconds: 900, cwd: "/elsewhere" }),
        previous: { kind: "launchd", label: "test.abc123", plistPath: "/la/abc123.plist" },
      },
    ]);
    expect(await readScheduleRecord("abc123", HOME)).toMatchObject({
      desired: { intervalSeconds: 900, cwd: "/elsewhere" },
      createdAt: "2026-09-12T10:00:00.000Z",
      updatedAt: "2026-09-12T11:00:00.000Z",
    });
  });

  it("re-applies a matching record whose OS registration has gone missing", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    backend.calls = [];
    backend.loaded = false;

    const outcome = await reconcileSchedule(desired(), backend, { home: HOME });

    expect(outcome.kind).toBe("restored");
    expect(backend.calls.map((call) => call.op)).toEqual(["apply"]);
  });

  it("leaves no record when the first apply fails", async () => {
    const backend = new FakeBackend();
    backend.failNextApply = new Error("launchctl bootstrap failed");

    await expect(reconcileSchedule(desired(), backend, { home: HOME })).rejects.toThrow(
      /bootstrap failed/,
    );

    expect(await readScheduleRecord("abc123", HOME)).toBeUndefined();
    await expect(readdir(schedulesDir(HOME))).rejects.toThrow(/ENOENT/);
  });

  it("keeps the previous record when an update fails", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    const before = await readScheduleRecord("abc123", HOME);
    backend.failNextApply = new Error("launchctl bootstrap failed");

    await expect(
      reconcileSchedule(desired({ intervalSeconds: 900 }), backend, { home: HOME }),
    ).rejects.toThrow(/bootstrap failed/);

    expect(await readScheduleRecord("abc123", HOME)).toEqual(before);
  });

  it("reports an unsupported platform by pointing at a plain run", () => {
    expect(unsupportedPlatformError("linux").message).toMatch(/not supported on linux.*axle -j/);
  });
});

describe("removeSchedule", () => {
  it("boots out the binding then deletes only that record", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    await reconcileSchedule(desired({ id: "other1", recipePath: "/r/o.yml" }), backend, {
      home: HOME,
      ...clock,
    });
    backend.calls = [];

    const removed = await removeSchedule("abc123", backendsOf(backend), { home: HOME });

    expect(removed.desired.id).toBe("abc123");
    expect(backend.calls).toEqual([
      {
        op: "remove",
        binding: { kind: "launchd", label: "test.abc123", plistPath: "/la/abc123.plist" },
      },
    ]);
    expect(await readdir(schedulesDir(HOME))).toEqual(["other1.json"]);
  });

  it("keeps the record when the backend cannot unload", async () => {
    const backend = new FakeBackend();
    await reconcileSchedule(desired(), backend, { home: HOME, ...clock });
    backend.failNextRemove = new Error("bootout: permission denied");

    await expect(removeSchedule("abc123", backendsOf(backend), { home: HOME })).rejects.toThrow(
      /permission denied/,
    );

    expect(await readScheduleRecord("abc123", HOME)).toBeDefined();
  });

  it("rejects unknown ids and refuses records from an unimplemented backend", async () => {
    const backend = new FakeBackend();
    await expect(removeSchedule("zzz", backendsOf(backend), { home: HOME })).rejects.toThrow(
      /No schedule found/,
    );

    await writeScheduleRecord(
      {
        version: 1,
        desired: desired({ id: "sysd01" }),
        binding: { kind: "launchd", label: "x", plistPath: "/x.plist" },
        createdAt: "2026-09-12T10:00:00.000Z",
        updatedAt: "2026-09-12T10:00:00.000Z",
      },
      HOME,
    );
    const noBackends: ScheduleBackends = { forPlatform: () => undefined, forKind: () => undefined };
    await expect(removeSchedule("sysd01", noBackends, { home: HOME })).rejects.toThrow(
      /backend "launchd", which this build/,
    );
    expect(await readScheduleRecord("sysd01", HOME)).toBeDefined();
  });
});
