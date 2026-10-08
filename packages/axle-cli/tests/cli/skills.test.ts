import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listProjectInputs } from "../../src/cli/configs/paths.js";
import { discoverSkills, missingSkillNames } from "../../src/cli/skills.js";

const TEST_DIR = join(import.meta.dirname, "__skills_tmp__");
const HOME = join(TEST_DIR, "home");
const CWD = join(TEST_DIR, "project");

async function writeSkill(dir: string, name: string, description = `About ${name}.`) {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\nUse ${name}.\n`,
  );
}

describe("discoverSkills", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(HOME, { recursive: true });
    await mkdir(CWD, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("finds nothing when no skills directory exists", async () => {
    expect(await discoverSkills({ cwd: CWD, home: HOME, trusted: true })).toEqual({
      skills: [],
      warnings: [],
    });
  });

  it("loads user skills from .axle and .agents, sorted by name", async () => {
    await writeSkill(join(HOME, ".axle", "skills", "sheets"), "sheets");
    await writeSkill(join(HOME, ".agents", "skills", "pdf"), "pdf");

    const { skills, warnings } = await discoverSkills({ cwd: CWD, home: HOME, trusted: false });

    expect(skills.map((skill) => skill.name)).toEqual(["pdf", "sheets"]);
    expect(skills[0].root).toBe(join(HOME, ".agents", "skills", "pdf"));
    expect(skills[0].instructions).toBe("Use pdf.");
    expect(warnings).toEqual([]);
  });

  it("loads project skills only when the folder is trusted", async () => {
    await writeSkill(join(CWD, ".axle", "skills", "deploy"), "deploy");

    const untrusted = await discoverSkills({ cwd: CWD, home: HOME, trusted: false });
    const trusted = await discoverSkills({ cwd: CWD, home: HOME, trusted: true });

    expect(untrusted.skills).toEqual([]);
    expect(trusted.skills.map((skill) => skill.name)).toEqual(["deploy"]);
  });

  it("lets a project skill shadow a user skill of the same name, with a warning", async () => {
    await writeSkill(join(HOME, ".axle", "skills", "pdf"), "pdf", "User version.");
    await writeSkill(join(CWD, ".axle", "skills", "pdf"), "pdf", "Project version.");

    const { skills, warnings } = await discoverSkills({ cwd: CWD, home: HOME, trusted: true });

    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Project version.");
    expect(warnings).toEqual([
      `Skill pdf: ${join(CWD, ".axle", "skills", "pdf")} shadows ${join(HOME, ".axle", "skills", "pdf")}`,
    ]);
  });

  it("prefers .axle over .agents within a scope, with a warning", async () => {
    await writeSkill(join(HOME, ".axle", "skills", "pdf"), "pdf", "Ours.");
    await writeSkill(join(HOME, ".agents", "skills", "pdf"), "pdf", "Theirs.");

    const { skills, warnings } = await discoverSkills({ cwd: CWD, home: HOME, trusted: true });

    expect(skills[0].description).toBe("Ours.");
    expect(warnings).toEqual([
      `Skill pdf: ${join(HOME, ".axle", "skills", "pdf")} shadows ${join(HOME, ".agents", "skills", "pdf")}`,
    ]);
  });

  it("skips a skill that fails to parse and keeps the rest", async () => {
    await writeSkill(join(HOME, ".axle", "skills", "good"), "good");
    const bad = join(HOME, ".axle", "skills", "bad");
    await mkdir(bad, { recursive: true });
    await writeFile(join(bad, "SKILL.md"), "# no frontmatter\n");

    const { skills, warnings } = await discoverSkills({ cwd: CWD, home: HOME, trusted: true });

    expect(skills.map((skill) => skill.name)).toEqual(["good"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`Skipped skill at ${bad}`);
    expect(warnings[0]).toContain("frontmatter");
  });

  it("ignores directories without a SKILL.md and dotted directories", async () => {
    await mkdir(join(HOME, ".axle", "skills", "notes"), { recursive: true });
    await writeFile(join(HOME, ".axle", "skills", "notes", "README.md"), "x");
    await writeSkill(join(HOME, ".axle", "skills", ".hidden"), "hidden");

    const { skills } = await discoverSkills({ cwd: CWD, home: HOME, trusted: true });

    expect(skills).toEqual([]);
  });

  it("counts a project skills directory as a project input", async () => {
    expect(await listProjectInputs(CWD)).toEqual([]);

    await writeSkill(join(CWD, ".agents", "skills", "deploy"), "deploy");
    await mkdir(join(CWD, ".axle", "skills", "empty"), { recursive: true });

    expect(await listProjectInputs(CWD)).toEqual([".agents/skills"]);
  });
});

describe("missingSkillNames", () => {
  it("names the requested skills discovery did not find", () => {
    const pdf = { name: "pdf", description: "d", instructions: "i" };

    expect(missingSkillNames(["pdf", "sheets"], [pdf])).toEqual(["sheets"]);
    expect(missingSkillNames([], [pdf])).toEqual([]);
  });
});
