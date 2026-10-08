import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { AxleError } from "../errors/AxleError.js";
import { parseSkillMarkdown } from "./parse.js";
import type { Skill } from "./types.js";

const SKILL_FILE = "SKILL.md";
const MAX_DEPTH = 6;
const MAX_FILES = 500;

/**
 * Load a skill from a directory holding `SKILL.md`. `root` is the directory
 * as given; `files` lists the other files under it, dotfiles excluded,
 * bounded in depth and count so a stray large tree cannot blow up the
 * listing.
 */
export async function loadSkill(dir: string): Promise<Skill> {
  const root = resolve(dir);
  let text: string;
  try {
    text = await readFile(join(root, SKILL_FILE), "utf-8");
  } catch (error) {
    throw new AxleError(`No ${SKILL_FILE} in ${root}`, { code: "SKILL_NOT_FOUND", cause: error });
  }
  const files = await listFiles(root);
  return { ...parseSkillMarkdown(text), root, ...(files.length > 0 ? { files } : {}) };
}

async function listFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path, depth + 1);
      } else if (entry.isFile() && !(dir === root && entry.name === SKILL_FILE)) {
        if (files.length >= MAX_FILES) return;
        files.push(relative(root, path).split("\\").join("/"));
      }
    }
  };
  await walk(root, 0);
  return files;
}
