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

## Markdown replies

The help tool returns markdown, which made the raw `#` and backticks in the
ink transcript hard to ignore. Core already had a terminal markdown renderer,
private to `SimpleWriter` for `--debug` output. Settled: move it to
`src/utils/markdown.ts`, export it from `@fifthrevision/axle/ui` as
`renderTerminalMarkdown`, and have ink's `PartView` run a settled agent text
part through it. The first cut left the live tail raw, on the theory that
re-lexing a partial document on every delta would flicker as half-open
emphasis changes meaning. In use the flicker is a style flip on one word
when its closing marker lands, and a screenful of raw asterisks while a
long reply streams was the worse experience, so the same day the live tail
became the last lines of the rendered text. The plain renderer stays raw;
it streams deltas and never reprints a part, and a piped log should carry
the model's text, not ANSI.

The first transcript showed what the debug-log origin had left out: blocks
ran together with no blank line, a fenced block was a dim language label
over yellow text and read as more inline code, and a table was its cells
pipe-joined. Settled: blocks join with a blank line (tight lists stay
tight, `loose` lists space their items), fenced code drops the label and
sits behind a dim `│` gutter in default color so inline yellow stays the
inline signal, and tables pad to column width under a dim rule.

Rejected: `marked-terminal`. It pulls in cli-table3, cardinal and
node-emoji for boxed tables, syntax highlighting and emoji substitution
the runner aesthetic does not want, and the gaps were four small changes
to a renderer core already had.
