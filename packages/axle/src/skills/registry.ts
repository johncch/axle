import { AxleError } from "../errors/AxleError.js";
import type { ToolRegistry } from "../tools/registry.js";
import { SKILL_NAME_FORBIDDEN_CHARACTERS, SKILL_NAME_FORBIDDEN_MESSAGE } from "./parse.js";
import { createViewSkillTool, VIEW_SKILL_TOOL_NAME } from "./prompt.js";
import type { Skill } from "./types.js";

/**
 * The skills an Agent discloses, changeable at any time. Owns the `view-skill`
 * tool: it is published into the Agent's tool registry while at least one
 * skill is present and withdrawn when the last one goes, rebuilt from the
 * current list on every change.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  private published = false;

  constructor(
    private readonly tools: ToolRegistry,
    skills?: Skill[],
  ) {
    if (skills && skills.length > 0) this.add(skills);
  }

  add(skill: Skill): void;
  add(skills: Skill[]): void;
  add(skillOrSkills: Skill | Skill[]): void {
    const skills = Array.isArray(skillOrSkills) ? skillOrSkills : [skillOrSkills];
    for (const skill of skills) {
      if (SKILL_NAME_FORBIDDEN_CHARACTERS.test(skill.name)) {
        throw new AxleError(
          `Skill name ${SKILL_NAME_FORBIDDEN_MESSAGE}: ${JSON.stringify(skill.name)}`,
          { code: "SKILL_INVALID", details: { name: skill.name } },
        );
      }
      if (this.skills.has(skill.name)) {
        throw new AxleError(`Skill already registered: ${skill.name}`, {
          code: "SKILL_REGISTRY_DUPLICATE",
          details: { name: skill.name },
        });
      }
    }
    for (const skill of skills) this.skills.set(skill.name, skill);
    this.publish();
  }

  remove(name: string): boolean {
    const removed = this.skills.delete(name);
    if (removed) this.publish();
    return removed;
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  get size(): number {
    return this.skills.size;
  }

  private publish(): void {
    if (this.published) {
      this.tools.remove(VIEW_SKILL_TOOL_NAME);
      this.published = false;
    }
    if (this.skills.size === 0) return;
    this.tools.add(createViewSkillTool(this.list()));
    this.published = true;
  }
}
