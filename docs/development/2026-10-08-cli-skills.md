# Skills in the CLI (AXL-48)

Working note for the CLI half of skills, on top of core's skills module
(2026-10-08-core-skills.md) and folder trust (2026-10-08-folder-trust.md).

## Starting point

Core could load a skill, disclose it in the system prompt, and serve it
through `view-skill`, but nothing in the CLI knew where skills lived or
when to load them. Folder trust had reserved a third consumption site for
"skills, when they land" in invariant 12.

## What was decided, and what was undone

**Where.** Two scopes mirroring config, user and project, each with our own
`.axle/skills/` and the cross-client `.agents/skills/` beside it. The
integration guide names `.agents/skills/` as the widely adopted location,
and the smoke test confirmed why it matters: the development machine
already had three skills under `~/.agents/skills/` from other tools, and
they showed up in `axle info` with no setup.

**Trust.** Project skill directories are project inputs. Untrusted, they
are listed as ignored, trigger the startup prompt, and print the same
`Ignored` notice as the project `cli.yaml`. User skills load regardless;
their scripts cannot run because `exec` is dropped, which needed no new
rule.

**Collisions.** Project over user, `.axle` over `.agents` within a scope,
each with a warning naming both paths. A `SKILL.md` that fails to parse is
a warning naming the file, never a failed run.

**The recipe key, shipped then removed.** Batch two added `skills:` in the
shape of `tools:` — absent for all, `[]` for none, a list to select by
name, an error for a name discovery did not find. The question "what
happens on resume when the skill is gone?" exposed it: the recipe had never
promised the skill existed, only mentioned it, so error, silent, and warn
were all wrong answers. Naming could only remove, and it tied a recipe to
what one machine had installed. Claude Code and the Agent SDK treat skills
as ambient and keep any narrowing with the skill or the user's settings.
The key, the definition mapping, the resolver filter, and the schema entry
came out the same day. Core's `AgentDefinition.skills` stays for hosts that
want it; the CLI never writes it. A path list letting a recipe bring its
own skill is the candidate if self-contained recipes are ever needed.

**Surfaces.** `axle info` gained a Skills section listing every directory
with its outcome; a `skills` help topic; no start-of-run line.

## What changed

- `configs/paths.ts`: `resolveSkillRoots`, `listSkillDirs`, `SKILL_FILE`;
  `listProjectInputs` counts a project skills directory that holds a skill.
- `cli/skills.ts`: `discoverSkills` returning the loaded skills, warning
  lines, and a per-directory report (`loaded`, `shadowed by`, `ignored`,
  `failed`).
- `agent-config.ts`: the resolver takes the discovered skills and passes
  them to `createAgentConfig`. `cli.ts`: discovery after the trust prompt
  settles, warnings printed beside the trust notices, `info` wired.
- `info.ts`: the Skills section. `tools/help.ts`: the `skills` topic.
- Docs: cli.md invariant 12 (consumption site) and 13, a dated decision,
  README Skills section, CHANGELOG entry.

## Verification

Unit tests cover discovery (both scopes, both roots, shadowing in both
directions, a failing skill, non-skill directories, the project-input
listing, the per-directory report under both trust states), the resolver
pass-through, and the info section. An e2e test writes a user skill and a
project skill under `.agents/skills`, checks the untrusted run's `Ignored
.agents/skills` notice and that its system prompt holds only the user
skill beside `read-file` and `view-skill`, then trusts and checks both
appear. CLI: 30 files, 373 tests.

One live run on Anthropic `claude-haiku-5-5` from a scratch folder with a
project skill whose instructions say to run `scripts/stamp.sh` and reply
with its output. The model called `view-skill` for `stamp`, ran the script
with `exec` from the skill directory, and replied with the exact token the
script printed. The folder was trusted for the run and revoked after.
