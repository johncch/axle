# Skills

**Status**: current · **Last design revision**: 2026-10-08 (0.34.0)

This document is normative for how core represents Agent Skills and
discloses them to the model. Code and tests are built against it;
divergence is a defect. Vocabulary is defined in
[terminology.md](../terminology.md). Host-side discovery, precedence, and
trust are the host's concern; the CLI's rules are in [cli.md](./cli.md).

## Invariants

1. **The format is Agent Skills, unchanged.** A skill is a directory with a
   `SKILL.md` whose YAML frontmatter has `name` and `description` and whose
   Markdown body is the instructions, plus optional `scripts/`,
   `references/`, `assets/`. Core adds no fields and no file of its own; a
   skill written for Claude Code or any compliant client loads as is.
   `license`, `compatibility`, `metadata`, and `allowed-tools` are carried in
   `frontmatter`, typed per the specification, and only `compatibility` is
   acted on (printed at activation). Frontmatter scalars are read as text
   (YAML failsafe schema): the specification types every field as a string,
   and an unquoted `version: 1.0` must not fail as a number.
2. **A `Skill` is plain data; core never reads a skill's files.** `name`,
   `description`, `instructions` (the body, frontmatter stripped), optional
   `root`, optional `files`, optional `frontmatter`. `root` is opaque: the
   base the host's own tools accept — a directory, an `s3://` prefix,
   anything — printed to the model verbatim and never interpreted. `files`
   are relative names under `root`, listed, never read.
   `parseSkillMarkdown(text)` is the parser and takes text, not a path;
   `loadSkill(dir)` is the filesystem convenience (bounded walk, dotfiles
   skipped, `SKILL.md` excluded from `files`).
3. **Parsing is strict on the required fields and lenient on the name.** No
   frontmatter block, a missing or empty `name` or `description`, invalid
   YAML, or a mistyped optional field is `AxleError` `SKILL_INVALID` naming
   the field. The name's character set and its match to the directory are
   not checked: a warning needs a channel the parser lacks, and the only
   consequence of an odd name is an odd enum value.
4. **Core guarantees tiers one and two of progressive disclosure.** Tier
   one: the Agent constructor appends a catalog to `system` — a heading, a
   short instruction to call `view-skill`, one `- name: description` line
   per skill. Descriptions are author text landing in the system prompt,
   so angle brackets are escaped and line breaks collapsed. Tier two: a
   `view-skill` tool in the Agent's registry beside the host's tools, whose
   `name` argument is an enum of the loaded names; it returns
   `<skill_content name="…">` holding the body, then `Compatibility:` when
   present, then `Skill directory: <root>` with a relative-path reminder
   when `root` is set, then a `Files:` listing when there is one. Tier three
   (reading references, running scripts) works exactly as far as the host's
   tools can read what `root` names. The catalog does not print `root`; the
   activation result does.
5. **No skills, no surface.** An absent or empty `skills` list leaves
   `system` untouched and registers no tool. A host tool named `view-skill`
   collides at construction (`TOOL_REGISTRY_DUPLICATE`), which is the right
   time to find out.
6. **Definitions name skills; sessions re-resolve.**
   `AgentDefinition.skills` is `{ name }[]`; `ResolvedAgentDefinition.skills`
   is `Skill[]`; `createAgentConfig` errors when a definition names skills
   and the resolver returns none, as with tools. A stored session holds
   names only, so a resumed agent gets the current skill behind each name
   and a deleted skill fails resolution by name. Core does not persist
   definitions; the host does ([agent-state.md](./agent-state.md)).
7. **Activated content is ordinary conversation.** `view-skill` results are
   tool results like any other and are compacted like any other
   ([compaction.md](./compaction.md)). The catalog survives compaction
   because the system prompt does.

## Design rationale (2026-10-08)

Skills are the precursor to custom tools for the CLI (AXL-74 settled folder
trust first): executable code ships as a skill script and runs through
`exec`, which is already trust-gated, so no bespoke tool format is needed.
Core provides the reference toolset — type, parser, catalog, activation
tool, definition reference — so every host (CLI, axle-code, sunnyday) gets
the same disclosure behaviour instead of a prompt builder and a tool each.

Sunnyday settled the storage question. Its skills are zip bundles in object
storage at rest and a bundled directory for built-ins; at run time they are
unpacked into a sandbox and the model reads them with sandbox tools. The
app never reads a skill's files for the model. Any adapter interface with
read methods would be implemented by every host and called by nothing, so
a skill is data and `root` is a string the host's tools understand.

The integration guide allows activation by file read (the catalog lists a
path, the model opens it) or by a dedicated tool. A tool works when the
host registers no file tool (a recipe with `tools: []`, a host with virtual
storage), lets core control the output shape, and constrains the name to
an enum. The catalog therefore omits the location and the tool result
carries it.

## Rejected alternatives

- **An adapter interface (`readFile`, `list`) on the skill object**
  (2026-10-08): nothing in core would call it; tier three is always the
  host's tools reading what `root` names.
- **Flat injection of every body into the system prompt** (2026-10-08):
  less code, but a folder of ten skills would cost its full instruction
  set on every turn, which is what the format exists to avoid.
- **A `list-skills` tool** (2026-10-08): sunnyday had one beside
  `view-skill`; the catalog is in the system prompt, which survives
  compaction, so the tool is redundant.
- **Exempting activated skill content from compaction** (2026-10-08): the
  guide recommends it; rejected in [compaction.md](./compaction.md).
- **Acting on `allowed-tools`** (2026-10-08): it is a permission-layer
  field in another client's syntax; core has no permission layer, and the
  host decides the tool set.
- **Strict name validation per the specification** (2026-10-08): the guide
  itself recommends warning and loading; core has no warning channel in
  the parser and the enum tolerates any string.
