import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { displayNameFor, resolveScheduleIdentity } from "../../../src/cli/schedule/identity.js";

const TEST_DIR = join(import.meta.dirname, "__identity_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
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
