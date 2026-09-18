# Recipe Schedules

Working note for AXL-28, "CLI: Add macOS recurring recipe schedules". The
normative result is invariant 10 in `docs/architecture/cli.md` plus its
dated decisions; this records how it was built and what moved during the
build.

## Starting point

The first use case was an hourly stock monitor: call an API, send an email
only when a condition holds. The 0.31 CLI already had everything except
recurrence — strict v3 recipes, `-j` dispatching to session or batch,
resumable sessions for every run, and management verbs (`setup`,
`cleanup`) that exit before any agent machinery starts. The ticket fixed
the shape up front: recurrence is a recipe property, the OS is the
registrar, macOS `launchd` is the only backend, and everything above the
backend must stay portable.

## Build order

Five batches, each green before the next:

1. **Schema, duration, identity, records.** `schedule: { every }` as a
   strict optional block; the grammar as a JSON-schema `pattern` and the
   range (60s floor, signed 32-bit ceiling) as a refinement. Identity is
   the realpath's sha256, 16 hex chars, mirroring session-id prefix
   lookup. Records are versioned JSON at 0600 with a discriminated
   `binding`; listing flags corrupt, unsupported-version, and
   unknown-backend files and continues.
2. **Backend contract and reconciliation.** `ScheduleBackend` is two
   methods; a registry resolves by platform (for apply) and by binding kind
   (for remove). Reconciliation is apply-then-commit against a fake backend
   in tests: create, no-op, update, failed-create leaves nothing,
   failed-update keeps the old record.
3. **launchd.** Plist rendering as one template literal; `launchctl`
   behind an injected runner; bootout-before-bootstrap on every apply so
   create, update, and crash recovery share one path; rollback restores
   the previous plist and reloads it.
4. **CLI wiring.** Kernel `--once` (later removed, see the reversal below)
   and hidden `--scheduled <id>`; the
   `schedule` verb with `list`, `remove`, `sessions`; reconciliation ahead
   of the setup wizard and model prompts; the TTY wizard writing the block
   back through `YAML.parseDocument`; the per-schedule runs ledger.
5. **Docs**, this note, changelog.

## What moved during the build

**Discoverability was a gap in the ticket.** As specified, nothing told the
user a schedule had fired: `list` showed registrations, sessions carried no
schedule tag, and only the launchd log files held the answer. Run history
was explicitly deferred. The fix that fit inside the ticket's constraints
is the runs ledger — one JSONL line per occurrence with start, end, status,
and session ids — read by a new `schedule sessions <id>` subcommand and
summarized as a last-run column in `list`. It is the batch ledger's shape
applied per schedule, deliberately not a database.

**Session capture without touching the runners.** The ticket held
`runAgentSession` fixed, and its many test callers assert on a boolean.
Two owned channels already carried the ids: the single run's
`SessionStore`, which now remembers the id it saved, and the batch ledger,
which the occurrence reads back for entries written during its run.
Widening the runner return type was rejected as churn for a value already
in hand; tagging session files was rejected as a persistence change for
one reader.

**Relaunch argv under tsx.** The recorded command is
`[execPath, ...execArgv, resolve(argv[1])]`. Under `pnpm start` that is
node with tsx's loader flags and the `.ts` entry; from an install it is
node and `dist/cli.js`. Both are shell-free and PATH-independent. The
occurrence e2e test spawns the recorded argv verbatim, so the dev shape is
exercised on every run.

**Test injection for a subprocess CLI.** The e2e suite spawns the CLI, so
injection is by environment: `AXLE_LAUNCHCTL` substitutes the launchctl
binary (a shell script that logs its arguments) and
`AXLE_SCHEDULE_PLATFORM` overrides the platform so the macOS path runs on
Linux CI. HOME already pointed at a scratch directory, which is where the
LaunchAgents dir, records, and logs land.

**Plist test.** Substring assertions on the rendered XML broke the moment
indentation changed and proved little. Replaced by one structural test: a
small walker in the test file parses the plist back into an object and
asserts deep equality, which proves both "exactly these keys" (no
`RunAtLoad`, no shell) and escaping round-trips in a single assertion.

**`checks/` scenario dropped.** The ticket asked for a portable scenario
under `checks/`, but that harness runs core-library cases against real
providers and has no CLI spawning; the scheduled path is covered by the
stub-provider e2e tests instead.

## Reversal before landing (2026-09-17)

Manual testing surfaced that the command surface was subtly doubled.
`axle -j` and `axle schedule -j` both registered and differed only in
whether the task ran; `--once` existed to undo `-j`'s side effect; and
deleting the block left a live LaunchAgent that nothing reconciled, because
`-j` only reconciled when a block was present and occurrences skip
reconciliation by design.

The discussion went through four shapes. A y/n gate on `-j` was dropped for
a read-only state line (bare `-j` never prompts). Register-only as the
verb's default was dropped once the first-firing delay was stated plainly:
`StartInterval` without `RunAtLoad` means a `1d` schedule does nothing for
a day, and `RunAtLoad` is no fix because it fires on every login. `--no-run`
was dropped as an inverted flag deciding whether the kernel boots at all.
What landed: plain `-j` is a pure run with a state line; `axle schedule -j`
registers and then runs once in the foreground, recorded as the schedule's
first run; `axle schedule register -j` is the management-only form;
`remove` and `sessions` take `-j <recipe>`.

Two gaps closed in the same pass. Updates now say what changed, since
working directory and PATH count as drift and the old message showed only
the interval. And the backend gained `isLoaded`, so a record that matches
but whose LaunchAgent is gone is restored instead of reported current, and
`list` flags it.

The user-facing schedule id went next. It had been mirrored from
sessions, with prefix lookup, but the first manual run surfaced "Pass a
schedule id" as a question rather than an instruction: nobody had been
told there was one. A session has no name but its id; a schedule is a
recipe, and the path is a handle the user already holds. Every subcommand
now takes `-j <recipe>`, ids appear in no output, and a recipe that has
been moved or deleted is matched by its recorded path so `remove` still
works from what `list` shows.

Positional recipes (`axle <recipe>`, `axle schedule <recipe>`) came up and
were split out: the current rule is that recipes are always `-j` and ids
and inputs are positional, and changing that is a CLI-wide grammar change.

## Left for later

Linux/systemd and Windows backends; calendar, cron, and one-shot schedules
(a distinct schema shape, not `every`); catch-up and retry; queue or
parallel overlap policies; log rotation; continuing one session across
occurrences; model-created schedules.
