# Runtime skills and taking the registry out of stream() (AXL-83)

Working note for the change that makes skills changeable while an Agent
runs. Normative text is in `docs/architecture/skills.md` (invariants 4, 5
and 8, and the dated section) and one sentence in `agent-state.md`.

## Starting point

Skills were materialized in the constructor and `agent.system` was a
public field holding the rendered prompt. A host whose skills come from
connectors needs to add and remove them during a session. The ticket
proposed `setSkills(list)` and a rule that changes take effect at the next
provider request, reached by passing `stream()` a live prompt object the
way it was already passed the live `ToolRegistry`.

## The design conversation

The registry question came first. Tools already changed mid-turn because
`stream()` read the Agent's registry before each request; the prompt did
not, because it was a string. Extending the live-object pattern to the
prompt was the complexity the user did not love. The way around it was to
ask why the registry was inside `stream()` at all: as a substitute for a
lifecycle. With `onToolBatchComplete` firing right before each request
after the first, the Agent can hand the loop its current prompt and tools
there, and `stream()` becomes a function of what it is told. `registry`
left `StreamParams`; the private lookup stayed as a `Map`; `ToolContext.
registry`, read by nothing, went too. A review question then stripped
`nativeName`: every adapter already resolved names itself, and the
pre-resolution in `resolveTools` served only the web-search fallback
decision, which is the one thing that must stay in the loop.

The boundary decision type went through three shapes: `{ action, system?,
tools?, providerTools? }` (allowed `finish` with new inputs, which is
nonsensical), an object meaning continue with merge semantics (twelve
lines of `??`), and finally `"continue" | "finish" | Pick<StreamParams,
"system" | "tools" | "providerTools">` with replace semantics, one line to
apply.

Then the catalog. Moving it into `view-skill`'s description removed every
prompt-derivation concern and was spec-compliant, but a side note flagged
a reported provider limit on description length; with the boundary
callback carrying `system`, the system-prompt placement costs nothing
extra, so it stayed. `agent.skills` is a `SkillRegistry` that publishes
`view-skill` into `agent.registry` and never removes a tool it did not
publish, so a host tool of that name still collides.

Two things came out of this that are not in the change: `AgentDefinition`
is the CLI's serialization format living in core (AXL-88), and the
web-search backend belongs on the chat-completions provider rather than in
a process global (AXL-89).

## What landed

- `stream()`: no `registry`; `onToolBatchComplete` may return inputs; the
  loop reconfigures from them. `resolveTools` works on arrays with a `Map`
  and keeps the duplicate-name check; `ResolvedProviderTool` is gone.
- `ToolContext` has no `registry`.
- `SkillRegistry`; `agent.skills`; `agent.system` as a derived getter; the
  Agent snapshots at turn open and refreshes from the batch callback.
- Docs: `skills.md`, one sentence in `agent-state.md`, terminology,
  README (Agent, `stream()`, the batch callback, Skills), migration.

## Left out

- A `webSearch` option on `chatCompletions()` (AXL-89).
- CLI changes; nothing there needs runtime skills yet.
- A built-in activation tool; the host builds it with the agent in scope.

## Verification

`stream()`: values returned from the boundary shape every later request;
replace semantics. Agent: a tool adds a tool mid-send and the next request
offers it. Skills: the three-turn add/remove sequence against recorded
requests; a tool adding a skill mid-turn; remove-to-empty; `context()`
tracking; host `view-skill` collision on `add`. `SkillRegistry` unit
tests. Whole repo: 103 files, 1448 tests. No live provider was exercised.
