import type { Skill } from "@fifthrevision/axle";
import { loadSkill } from "@fifthrevision/axle";
import { listSkillDirs, resolveSkillRoots } from "./configs/paths.js";

export interface DiscoveredSkills {
  /** Sorted by name; a project skill replaces a user skill of the same name. */
  skills: Skill[];
  /** Shadowed skills and skills that failed to load, one line each. */
  warnings: string[];
}

/**
 * Find the skills a run may use: every skill under the user roots, plus
 * every skill under the project roots when the folder is trusted. Later
 * scopes and earlier roots win on a name collision, with a warning naming
 * both paths; a skill that fails to parse is skipped with a warning.
 */
export async function discoverSkills(options: {
  cwd?: string;
  home?: string;
  trusted: boolean;
}): Promise<DiscoveredSkills> {
  const roots = resolveSkillRoots(options);
  const byName = new Map<string, Skill>();
  const warnings: string[] = [];

  const scanScope = async (scopeRoots: string[]): Promise<void> => {
    const seenInScope = new Map<string, Skill>();
    for (const root of scopeRoots) {
      for (const dir of await listSkillDirs(root)) {
        let skill: Skill;
        try {
          skill = await loadSkill(dir);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          warnings.push(`Skipped skill at ${dir}: ${reason}`);
          continue;
        }
        const earlier = seenInScope.get(skill.name);
        if (earlier) {
          warnings.push(`Skill ${skill.name}: ${earlier.root} shadows ${dir}`);
          continue;
        }
        seenInScope.set(skill.name, skill);
        const outer = byName.get(skill.name);
        if (outer) warnings.push(`Skill ${skill.name}: ${dir} shadows ${outer.root}`);
        byName.set(skill.name, skill);
      }
    }
  };

  await scanScope(roots.user);
  if (options.trusted) await scanScope(roots.project);

  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}
