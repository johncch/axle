import type { Skill } from "@fifthrevision/axle";
import { loadSkill } from "@fifthrevision/axle";
import { listSkillDirs, resolveSkillRoots } from "./configs/paths.js";

export type SkillOutcome =
  | { kind: "loaded"; skill: Skill }
  | { kind: "shadowed"; by: string }
  | { kind: "ignored" }
  | { kind: "failed"; reason: string };

export interface SkillEntry {
  dir: string;
  scope: "user" | "project";
  outcome: SkillOutcome;
}

export interface DiscoveredSkills {
  /** The loaded skills, sorted by name. */
  skills: Skill[];
  /** Shadowed skills and skills that failed to load, one line each. */
  warnings: string[];
  /** Every skill directory under every root and what became of it. */
  entries: SkillEntry[];
}

/**
 * Find the skills a run may use: every skill under the user roots, plus
 * every skill under the project roots when the folder is trusted. Later
 * scopes and earlier roots win on a name collision, with a warning naming
 * both paths; a skill that fails to parse is skipped with a warning. Project
 * directories in an untrusted folder are listed as ignored, not loaded.
 */
export async function discoverSkills(options: {
  cwd?: string;
  home?: string;
  trusted: boolean;
}): Promise<DiscoveredSkills> {
  const roots = resolveSkillRoots(options);
  const byName = new Map<string, Skill>();
  const entries: SkillEntry[] = [];
  const warnings: string[] = [];

  const scanScope = async (scope: SkillEntry["scope"], scopeRoots: string[]): Promise<void> => {
    const seenInScope = new Map<string, Skill>();
    for (const root of scopeRoots) {
      for (const dir of await listSkillDirs(root)) {
        let skill: Skill;
        try {
          skill = await loadSkill(dir);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          warnings.push(`Skipped skill at ${dir}: ${reason}`);
          entries.push({ dir, scope, outcome: { kind: "failed", reason } });
          continue;
        }
        const earlier = seenInScope.get(skill.name);
        if (earlier?.root) {
          warnings.push(`Skill ${skill.name}: ${earlier.root} shadows ${dir}`);
          entries.push({ dir, scope, outcome: { kind: "shadowed", by: earlier.root } });
          continue;
        }
        seenInScope.set(skill.name, skill);
        const outer = byName.get(skill.name);
        if (outer?.root) {
          warnings.push(`Skill ${skill.name}: ${dir} shadows ${outer.root}`);
          const shadowed = entries.find((entry) => entry.dir === outer.root);
          if (shadowed) shadowed.outcome = { kind: "shadowed", by: dir };
        }
        byName.set(skill.name, skill);
        entries.push({ dir, scope, outcome: { kind: "loaded", skill } });
      }
    }
  };

  await scanScope("user", roots.user);
  if (options.trusted) {
    await scanScope("project", roots.project);
  } else {
    for (const root of roots.project) {
      for (const dir of await listSkillDirs(root)) {
        entries.push({ dir, scope: "project", outcome: { kind: "ignored" } });
      }
    }
  }

  return {
    skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
    entries,
  };
}
