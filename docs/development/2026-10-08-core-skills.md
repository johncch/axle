# Skills in core (AXL-47)

Working note for the library half of skills. The CLI half (discovery,
trust, the `skills:` recipe key) is AXL-48 and builds on this.

## Starting point

Nothing in Axle knew what a skill was. The CLI's custom-tool idea — a global
send-SMS tool, say — had stalled on the trust question, which AXL-74 settled
the same day with folder trust. With `exec` trust-gated, executable code can
ship as a skill script with no bespoke tool format, so skills became the
next step and the trust work its precursor.

Sunnyday already runs skills: built-ins bundled with the app, uploads as zip
bundles in R2, both unpacked into a sandbox at run time and surfaced to the
model with its own prompt builder and `view-skill` / `list-skills` tools.
Axle-code and the CLI would each have written the same thing.

## The design conversation

The first question was whether core needed a filesystem abstraction. The
worry was that sunnyday's skills were not file-backed. Reading sunnyday
answered it: at rest they are not, but by the time the model runs every
skill is on a filesystem the sandbox tools can reach, and the app never
reads skill files for the model. So the skill object is plain data with an
opaque `root` string and a `files` listing, and tier three of progressive
disclosure is whatever the host's tools can read. A host with skills in S3
and a `read-s3` tool passes `root: "s3://…"` and it works; a host with no
file tools gets instruction-only skills.

The second was whether core should own the prompt and the tool or leave
them to hosts. Core owns them: the format is enough of a standard that a
reference toolset is worth more than per-host variation, and sunnyday can
delete its copy.

Reading the specification and its integration guide settled the rest:
`allowed-tools` is a real (experimental) field, not something we invented;
the guide names both file-read and dedicated-tool activation as valid, so
sunnyday's integration was already compliant; the enum on the tool's `name`
argument, the file listing in the activation result, and lenient name
validation all come from the guide. Two of its recommendations were
rejected: exempting skill content from compaction (the catalog survives,
one call reloads) and a `list-skills` tool (redundant with the catalog).

## What changed

- `packages/axle/src/skills/`: `Skill` and `SkillDefinitionRef` types;
  `parseSkillMarkdown(text)` (frontmatter via the YAML failsafe schema, Zod
  loose object for the spec's optional fields, `SKILL_INVALID` errors
  naming the field); `loadSkill(dir)` (bounded walk, dotfiles skipped);
  `renderSkillsCatalog` and `createViewSkillTool`.
- `AgentConfig.skills`; the Agent constructor appends the catalog to
  `system` and registers `view-skill`. Nothing happens for an empty list.
- `AgentDefinition.skills` as name refs, `ResolvedAgentDefinition.skills`,
  and the pass-through plus guard in `createAgentConfig`.
- `yaml` joins core's dependencies. Exports from the package index.
- Docs: `docs/architecture/skills.md`, a rejected alternative in the
  compaction doc, a `Skill` entry in terminology, a Skills section in the
  library README.

A side review caught that YAML's default schema turned an unquoted
`version: 1.0` under `metadata` into a number, failing the string-map check
and rejecting real skills written for other clients. The failsafe schema
reads every scalar as text, which is how the specification types every
field.

## Verification

Unit tests cover the parser (fields, CRLF, lenient names, every rejection,
unquoted scalars), `loadSkill` (root, listing, bounds, missing file), the
catalog (escaping, no roots), the tool (enum, the three output shapes,
`summarize`), the Agent wiring (system composition, context estimate, empty
list, duplicate tool), and the definition pass-through (resolved, missing,
absent). Core: 69 files, 978 tests. No live model call was made; the
disclosure behaviour against a real model is the CLI's to exercise in
AXL-48.
