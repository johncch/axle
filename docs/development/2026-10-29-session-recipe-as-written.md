# A session is the recipe as written; `AgentDefinition` leaves core

Working note for AXL-88. The ticket asked two things that turned out to be
independent: what a CLI session file carries, and whether `AgentDefinition`
belongs in core.

## Where the type went

Nowhere. `AgentDefinition`, its ref types, `ResolvedAgentDefinition`,
`AgentDefinitionResolver`, `SavedAgent` and `createAgentConfig` are deleted
from the library (0.35.0 migration note). The CLI was the only consumer, and
its resolver callback ignored most of the definition it was handed, resolved
provider, tools, MCPs and skills from `cli.yaml`, and got `droppedTools` out
through a closure variable. `createCliAgentConfig(target, recipe, …)` now
builds `AgentConfig` directly and returns `droppedTools` as a value. Three
of `createAgentConfig`'s four throws checked the host's own callback; all
four go.

The session file's stored shape is the recipe's own:
`AgentRecipe = JobConfigSchema.pick({ name, provider, model, system, request,
tools, providerTools, mcps, compaction })`. One Zod schema validates the YAML
and types the file; a new recipe key is one edit. Files in the old
`definition` shape are mapped on load (`tools: [{ name }]` → names,
`provider: { type, config }` → inline object or name, top-level
`compaction` folded in); `version` stays 1 because the loader can tell the
two apart by which key is present.

## What the file carries

The rule, in the owner's words:

> Everything in the recipe file is written into the session. Everything
> that is not in the recipe is resolved at runtime. Chat is an example
> where everything is always resolved at runtime.

Against 2026-10-07 this removes one exception: the resolved `model` is no
longer written when the recipe left it out. A picked model is the run's,
not the recipe's, so the picker now offers to save it on every run.

## The reversal, twice

The first draft of this change went the other way: store the recipe's
path, re-read it on resume, so a tool added to the recipe reaches a live
session the way `claude --resume` picks up today's tools. It was argued
from "config is config", coded, and tested (resume picked up an added
tool; a deleted recipe failed naming the path). It was then reversed back
on three costs: a pointer dangles when the recipe moves; a provider edit
under an existing history either breaks the next request or needs a
frozen exception, and the exception grew into "provider and model frozen,
rest live", a third rule; and a recurring job's memory belongs in the
checked-in YAML, not in a second copy that drifts.

Both rules are internally consistent. The difference is which failure to
prefer: a stale snapshot, or a dangling path and silent divergence. The
owner asked that this be recorded so the next time it comes up the
conversation starts from a new principle, not a replay of this trade. It
is in `cli.md`'s decision log under this date.

## Scenarios, as the code now behaves

- `-j job.yml`: stated keys stored as written; gaps resolve from
  `cli.yaml`, env, picker. Skills from disk, never stored.
- Chat, `-m`: `recipe: {}`; everything resolves at runtime.
- Resume with provider, model, tools stated: used as stored; the recipe
  file on disk is never read. A named provider's profile still resolves
  live.
- Resume with gaps: each gap resolves as on a fresh run, against today's
  `cli.yaml`.
- Resume of a chat: today's `defaults.provider` and `defaults.models`.
- Resume of a pre-2026-10-29 file: converted; keeps the provider and
  model the old code recorded.
- Batch items and scheduled occurrences: each a fresh `-j` run.
