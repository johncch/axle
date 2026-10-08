import { z } from "zod";
import { formatReference } from "../cli/explain.js";
import type { ExecutableTool } from "./types.js";

export const HELP_TOPICS = [
  "overview",
  "chat",
  "recipes",
  "batch",
  "resume",
  "schedule",
  "mcp",
  "config",
  "tools",
] as const;

const helpSchema = z.object({
  topic: z
    .enum(HELP_TOPICS)
    .default("overview")
    .describe("Which part of the axle CLI to describe. Start with overview."),
});

const HELP: Record<(typeof HELP_TOPICS)[number], string> = {
  overview: `# axle

axle is an AI task runner. It chats from the terminal, saves recurring jobs
as checked-in YAML recipes, fans a recipe out over a folder of inputs, and
resumes any run, because every run is a session.

Verbs select the machine; flags parameterize it. A recipe is a saved
partial application of an invocation: anything the command line could say
has a home in the YAML, and the command line overrides selectively.

    axle                                  interactive chat on configured defaults
    axle -m "one question"                one-shot message, prints and exits
    axle -j job.yaml                      run a recipe and exit
    axle -j job.yaml -i                   run the task, then continue interactively
    axle -j job.yaml --args key=value     fill {{variables}} in the task
    axle batch -j recipe.yaml 'data/*.md' one isolated session per input
    axle resume <id>                      re-enter any saved session
    axle resume <id> -m "follow up"       one-shot continuation
    axle schedule -j recipe.yaml          register a recurring recipe (macOS), run once now
    axle schedule register|list|sessions|remove
    axle setup                            configure providers and defaults
    axle info                             print version, config files, and resolved config
    axle explain [path]                   describe the keys a recipe or cli.yaml accepts
    axle cleanup                          delete old sessions by age window

Global flags: --renderer ink|plain, --no-log, -d/--debug, --args key=value.

Topics for more detail: chat, recipes, batch, resume, schedule, mcp, config,
tools.`,

  chat: `# Chat

Bare \`axle\` starts an interactive chat using the default provider and model
from \`~/.axle/cli.yaml\` (\`defaults.provider\`, \`defaults.models\`).
\`axle -m "text"\` sends one message, prints the reply, and exits.
\`axle -j job.yaml -i\` runs the recipe's task first and then stays open.

In the chat, \`/quit\` is the only slash command; a message that is just
\`exit\` or \`quit\` (any case), or Ctrl-C or Ctrl-D at the prompt, also
exits. Ctrl-C during a turn asks the agent to stop at the next tool boundary;
a second Ctrl-C cancels immediately. The session is saved on every exit path
and its id is printed at start and exit.

\`--renderer\` picks the screen renderer: \`ink\` (default, live streaming
region and input line) or \`plain\` (line-oriented). Piped input or output
always gets plain. \`--no-log\` disables the run log, otherwise written to
\`~/.axle/logs/cli/<timestamp>.log\`. \`-d\` prints debug detail.

Long sessions compact automatically: near the context window (about 80% of
the model's window, looked up in the models.dev catalog, else 200,000) the
history is replaced with a summary plus the most recent user messages, and
the transcript shows a "Compacted context" line. A provider's
\`contextWindow\` in cli.yaml or an inline provider block overrides the
lookup; \`axle info\` shows the window in use. A recipe can opt out with
\`compaction: false\`.

On first run with no configuration anywhere, axle launches the setup wizard
(\`axle setup\`): pick a provider, paste a key (written to
\`~/.axle/credentials\`, chmod 600), and enter a default model id.`,

  recipes: `# Recipes (job files)

A recipe is a YAML file run with \`axle -j path/to/job.yaml\`.

    provider: anthropic                 # built-in type or a cli.yaml profile
    model: anthropic/claude-sonnet-5    # publisher-qualified or provider-native id
    name: summarize                     # optional
    system: You are a terse analyst.    # optional system prompt
    task: |
      Summarize the attached document for {{audience}}.
    tools: [read-file]                  # replaces the default local tool set
    providerTools: [web_search]         # provider-hosted tools
    files: [./data/report.txt]          # attached to the task
    request:
      reasoning: on                     # default | off | on | { effort, display }
      maxOutputTokens: 16000
      providerOptions:                  # passed through under the provider's names
        temperature: 0.2
    compaction: false                   # optional, default on

\`provider\` is a string (type: anthropic, openai, gemini, chatcompletions, or
a profile name from cli.yaml) or an inline object:

    provider:
      type: chatcompletions
      baseUrl: http://localhost:11434/v1
      apiKeyEnv: CUSTOM_KEY             # optional, names an env var
    model: gemma3

Both \`provider\` and \`model\` are optional. Missing values resolve through:
provider: recipe -> cli.yaml defaults.provider. model: recipe ->
cli.yaml defaults.models.<provider> -> <TYPE>_MODEL env or credentials ->
interactive prompt.

\`{{variables}}\` in the task are filled with \`--args key=value\`. A \`batch:\`
block makes the recipe a batch run (topic: batch). A \`schedule:\` block
declares recurrence (topic: schedule). An \`mcps:\` list connects MCP servers
(topic: mcp).

\`reasoning\`: leave unset or \`default\` for the provider's own default,
which is always safe. \`on\` is medium effort. \`off\` is rejected by models
that cannot disable thinking. \`{ effort: low|medium|high, display:
visible|hidden }\` for fine control. On budget-based models, a
\`maxOutputTokens\` you set must exceed the thinking budget (8,192 for on,
16,384 for high).`,

  batch: `# Batch

Batch is map(recipe, inputs): one isolated session per input, no
orchestrator. Inputs resolve from the command line, then the recipe's
\`batch:\` block, then an interactive prompt.

    axle batch -j summarize.yml 'data/*.txt'   # inputs from the command line
    axle batch -j summarize.yml                # inputs from the recipe, or prompted
    axle -j summarize.yml                      # batch: block present -> batch run

    # recipe
    task: |
      Summarize this file ({{file}}).
    batch:
      files: "./data/*.txt"
      concurrency: 3
      incremental: true                        # optional

Each matched file is attached to the task and available as \`{{file}}\`.
Every input is its own session: a failed item is inspected or continued
with \`axle resume <id>\` (each settled item line prints the id). A
project-local ledger at \`.axle/batch.jsonl\` indexes input -> session.

\`--incremental\` (or \`incremental: true\`) skips inputs already completed
with unchanged content; \`--no-incremental\` overrides. Recipe edits never
auto-invalidate; a plain run re-runs everything.

On a terminal, batch shows one spinner row per in-flight item and a totals
line. \`--verbose\` (or \`concurrency: 1\`) streams each item's full
transcript. Batch runs are non-interactive and cannot take \`-i\`.`,

  resume: `# Sessions and resume

Every run persists a resumable session to \`~/.axle/sessions/cli/<id>.json\`,
including each batch item and each scheduled firing. The id is printed at
run start and exit.

    axle resume <id>                  # re-enter the session interactively
    axle resume <id> -m "follow up"   # one-shot continuation
    axle resume 3a2f                  # any unique id prefix works

Resuming restores the saved conversation, model, system prompt, tools, and
MCP servers; no recipe needed. A provider named in the recipe, and the
default tool set when the recipe listed none, are resolved against the
current cli.yaml on every resume, so a profile edit reaches existing
sessions. Provider and model overrides are not accepted on the command
line. The original working directory is recorded and warned about on
mismatch, never changed to.

Sessions accumulate with no automatic retention. \`axle cleanup\` deletes
them by age window: older than 24 hours, 7 days, 30 days, or everything.`,

  schedule: `# Schedules (macOS)

A recipe declares its own recurrence in a \`schedule:\` block. \`axle schedule
-j\` registers it as a user LaunchAgent and runs it once right away; every
later firing re-reads the recipe and runs it exactly as \`-j\` would.

    schedule:
      every: 1h                  # <integer><unit>, unit s|m|h|d, minimum 60s

    schedule:
      at: ["09:00", "17:30"]     # HH:MM, machine-local time
      on: [mon, tue, wed, thu, fri]

A recipe uses \`every\` or \`at\`, not both. Cron expressions and
day-of-month schedules are not supported.

    axle schedule -j monitor.yaml            # register or update, then run once now
    axle schedule register -j monitor.yaml   # register or update only
    axle schedule list                       # registrations and last run
    axle schedule sessions -j monitor.yaml   # sessions the firings produced
    axle schedule remove -j monitor.yaml     # unregister; recipe, sessions, logs stay
    axle -j monitor.yaml                     # just run it; the schedule is untouched

Schedules are addressed by recipe path; there is no separate id. Applying is
idempotent. Editing the task, model, tools, or batch block takes effect on
the next firing; changing \`every\`, \`at\`, or the directory updates the
registration. Both forms refuse a recipe without a \`schedule\` block.

Each firing runs from the directory the recipe was applied in, resolves
credentials like a foreground run, and saves a session. Output lands in
\`~/.axle/logs/schedules/<id>.out.log\` and \`.err.log\`. A schedule never
overlaps itself; an overdue firing is skipped, not queued. Intervals missed
while asleep are not replayed; a clock time missed while asleep runs once on
wake. On Linux and Windows registering fails and plain \`-j\` still runs.`,

  mcp: `# MCP servers

Add an \`mcps\` list to a recipe. stdio and HTTP transports are supported.

    mcps:
      - name: wc                       # optional prefix for the server's tool names
        transport: stdio
        command: npx
        args: ["tsx", "tools/server.ts"]
        env: { KEY: value }            # optional
      - transport: http
        url: http://localhost:3100/mcp
        headers: { Authorization: Bearer ... }   # optional

The servers connect at run start, their tools join the agent's tool list,
and they are saved with the session so \`resume\` reconnects them.`,

  config: `# Configuration

Credentials: process environment, then the project's \`.axle/credentials\`,
then \`~/.axle/credentials\`. A \`.env\` in the working directory is not
read. Files use the same KEY=value names as the environment:

    ANTHROPIC_API_KEY=...   OPENAI_API_KEY=...   GEMINI_API_KEY=...
    ANTHROPIC_MODEL=anthropic/claude-sonnet-5          # optional per-provider model
    CHATCOMPLETIONS_BASE_URL=http://localhost:11434/v1 # OpenAI-compatible endpoints
    CHATCOMPLETIONS_MODEL=llama3
    CHATCOMPLETIONS_API_KEY=...

\`cli.yaml\` (\`~/.axle/cli.yaml\`, overridden per project by \`.axle/cli.yaml\`)
holds provider profiles and defaults:

    providers:
      openrouter:                     # a profile: endpoint config, no model
        type: chatcompletions
        baseUrl: https://openrouter.ai/api/v1
        apiKeyEnv: OPENROUTER_API_KEY
    defaults:
      provider: openrouter            # used when a recipe names no provider
      models:
        openrouter: z-ai/glm-4.6
        anthropic: anthropic/claude-sonnet-5
      tools: [read-file, exec]        # replaces the built-in default tool set

Profile names share a namespace with the built-in types and may shadow
them. Across user and project layers, \`defaults\` merge per key while
profiles replace wholesale. Resolution order everywhere is: environment and
credentials < cli.yaml defaults < recipe < command line.`,

  tools: `# Tools

Chat and recipes get these local tools by default:

    exec          run a shell command
    patch-file    apply an edit to a file
    read-file     read a file
    write-file    write a file
    axle-help     this documentation

They run without asking for approval, including in batch and scheduled
runs. A recipe's \`tools:\` list replaces the defaults; \`tools: []\` runs with
no local tools. \`defaults.tools\` in cli.yaml replaces the default set for
chat and recipes alike.

\`providerTools:\` lists tools the provider hosts, such as \`web_search\` and
\`code_execution\`; availability depends on the provider and model.

\`mcps:\` connects MCP servers whose tools join the list (topic: mcp).`,
};

function referenceFor(topic: (typeof HELP_TOPICS)[number]): string[] {
  if (topic === "recipes") {
    return ["", "## Every recipe key", ...formatReference("recipe")];
  }
  if (topic === "config") {
    return [
      "",
      "## Every cli.yaml key",
      ...formatReference("config"),
      "",
      "The user can print this with `axle explain config`, and one key with",
      "`axle explain config.defaults`. Recipe keys are under `axle explain recipe`.",
    ];
  }
  return [];
}

const helpTool: ExecutableTool<typeof helpSchema> = {
  name: "axle-help",
  description:
    "Documentation for axle, the CLI this conversation is running inside: commands, recipe YAML, batch runs, sessions and resume, schedules, MCP servers, configuration, and tools. Call this when the user asks how to use axle or what it can do.",
  schema: helpSchema,
  summarize: ({ topic }) => topic,
  execute: async ({ topic }) => [HELP[topic], ...referenceFor(topic)].join("\n"),
};

export default helpTool;
