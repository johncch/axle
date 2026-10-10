# Skills

**Status**: current · **Last design revision**: 2026-10-09 (0.34.0)

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
   the field. The specification's name rules (lowercase, hyphens, 64
   characters, matching the directory) are not checked: the client guide
   says to load such skills, and a warning needs a channel the parser
   lacks. One rule is enforced: a name containing `<`, `>`, `"` or a line
   break is `SKILL_INVALID`, in the parser and again in
   `SkillRegistry.add` for a `Skill` built without it. The name is
   therefore printed raw and is the same string in the catalog, the
   `skill_content` attribute and the `view-skill` enum.
4. **Core guarantees tiers one and two of progressive disclosure.** Tier
   one: the Agent's system prompt carries a catalog after the configured
   prompt — a heading, a short instruction to call `view-skill`, one
   `- name: description` line per skill — rendered from `agent.skills` as
   it is now. Tier two: a `view-skill` tool in the Agent's registry beside
   the host's tools, whose `name` argument is an enum of the loaded names;
   it returns
   `<skill_content name="…">` holding the body, then `Compatibility:` when
   present, then `Skill directory: <root>` with a relative-path reminder
   when `root` is set, then a `Files:` listing when there is one. Tier three
   (reading references, running scripts) works exactly as far as the host's
   tools can read what `root` names. The catalog does not print `root`; the
   activation result does.
   **Escaping** (2026-10-09): `description` and `compatibility` are author
   text the model reads for meaning, so wherever they are printed angle
   brackets become `&lt;` and `&gt;` and line breaks (`\n`, `\r\n` or a
   bare `\r`) collapse to a space.
   The name needs none (invariant 3). The body, `root` and `files` are
   printed raw: the body is Markdown whose code samples escaping would
   mangle, and the model hands paths back to the host's tools exactly, with
   no decoder in between. A `</skill_content>` in the body or a line break
   in a file name therefore closes or forges structure in the activation
   result; this is accepted, since the author of a skill already writes
   the instructions the model follows.
5. **No skills, no surface.** With no skills `system` is the configured
   prompt alone and no tool is registered, at construction and after the
   last skill is removed. A host tool named `view-skill` collides
   (`TOOL_REGISTRY_DUPLICATE`) at construction or at the `add` that would
   publish, whichever comes first; the registry never removes a tool it
   did not publish.
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
8. **Skills are live state, and every provider request reads them.**
   `agent.skills` is a `SkillRegistry` (`add`, `remove`, `set`, `has`,
   `get`, `list`, `size`) the host or a tool changes at any time. `set`
   replaces the whole list: it checks every name and rejects one listed
   twice before touching anything, so a throw leaves the old list, and it
   republishes once. A name already registered is not an error there. It owns
   `view-skill`: on every change it rebuilds the tool from the current list
   and republishes it into `agent.registry`. `agent.system` is derived —
   the configured prompt plus the catalog — and read-only. The Agent hands
   `stream()` its prompt and tool list at turn open and again at every
   tool-batch boundary, so a change lands on the next request whether it
   was made between turns or by a tool during one. `stream()` holds no
   registry and reads nothing live: it builds requests from the values it
   was last given.

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

## Runtime skills and the request boundary (2026-10-09)

Skills were materialized once, in the constructor: the catalog spliced into
`system`, the tool added to the registry. A host whose skills come from
connectors needs to add and remove them while a session is alive — the
user connects a source between messages, or the model activates one with a
tool — and the natural API is the one tools already have: a registry.

The question underneath was how a change reaches the loop. `stream()` had
been handed the Agent's `ToolRegistry` and read `executable()` before each
request, so tools changed mid-turn by accident of implementation while the
prompt, passed as a string, could not. The registry had been put inside
`stream()` as a substitute for a lifecycle: there was no other way for the
loop to learn of a change. There is now. `onToolBatchComplete` fires at
the one moment inside a turn when anything can have changed — a tool just
ran — and right before the next request is built, so the Agent answers it
with the current prompt and tools. Between turns the Agent snapshots them
when the turn opens, and `onSettled` orders host changes against a busy
queue ([agent-state.md](./agent-state.md)). `stream()` became a function
of what it is told: `registry` left its parameters, the private lookup it
built from arrays stayed, and `ToolContext.registry` — handed to every
tool and read by none — went with it. A tool that changes the Agent uses
the Agent in closure scope.

The catalog stays in the system prompt. The integration guide allows it
in the activation tool's description as well, and for a day that looked
simpler, since tool descriptions already travelled per request. With the
boundary callback carrying `system`, the prompt placement costs the same
and keeps the spec's "more broadly compatible" option; it also sidesteps a
reported provider limit on tool-description length that a few skills'
descriptions could cross.

Accepted consequences:

- **Changing skills invalidates the provider's prompt-cache prefix** from
  the next request on, as any system-prompt change does.
- **`agent.system` cannot be assigned.** It is what the model sees; the
  configured prompt is set at construction. A host that needs to change the
  base prompt at runtime asks for a setter and gets one then.
- **A skill updated in place is `remove` then `add`.** `add` of a name
  already present throws `SKILL_REGISTRY_DUPLICATE`, as the tool registry
  does for tools. (2026-10-09, later: `set` also replaces it, along with
  the rest of the list.)

## Rejected alternatives

- **A live registry inside `stream()`** (2026-10-09): the status quo for
  tools, extended to the prompt by a live object. It made the loop depend
  on a mutable object it did not own, dragged the registry-or-arrays
  resolution into the loop, and was only ever read in one place: before
  each request, which the boundary callback already marks.
- **The catalog in `view-skill`'s description** (2026-10-09): see above.
- **`agent.setSkills(list)`** (2026-10-09): the host keeps the full list and
  re-sends it on every change; a registry lets it add and remove by name,
  which is what a connector does. Later the same day `skills.set(list)`
  was added beside `add` and `remove`, at sunnyday's request: a host that
  already stores the full list hands it over in one call. It is a
  convenience on the registry, not a replacement for it.
- **Taking effect at the next turn only** (2026-10-09): simpler to state,
  but a tool that activated a skill would see nothing change until the user
  spoke again. The boundary callback makes "next request" cost the same.
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
- **Escaping the name where it is rendered** (2026-10-09): `a<b` would be
  `a&lt;b` in the catalog and `a<b` in the enum the model must pick from.
  Rejecting the four characters keeps one spelling everywhere.
- **Escaping `"` and control characters in descriptions** (2026-10-09):
  with the name constrained nothing author-written sits in an attribute,
  so `&quot;` would only add noise to ordinary descriptions; no failure
  from other control characters has been observed.
- **Encoding `root` and `files`** (2026-10-09): the model would ask the
  host's tools for `a&lt;b.md`, a file that does not exist.
