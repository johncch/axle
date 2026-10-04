# CLI prompts in the gh dialect, and a help tool

Working note for two small CLI surface changes made the same day.

## Prompts

`axle setup`, `axle cleanup`, the batch inputs prompt, and the missing-model
fallback asked their questions through `@clack/prompts`, whose theme draws a
guide bar down the left, diamond step markers, and radio circles. It reads
as a scaffolding wizard, and its glyphs are module constants that cannot be
configured; `updateSettings({ withGuide: false })` removes the bar and
nothing else.

Settled: render over `@clack/core`'s prompt state machines with our own
render functions in `src/ui/ask.ts`, in the GitHub CLI dialect. A green `?`
leads the question, the answer is echoed in cyan on the same line once
given, lists use a `>` cursor, and a confirm answers to `y`/`n` without
Enter (core already emits `confirm` on those keys). Host lines are single
lines with no padding: core writes one newline when a prompt closes, so the
settled frame must not end with one, or every answer leaves a blank line.
The `intro` header was dropped too; the verb is already on the user's
command line. `@clack/prompts` is removed from the package and `@clack/core`
is a direct dependency.

Rejected: keeping `@clack/prompts` with the guide off. The diamonds and
circles stay. Rejected: an `intro` line naming the verb. It duplicated the
shell prompt above it.

## `axle-help`

The model running inside the CLI had no way to answer "how do I write a
batch recipe" except from training data about some other tool. Settled: a
default local tool, `axle-help`, with a `topic` enum (overview, chat,
recipes, batch, resume, schedule, mcp, config, tools) returning a
hand-written section derived from the package README. A tool rather than a
system-prompt block because the text is paid for only when asked; a
hand-written copy rather than reading `README.md` at runtime because the
README is not in the published `files` and a build-time embed is more
machinery than nine string constants.

The copy is derived from the README and must be kept in step with it the
same way the README is kept in step with `docs/architecture/cli.md`.
