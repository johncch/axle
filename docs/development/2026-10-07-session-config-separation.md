# Sessions name configuration instead of copying it

Working note for the change that separates what a session freezes from
what it looks up. It came out of planning AXL-73 (resolving the context
window from models.dev), which needed a `contextWindow` setting on a
provider profile and raised the question of what a resumed session would
see. The answer exposed a defect in the session model, fixed here before
AXL-73 is picked back up.

## What was wrong

`resolveTarget` resolved a recipe's provider all the way to an endpoint
before the definition was built, so a session file held the profile's
contents — `baseUrl`, `apiKeyEnv`, `vendor`, client options, and an inline
`apiKey` in the clear — rather than the profile's name. `createAgentDefinition`
likewise filled an absent `tools:` from `defaults.tools` before saving.
`axle resume` rebuilt the run from the session file alone, so:

- Editing a profile's `baseUrl` in `cli.yaml` never reached an existing
  session; it kept talking to the old host.
- Changing `defaults.tools` left every resumable chat on the old tool set.
- The profile name was not saved, so resume could not have re-resolved
  even if it wanted to.

Invariant 6 in `docs/architecture/cli.md` recorded this as "the stored
definition is authoritative." That was the right rule for the conversation
and the wrong rule for configuration.

## The rule

- **Conversation** — frozen. `session.messages` and `turns`.
- **Recipe** — frozen as written. `system`, `request`, `tools` when
  listed, `providerTools`, `mcps`, `compaction`, an inline `provider`
  object, and the resolved `model`.
- **Configuration** — never stored. A provider name is saved as the name;
  an absent `tools:` is saved as absent; `apiKeyEnv` is a reference.
  Every run, resume included, resolves these against the current
  `cli.yaml`, credentials, and environment.

Two edges were argued and settled:

- **Inline provider objects stay.** `provider: { type: chatcompletions,
baseUrl: … }` is the portable form of a recipe; `provider: ollama` is the
  shared-machine form. Moving the object into `./.axle/cli.yaml` is a
  lateral move. An inline object is a literal, so it is frozen with the
  recipe — the same distinction the recipe already draws between `apiKey`
  (literal) and `apiKeyEnv` (reference).
- **The model stays frozen** even when `defaults.models` chose it. The
  history was produced by that model and is sometimes provider-shaped;
  resuming under a different one can fail outright, not just behave
  differently. Changing a session's model is a possible future override,
  not a resolution rule.

## What changed

- `resolveTarget` saves a named provider as `{ type: "<name>" }` and an
  inline object as `{ type, config }`. New `resolveEndpoint(provider,
cliConfig)` does the lookup — inline config as is, else profile, else
  built-in type, else error — and is called from `resolveCliProvider` and
  the model picker. `resolveAgentDefinition` takes `cliConfig`.
- `tools` is written into the definition only when the recipe has a
  `tools:` key (`[]` stays `[]`); `resolveAgentDefinition` fills an absent
  list from `defaults.tools` or the built-ins at run time.
- A recipe's inline provider validates against `RecipeProviderSchema`, the
  profile variants with `apiKey` omitted. `cli.yaml` profiles keep
  `apiKey`; they are user-local, like `credentials`.
- The missing-key error names the variable:
  `No API key for anthropic. Set ANTHROPIC_API_KEY in the environment or
~/.axle/credentials, or apiKeyEnv on the provider.` An `apiKeyEnv` that
  points at an unset variable says so by name.
- A session saved before this change carries `{ type, config }` for a
  named profile and goes down the inline path, so it resumes as it did.

## Verification

- `agent-config.test.ts`: saved shape vs resolved shape for providers and
  tools; a named provider resolved against two different `cli.yaml`s
  yields two different providers; a legacy definition with copied config
  resolves without `cli.yaml`.
- `e2e.test.ts`: edit a profile's `baseUrl` between run and resume and the
  resumed send goes to the new host; change `defaults.tools` and the
  resumed request carries the new tool list.
- `config-loaders.test.ts`: `apiKey` in a recipe provider is rejected.
