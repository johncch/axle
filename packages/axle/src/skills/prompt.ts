import { z } from "zod";
import type { ExecutableTool } from "../tools/types.js";
import type { Skill } from "./types.js";

export const VIEW_SKILL_TOOL_NAME = "view-skill";

/**
 * The system-prompt section that discloses the skills: one line each, name
 * and description only. Descriptions are author text landing in the system
 * prompt, so angle brackets and line breaks are neutralised.
 */
export function renderSkillsCatalog(skills: Skill[]): string {
  return [
    "# Skills",
    "",
    "Skills are packaged instructions for specific tasks. When a task matches a",
    `skill's description, call ${VIEW_SKILL_TOOL_NAME} with its name to load the full`,
    "instructions before proceeding.",
    "",
    ...skills.map((skill) => `- ${skill.name}: ${escapeForPrompt(skill.description)}`),
  ].join("\n");
}

/**
 * The activation tool: returns a skill's instructions wrapped in
 * `<skill_content>`, with the directory and file listing when the skill has
 * them. The `name` argument is an enum of the loaded skills.
 */
export function createViewSkillTool(
  skills: Skill[],
): ExecutableTool<ReturnType<typeof viewSkillSchema>> {
  const names = skills.map((skill) => skill.name);
  return {
    name: VIEW_SKILL_TOOL_NAME,
    description: "Load the full instructions for a skill by name.",
    schema: viewSkillSchema(names),
    summarize: ({ name }) => name,
    execute: async ({ name }) => {
      const skill = skills.find((candidate) => candidate.name === name);
      if (!skill) throw new Error(`Unknown skill: ${name}. Available: ${names.join(", ")}`);
      return renderSkillContent(skill);
    },
  };
}

export function renderSkillContent(skill: Skill): string {
  const compatibility = skill.frontmatter?.compatibility;
  return [
    `<skill_content name="${skill.name}">`,
    skill.instructions,
    ...(compatibility ? ["", `Compatibility: ${escapeForPrompt(compatibility)}`] : []),
    ...(skill.root
      ? [
          "",
          `Skill directory: ${skill.root}`,
          "Relative paths in these instructions are relative to the skill directory.",
        ]
      : []),
    ...(skill.files && skill.files.length > 0
      ? ["", "Files:", ...skill.files.map((file) => `  ${file}`)]
      : []),
    "</skill_content>",
  ].join("\n");
}

function viewSkillSchema(names: string[]) {
  return z.object({ name: z.enum(names).describe("The skill to load") });
}

function escapeForPrompt(text: string): string {
  return text
    .replace(/\s*[\r\n]\s*/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
