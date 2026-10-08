import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AxleError } from "../../src/errors/AxleError.js";
import { loadSkill } from "../../src/skills/load.js";

const TEST_DIR = join(import.meta.dirname, "__skills_tmp__");
const SKILL_DIR = join(TEST_DIR, "pdf");

async function write(path: string, content = ""): Promise<void> {
  await mkdir(join(SKILL_DIR, path, ".."), { recursive: true });
  await writeFile(join(SKILL_DIR, path), content);
}

describe("loadSkill", () => {
  beforeEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
    await mkdir(SKILL_DIR, { recursive: true });
    await write(
      "SKILL.md",
      "---\nname: pdf\ndescription: Work with PDFs.\n---\nRun scripts/merge.py.\n",
    );
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("parses SKILL.md and sets root to the resolved directory", async () => {
    const skill = await loadSkill(SKILL_DIR);

    expect(skill.name).toBe("pdf");
    expect(skill.instructions).toBe("Run scripts/merge.py.");
    expect(skill.root).toBe(SKILL_DIR);
    expect("files" in skill).toBe(false);
  });

  it("lists the bundled files relative to root, sorted, without SKILL.md or dotfiles", async () => {
    await write("scripts/merge.py", "print()");
    await write("scripts/extract.py", "print()");
    await write("references/forms.md", "# forms");
    await write(".DS_Store");
    await write(".git/config");

    const skill = await loadSkill(SKILL_DIR);

    expect(skill.files).toEqual(["references/forms.md", "scripts/extract.py", "scripts/merge.py"]);
  });

  it("names the directory when SKILL.md is missing", async () => {
    const empty = join(TEST_DIR, "empty");
    await mkdir(empty);

    await expect(loadSkill(empty)).rejects.toThrow(AxleError);
    await expect(loadSkill(empty)).rejects.toThrow(empty);
  });

  it("surfaces a parse error from the file", async () => {
    await write("SKILL.md", "# no frontmatter\n");

    await expect(loadSkill(SKILL_DIR)).rejects.toThrow(/frontmatter/);
  });

  it("stops listing past the depth bound", async () => {
    await write("a/b/c/d/e/f/g/deep.txt");
    await write("a/shallow.txt");

    const skill = await loadSkill(SKILL_DIR);

    expect(skill.files).toEqual(["a/shallow.txt"]);
  });
});
