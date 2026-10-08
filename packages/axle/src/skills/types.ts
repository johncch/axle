import type { SkillFrontmatter } from "./parse.js";

/**
 * An Agent Skill (agentskills.io): instructions a model loads on demand, plus
 * the files that travel with them. Plain data — core never reads a skill's
 * files. `root` is whatever base the host's own tools accept (a directory, an
 * `s3://` prefix, anything) and is printed to the model verbatim so relative
 * paths in `instructions` resolve; `files` lists what is under it.
 */
export interface Skill {
  name: string;
  description: string;
  /** The `SKILL.md` body with its frontmatter stripped. */
  instructions: string;
  root?: string;
  /** Relative to `root`, forward slashes, listed not read. */
  files?: string[];
  /** The remaining frontmatter fields as written: `license`, `compatibility`, `metadata`, `allowed-tools`. */
  frontmatter?: SkillFrontmatter;
}

export interface SkillDefinitionRef {
  name: string;
}
