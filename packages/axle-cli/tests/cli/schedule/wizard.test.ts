import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getJobConfig } from "../../../src/cli/configs/loaders.js";
import { writeScheduleBlock } from "../../../src/cli/schedule/wizard.js";

const TEST_DIR = join(import.meta.dirname, "__wizard_tmp__");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("writeScheduleBlock", () => {
  it("adds the block while keeping unrelated keys and comments", async () => {
    const recipe = join(TEST_DIR, "monitor.yml");
    await writeFile(
      recipe,
      [
        "# Hourly stock monitor",
        "name: hourly-monitor",
        "provider: openai # inline comment",
        "",
        "task: |",
        "  Check the API.",
        "  Send an email if the condition is met.",
        "",
      ].join("\n"),
    );

    await writeScheduleBlock(recipe, "1h");

    const written = await readFile(recipe, "utf-8");
    expect(written).toContain("# Hourly stock monitor");
    expect(written).toContain("provider: openai # inline comment");
    expect(written).toContain("schedule:\n  every: 1h");
    expect(written).toContain("  Send an email if the condition is met.");
    expect((await getJobConfig(recipe, {})).schedule).toEqual({ every: "1h" });
  });

  it("replaces an existing interval in place", async () => {
    const recipe = join(TEST_DIR, "monitor.yml");
    await writeFile(recipe, "task: x\nschedule:\n  every: 15m # was hourly\n");

    await writeScheduleBlock(recipe, "2d");

    expect(await readFile(recipe, "utf-8")).toBe("task: x\nschedule:\n  every: 2d # was hourly\n");
  });
});
