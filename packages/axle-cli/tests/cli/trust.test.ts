import { mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isFolderTrusted,
  trustFilePath,
  trustFolder,
  trustWouldChange,
  untrustFolder,
} from "../../src/cli/trust.js";

const TEST_DIR = join(import.meta.dirname, "__trust_tmp__");
const HOME = join(TEST_DIR, "home");
const PROJECT = join(TEST_DIR, "project");

describe("folder trust", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(HOME, { recursive: true });
    await mkdir(PROJECT, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("treats a missing trust file as nothing trusted", async () => {
    expect(await isFolderTrusted(PROJECT, HOME)).toBe(false);
  });

  it("records the canonical path with a timestamp", async () => {
    const outcome = await trustFolder(PROJECT, HOME);

    expect(outcome).toEqual({ path: await realpath(PROJECT), changed: true });
    expect(await isFolderTrusted(PROJECT, HOME)).toBe(true);
    const file = JSON.parse(await readFile(trustFilePath(HOME), "utf-8"));
    expect(file.version).toBe(1);
    expect(Object.keys(file.folders)).toEqual([await realpath(PROJECT)]);
    expect(Date.parse(file.folders[await realpath(PROJECT)].trustedAt)).not.toBeNaN();
  });

  it("trusting again changes nothing", async () => {
    await trustFolder(PROJECT, HOME);
    const before = await readFile(trustFilePath(HOME), "utf-8");

    const outcome = await trustFolder(PROJECT, HOME);

    expect(outcome.changed).toBe(false);
    expect(await readFile(trustFilePath(HOME), "utf-8")).toBe(before);
  });

  it("matches through a symlink to the same folder", async () => {
    const link = join(TEST_DIR, "link");
    await symlink(PROJECT, link);
    await trustFolder(link, HOME);

    expect(await isFolderTrusted(PROJECT, HOME)).toBe(true);
  });

  it("does not trust a child of a trusted folder", async () => {
    const child = join(PROJECT, "child");
    await mkdir(child);
    await trustFolder(PROJECT, HOME);

    expect(await isFolderTrusted(child, HOME)).toBe(false);
  });

  it("untrusts a folder and reports when there was nothing to remove", async () => {
    await trustFolder(PROJECT, HOME);

    expect((await untrustFolder(PROJECT, HOME)).changed).toBe(true);
    expect(await isFolderTrusted(PROJECT, HOME)).toBe(false);
    expect((await untrustFolder(PROJECT, HOME)).changed).toBe(false);
  });

  it("names the file when it is not readable as a trust record", async () => {
    await mkdir(join(HOME, ".axle"), { recursive: true });
    await writeFile(trustFilePath(HOME), '{"version":1,"folders":"nope"}');

    await expect(isFolderTrusted(PROJECT, HOME)).rejects.toThrow(trustFilePath(HOME));
  });
});

describe("trustWouldChange", () => {
  it("is false when nothing would be skipped or dropped", () => {
    expect(trustWouldChange([], ["read-file", "axle-help"])).toBe(false);
    expect(trustWouldChange([], [])).toBe(false);
  });

  it("is true when the project has an input file", () => {
    expect(trustWouldChange([".axle/cli.yaml"], ["read-file"])).toBe(true);
  });

  it("is true when a requested tool needs trust", () => {
    expect(trustWouldChange([], ["read-file", "exec"])).toBe(true);
  });
});
