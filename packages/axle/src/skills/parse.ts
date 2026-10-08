import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { AxleError } from "../errors/AxleError.js";
import type { Skill } from "./types.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

const FrontmatterSchema = z.looseObject({
  name: z.string().trim().min(1, "must be a non-empty string"),
  description: z.string().trim().min(1, "must be a non-empty string"),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
});

export type SkillFrontmatter = Omit<z.infer<typeof FrontmatterSchema>, "name" | "description">;

/**
 * Parse the text of a `SKILL.md`. Requires the frontmatter block with a
 * non-empty `name` and `description`; the optional fields the specification
 * names are type-checked, anything else is carried through as written. Every
 * scalar is read as text (YAML failsafe schema), so an unquoted
 * `version: 1.0` under `metadata` stays "1.0" rather than failing as a number.
 */
export function parseSkillMarkdown(text: string): Omit<Skill, "root" | "files"> {
  const match = FRONTMATTER.exec(text.trimStart());
  if (!match) {
    throw new AxleError("SKILL.md must start with a YAML frontmatter block delimited by ---", {
      code: "SKILL_INVALID",
    });
  }
  const [, frontmatterText, body = ""] = match;

  let yaml;
  try {
    yaml = parseYaml(frontmatterText, { schema: "failsafe" });
  } catch (error) {
    throw new AxleError("SKILL.md frontmatter is not valid YAML", {
      code: "SKILL_INVALID",
      cause: error,
    });
  }

  const result = FrontmatterSchema.safeParse(yaml);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.map(String).join(".");
    throw new AxleError(
      field
        ? `SKILL.md frontmatter ${field}: ${issue.message}`
        : "SKILL.md frontmatter must be a mapping",
      { code: "SKILL_INVALID", details: { issues: result.error.issues } },
    );
  }

  const { name, description, ...frontmatter } = result.data;
  return {
    name,
    description,
    instructions: body.trim(),
    ...(Object.keys(frontmatter).length > 0 ? { frontmatter } : {}),
  };
}
