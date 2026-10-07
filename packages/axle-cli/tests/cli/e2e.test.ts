import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import type { ScheduleRecord, ScheduleRun } from "../../src/cli/schedule/records.js";

const PKG_ROOT = join(import.meta.dirname, "..", "..");
const TSX_BIN = join(PKG_ROOT, "node_modules", ".bin", "tsx");
const CLI_PATH = join(PKG_ROOT, "src", "cli.ts");
const TEST_ROOT = join(import.meta.dirname, "__e2e_tmp__");

const SPAWN_TIMEOUT = 30_000;

type StubReply = { text: string } | { error: string };

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
}

interface CliRun {
  code: number | null;
  output: string;
}

interface CliFixture {
  HOME: string;
  CWD: string;
  baseUrl: string;
  replies: StubReply[];
  requests: ChatRequest[];
  runCli(args: string[], env?: Record<string, string>, stdin?: string): Promise<CliRun>;
  runCliWithSlowReader(args: string[], env?: Record<string, string>): Promise<CliRun>;
  writeRecipe(name: string, extra?: string): Promise<string>;
  writeOverThresholdRecipe(name: string, extra?: string): Promise<string>;
}

interface ScheduleFixture {
  LAUNCH_AGENTS: string;
  SCHEDULES: string;
  scheduleEnv(platform?: string): Record<string, string>;
  launchctlCalls(): Promise<string[]>;
  runsOf(id: string): Promise<ScheduleRun[]>;
  records(): Promise<Array<{ id: string; record: ScheduleRecord }>>;
  runOccurrence(programArguments: string[]): Promise<CliRun>;
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; stdin: string; readAfterMs?: number },
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env });
    if (options.readAfterMs !== undefined) {
      child.stdout.pause();
      setTimeout(() => child.stdout.resume(), options.readAfterMs);
    }
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(options.stdin);
  });
}

// Every test gets its own home, working directory, and stub server, so the
// tests in this file can run concurrently.
const it = test.extend<{ cli: CliFixture; schedule: ScheduleFixture }>({
  cli: async ({}, use) => {
    await mkdir(TEST_ROOT, { recursive: true });
    const testDir = await mkdtemp(join(TEST_ROOT, "test-"));
    const HOME = join(testDir, "home");
    const CWD = join(testDir, "cwd");
    await mkdir(HOME, { recursive: true });
    await mkdir(CWD, { recursive: true });

    const replies: StubReply[] = [];
    const requests: ChatRequest[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push(JSON.parse(body));
        const reply = replies.shift() ?? { text: "stub reply" };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        if ("error" in reply) {
          res.write(sse({ error: { type: "server_error", message: reply.error } }));
        } else {
          res.write(
            sse({
              id: "stub-1",
              model: "stub-model",
              choices: [{ index: 0, delta: { role: "assistant", content: reply.text } }],
            }),
          );
          res.write(
            sse({
              id: "stub-1",
              model: "stub-model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
            }),
          );
        }
        res.write("data: [DONE]\n\n");
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

    const writeRecipeFile = async (name: string, lines: string[]): Promise<string> => {
      const path = join(CWD, name);
      await writeFile(path, lines.join("\n"));
      return path;
    };

    await use({
      HOME,
      CWD,
      baseUrl,
      replies,
      requests,
      runCli: (args, env = {}, stdin = "") =>
        run(TSX_BIN, ["--conditions=axle-source", CLI_PATH, ...args], {
          cwd: CWD,
          env: { PATH: process.env.PATH!, HOME, ...env },
          stdin,
        }),
      runCliWithSlowReader: (args, env = {}) =>
        run(TSX_BIN, ["--conditions=axle-source", CLI_PATH, ...args], {
          cwd: CWD,
          env: { PATH: process.env.PATH!, HOME, ...env },
          stdin: "",
          readAfterMs: 3000,
        }),
      writeRecipe: (name, extra = "") =>
        writeRecipeFile(name, [
          "provider:",
          "  type: chatcompletions",
          `  baseUrl: ${baseUrl}`,
          "model: stub-model",
          "task: |",
          "  Say hello.",
          extra,
        ]),
      // With AXLE_CONTEXT_WINDOW=1000 the compaction threshold is 800 tokens
      // (~2400 chars); this task alone crosses it, so a resumed session is over
      // the threshold before its next send.
      writeOverThresholdRecipe: (name, extra = "") =>
        writeRecipeFile(name, [
          "provider:",
          "  type: chatcompletions",
          `  baseUrl: ${baseUrl}`,
          "model: stub-model",
          extra,
          "task: |",
          `  Analyze this. ${"filler words here ".repeat(200)}`,
        ]),
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(testDir, { recursive: true, force: true });
  },

  schedule: async ({ cli }, use) => {
    const testDir = join(cli.HOME, "..");
    const launchctl = join(testDir, "launchctl");
    const launchctlLog = join(testDir, "launchctl.log");
    const LAUNCH_AGENTS = join(cli.HOME, "Library", "LaunchAgents");
    const SCHEDULES = join(cli.HOME, ".axle", "schedules");
    await writeFile(launchctl, '#!/bin/sh\necho "$@" >> "$AXLE_TEST_LAUNCHCTL_LOG"\nexit 0\n');
    await chmod(launchctl, 0o755);

    const scheduleEnv = (platform = "darwin"): Record<string, string> => ({
      AXLE_LAUNCHCTL: launchctl,
      AXLE_SCHEDULE_PLATFORM: platform,
      AXLE_TEST_LAUNCHCTL_LOG: launchctlLog,
    });

    await use({
      LAUNCH_AGENTS,
      SCHEDULES,
      scheduleEnv,
      // `print` is the read-only loaded-check; only bootout/bootstrap mutate.
      launchctlCalls: async () => {
        try {
          return (await readFile(launchctlLog, "utf-8"))
            .split("\n")
            .filter((line) => line && !line.startsWith("print "));
        } catch {
          return [];
        }
      },
      runsOf: async (id) => {
        try {
          return (await readFile(join(SCHEDULES, `${id}.runs.jsonl`), "utf-8"))
            .trim()
            .split("\n")
            .map((line): ScheduleRun => JSON.parse(line));
        } catch {
          return [];
        }
      },
      records: async () => {
        let names: string[];
        try {
          names = (await readdir(SCHEDULES)).filter((name) => name.endsWith(".json"));
        } catch {
          return [];
        }
        const parsed: Array<{ id: string; record: ScheduleRecord }> = [];
        for (const name of names) {
          try {
            parsed.push({
              id: name.slice(0, -".json".length),
              record: JSON.parse(await readFile(join(SCHEDULES, name), "utf-8")),
            });
          } catch {
            continue;
          }
        }
        return parsed;
      },
      runOccurrence: (programArguments) =>
        run(programArguments[0], programArguments.slice(1), {
          cwd: cli.CWD,
          env: { PATH: process.env.PATH!, HOME: cli.HOME, ...scheduleEnv() },
          stdin: "",
        }),
    });
  },
});

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe.concurrent("cli.ts end-to-end", () => {
  it(
    "runs a recipe: exit 0, response on stdout, session file written",
    async ({ cli }) => {
      const { replies, requests, runCli, writeRecipe, HOME } = cli;
      replies.push({ text: "hello from the stub" });
      const recipe = await writeRecipe("job.yml");

      const { code, output } = await runCli(["-j", recipe, "--renderer", "plain", "--no-log"]);

      expect(code).toBe(0);
      expect(output).toContain("hello from the stub");
      expect(output).toContain("Done in");
      expect(requests).toHaveLength(1);
      expect(requests[0].model).toBe("stub-model");

      const sessionId = output.match(/axle resume (\S+)/)?.[1];
      expect(sessionId).toBeTruthy();
      const saved = JSON.parse(
        await readFile(join(HOME, ".axle", "sessions", "cli", `${sessionId}.json`), "utf-8"),
      );
      expect(saved.session.messages).toHaveLength(2);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "a failed recipe run renders the model error and exits 1",
    async ({ cli }) => {
      const { replies, runCli, writeRecipe } = cli;
      replies.push({ error: "stub exploded" });
      const recipe = await writeRecipe("job.yml");

      const { code, output } = await runCli(["-j", recipe, "--renderer", "plain", "--no-log"]);

      expect(code).toBe(1);
      expect(output).toContain("Model error: stub exploded");
      expect(output).toContain("Failed in");
      expect(output).not.toContain("Done in");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "one-shot -m resolves provider and model through cli.yaml defaults and env",
    async ({ cli }) => {
      const { replies, requests, runCli, HOME, baseUrl } = cli;
      replies.push({ text: "one-shot answer" });
      await mkdir(join(HOME, ".axle"), { recursive: true });
      await writeFile(join(HOME, ".axle", "cli.yaml"), "defaults:\n  provider: chatcompletions\n");

      const { code, output } = await runCli(
        ["-m", "quick question", "--renderer", "plain", "--no-log"],
        { CHATCOMPLETIONS_BASE_URL: baseUrl, CHATCOMPLETIONS_MODEL: "stub-model" },
      );

      expect(code).toBe(0);
      expect(output).toContain("one-shot answer");
      expect(requests).toHaveLength(1);
      expect(requests[0].messages.at(-1)?.content).toContain("quick question");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "preserves equals signs in recipe arguments",
    async ({ cli }) => {
      const { replies, requests, runCli, CWD, baseUrl } = cli;
      replies.push({ text: "argument received" });
      const recipe = join(CWD, "args.yml");
      await writeFile(
        recipe,
        [
          "provider:",
          "  type: chatcompletions",
          `  baseUrl: ${baseUrl}`,
          "model: stub-model",
          "task: Use {{token}}",
        ].join("\n"),
      );

      const { code } = await runCli([
        "-j",
        recipe,
        "--args",
        "token=a=b=c",
        "--renderer",
        "plain",
        "--no-log",
      ]);

      expect(code).toBe(0);
      expect(JSON.stringify(requests[0].messages.at(-1)?.content)).toContain("a=b=c");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "piped chat reads a line at the prompt, answers, and exits cleanly at EOF",
    async ({ cli }) => {
      const { replies, requests, runCli, HOME, baseUrl } = cli;
      replies.push({ text: "chat answer" });
      await mkdir(join(HOME, ".axle"), { recursive: true });
      await writeFile(join(HOME, ".axle", "cli.yaml"), "defaults:\n  provider: chatcompletions\n");

      const { code, output } = await runCli(
        ["--renderer", "plain", "--no-log"],
        { CHATCOMPLETIONS_BASE_URL: baseUrl, CHATCOMPLETIONS_MODEL: "stub-model" },
        "hello from the pipe\n",
      );

      expect(code).toBe(0);
      expect(output).toContain("chat answer");
      expect(output).toContain("Done in");
      expect(requests).toHaveLength(1);
      expect(requests[0].messages.at(-1)?.content).toContain("hello from the pipe");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "resume re-enters a saved run and sends the prior conversation to the model",
    async ({ cli }) => {
      const { replies, requests, runCli, writeRecipe } = cli;
      replies.push({ text: "first answer" }, { text: "second answer" });
      const recipe = await writeRecipe("job.yml");

      const first = await runCli(["-j", recipe, "--renderer", "plain", "--no-log"]);
      const sessionId = first.output.match(/axle resume (\S+)/)?.[1];
      expect(sessionId).toBeTruthy();

      const { code, output } = await runCli([
        "resume",
        sessionId!,
        "-m",
        "follow up",
        "--renderer",
        "plain",
        "--no-log",
      ]);

      expect(code).toBe(0);
      expect(output).toContain(`Resuming session ${sessionId}`);
      expect(output).toContain("second answer");
      expect(requests).toHaveLength(2);
      expect(requests[1].messages).toHaveLength(3);
      expect(requests[1].messages.at(-1)?.content).toContain("follow up");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "batch with a mid-batch failure exits 1 and indexes both outcomes in the ledger",
    async ({ cli }) => {
      const { replies, runCli, writeRecipe, CWD } = cli;
      replies.push({ text: "processed a" }, { error: "stub exploded" });
      await mkdir(join(CWD, "inputs"), { recursive: true });
      await writeFile(join(CWD, "inputs", "a.md"), "alpha");
      await writeFile(join(CWD, "inputs", "b.md"), "beta");
      const recipe = await writeRecipe(
        "batch.yml",
        ["batch:", '  files: "inputs/*.md"', "  concurrency: 1"].join("\n"),
      );

      const { code, output } = await runCli([
        "batch",
        "-j",
        recipe,
        "--renderer",
        "plain",
        "--no-log",
      ]);

      expect(code).toBe(1);
      expect(output).toContain("1 completed, 0 skipped, 1 failed");
      expect(output).toContain("Failed in");

      const ledgerLines = (await readFile(join(CWD, ".axle", "batch.jsonl"), "utf-8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(ledgerLines.map((e) => e.status).sort()).toEqual(["completed", "failed"]);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "resume over the compaction threshold summarizes before sending",
    async ({ cli }) => {
      const { requests, runCli, writeOverThresholdRecipe } = cli;
      const recipe = await writeOverThresholdRecipe("compacting.yml");

      const first = await runCli(["-j", recipe, "--renderer", "plain", "--no-log"], {
        AXLE_CONTEXT_WINDOW: "1000",
      });
      const sessionId = first.output.match(/axle resume (\S+)/)?.[1];

      const { code } = await runCli(
        ["resume", sessionId!, "-m", "follow up", "--renderer", "plain", "--no-log"],
        { AXLE_CONTEXT_WINDOW: "1000" },
      );

      expect(code).toBe(0);
      expect(requests).toHaveLength(3);
      expect(JSON.stringify(requests[1].messages)).not.toContain("follow up");
      expect(JSON.stringify(requests[2].messages.at(-1))).toContain("follow up");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "compaction: false survives resume — no summarization request over the threshold",
    async ({ cli }) => {
      const { requests, runCli, writeOverThresholdRecipe, HOME } = cli;
      const recipe = await writeOverThresholdRecipe("optout.yml", "compaction: false");

      const first = await runCli(["-j", recipe, "--renderer", "plain", "--no-log"], {
        AXLE_CONTEXT_WINDOW: "1000",
      });
      const sessionId = first.output.match(/axle resume (\S+)/)?.[1];
      const saved = JSON.parse(
        await readFile(join(HOME, ".axle", "sessions", "cli", `${sessionId}.json`), "utf-8"),
      );
      expect(saved.compaction).toBe(false);

      const { code } = await runCli(
        ["resume", sessionId!, "-m", "follow up", "--renderer", "plain", "--no-log"],
        { AXLE_CONTEXT_WINDOW: "1000" },
      );

      expect(code).toBe(0);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[1].messages.at(-1))).toContain("follow up");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "same-named recipe files in different directories get distinct ledger scopes",
    async ({ cli }) => {
      const { runCli, writeRecipe, CWD } = cli;
      await mkdir(join(CWD, "inputs"), { recursive: true });
      await mkdir(join(CWD, "jobs", "first"), { recursive: true });
      await mkdir(join(CWD, "jobs", "second"), { recursive: true });
      await writeFile(join(CWD, "inputs", "a.md"), "alpha");
      await writeFile(join(CWD, "inputs", "b.md"), "beta");
      const batchBlock = ["batch:", '  files: "inputs/*.md"', "  concurrency: 1"].join("\n");
      const recipeA = await writeRecipe("jobs/first/process.yml", batchBlock);
      const recipeB = await writeRecipe("jobs/second/process.yml", batchBlock);

      await runCli(["batch", "-j", recipeA, "--renderer", "plain", "--no-log"]);
      const rerun = await runCli([
        "batch",
        "-j",
        recipeA,
        "--incremental",
        "--renderer",
        "plain",
        "--no-log",
      ]);
      const other = await runCli([
        "batch",
        "-j",
        recipeB,
        "--incremental",
        "--renderer",
        "plain",
        "--no-log",
      ]);

      expect(rerun.output).toContain("0 completed, 2 skipped, 0 failed");
      expect(other.output).toContain("2 completed, 0 skipped, 0 failed");
    },
    SPAWN_TIMEOUT,
  );

  it(
    "rejects --message combined with --job before running anything",
    async ({ cli }) => {
      const { requests, runCli } = cli;
      const { code, output } = await runCli(["-j", "whatever.yml", "-m", "hi"]);

      expect(code).toBe(1);
      expect(output).toContain("--message cannot be combined with --job");
      expect(requests).toHaveLength(0);
    },
    SPAWN_TIMEOUT,
  );
});

describe.concurrent("schedules end-to-end", () => {
  const plain = ["--renderer", "plain", "--no-log"];

  it(
    "axle schedule -j registers a LaunchAgent, runs once, and updates only when something changed",
    async ({ cli, schedule }) => {
      const { replies, requests, runCli, writeRecipe, CWD } = cli;
      const { scheduleEnv, launchctlCalls, runsOf, records, LAUNCH_AGENTS, SCHEDULES } = schedule;
      replies.push({ text: "first" }, { text: "second" }, { text: "third" });
      const recipe = await writeRecipe(
        "monitor.yml",
        "name: hourly-monitor\nschedule:\n  every: 1h",
      );

      const first = await runCli(["schedule", "-j", recipe, ...plain], scheduleEnv());

      expect(first.code).toBe(0);
      expect(first.output).toContain("Scheduled hourly-monitor every 1h");
      expect(first.output).toContain("Next firing in 1h.");
      expect(first.output).toContain("first");
      expect(requests).toHaveLength(1);
      const [{ id, record }] = await records();
      expect(record.desired).toMatchObject({
        name: "hourly-monitor",
        recipePath: recipe,
        cwd: CWD,
        trigger: { kind: "interval", seconds: 3600 },
      });
      expect(record.desired.programArguments.slice(-7)).toEqual([
        "-j",
        recipe,
        "--renderer",
        "plain",
        "--no-log",
        "--scheduled",
        id,
      ]);
      expect(record.desired.programArguments[0]).toBe(process.execPath);
      expect(record.binding).toEqual({
        kind: "launchd",
        label: `com.fifthrevision.axle.${id}`,
        plistPath: join(LAUNCH_AGENTS, `com.fifthrevision.axle.${id}.plist`),
      });
      expect((await stat(join(SCHEDULES, `${id}.json`))).mode & 0o777).toBe(0o600);
      const plist = await readFile(record.binding.plistPath, "utf-8");
      expect(plist).toContain("<integer>3600</integer>");
      expect(plist).toContain(`<string>${CWD}</string>`);
      expect(await launchctlCalls()).toEqual([
        `bootout gui/${process.getuid!()}/com.fifthrevision.axle.${id}`,
        `bootstrap gui/${process.getuid!()} ${record.binding.plistPath}`,
      ]);
      const firstSession = first.output.match(/axle resume (\S+)/)?.[1];
      expect((await runsOf(id))[0]).toMatchObject({
        status: "succeeded",
        sessionIds: [firstSession],
      });

      const again = await runCli(["schedule", "-j", recipe, ...plain], scheduleEnv());
      expect(again.code).toBe(0);
      expect(again.output).toContain("Schedule hourly-monitor is current: every 1h");
      expect(await launchctlCalls()).toHaveLength(2);
      expect(requests).toHaveLength(2);

      await writeRecipe("monitor.yml", "name: hourly-monitor\nschedule:\n  every: 15m");
      const changed = await runCli(["schedule", "-j", recipe, ...plain], scheduleEnv());
      expect(changed.code).toBe(0);
      expect(changed.output).toContain("Updated schedule hourly-monitor: every 1h → every 15m.");
      expect(await launchctlCalls()).toHaveLength(5);
      expect((await records())[0].record.desired.trigger).toEqual({
        kind: "interval",
        seconds: 900,
      });
      expect(await readdir(LAUNCH_AGENTS)).toHaveLength(1);
      expect(await runsOf(id)).toHaveLength(3);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "plain axle -j never touches the scheduler and reports the schedule's state",
    async ({ cli, schedule }) => {
      const { replies, requests, runCli, writeRecipe } = cli;
      const { scheduleEnv, launchctlCalls, runsOf, records } = schedule;
      replies.push({ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }, { text: "e" });
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");

      const unregistered = await runCli(["-j", recipe, ...plain], scheduleEnv());
      expect(unregistered.code).toBe(0);
      expect(unregistered.output).toContain(
        `Declares a schedule (every 1h), not registered. Register and run with: axle schedule -j ${recipe}`,
      );
      expect(await records()).toEqual([]);

      const elsewhere = await runCli(["-j", recipe, ...plain], scheduleEnv("linux"));
      expect(elsewhere.code).toBe(0);
      expect(elsewhere.output).toContain("schedules are not supported on linux yet");

      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id }] = await records();
      const mutations = (await launchctlCalls()).length;

      const current = await runCli(["-j", recipe, ...plain], scheduleEnv());
      expect(current.output).toContain("Scheduled every 1h, never run");
      expect(await runsOf(id)).toEqual([]);

      await writeRecipe("monitor.yml", "schedule:\n  every: 15m");
      const drifted = await runCli(["-j", recipe, ...plain], scheduleEnv());
      expect(drifted.output).toContain(
        `⚠ Registered every 1h, but the recipe now says every 15m. Re-apply with: axle schedule register -j ${recipe}`,
      );

      await writeRecipe("monitor.yml");
      const orphaned = await runCli(["-j", recipe, ...plain], scheduleEnv());
      expect(orphaned.code).toBe(0);
      expect(orphaned.output).toContain(
        `⚠ Registered every 1h, but the recipe no longer declares a schedule. Remove with: axle schedule remove -j ${recipe}`,
      );

      expect(await launchctlCalls()).toHaveLength(mutations);
      expect((await records())[0].record.desired.trigger).toEqual({
        kind: "interval",
        seconds: 3600,
      });
      expect(requests).toHaveLength(5);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "an unsupported platform fails before running and points at a plain run",
    async ({ cli, schedule }) => {
      const { requests, runCli, writeRecipe } = cli;
      const { scheduleEnv, records } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");

      const { code, output } = await runCli(
        ["schedule", "-j", recipe, ...plain],
        scheduleEnv("linux"),
      );

      expect(code).toBe(1);
      expect(output).toContain("not supported on linux");
      expect(output).toContain("axle -j");
      expect(requests).toHaveLength(0);
      expect(await records()).toEqual([]);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "schedule register registers without running; without a block both forms refuse",
    async ({ cli, schedule }) => {
      const { requests, runCli, writeRecipe } = cli;
      const { scheduleEnv, launchctlCalls, runsOf, records } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 2d");

      const applied = await runCli(["schedule", "register", "-j", recipe], scheduleEnv());

      expect(applied.code).toBe(0);
      expect(applied.output).toContain("Scheduled monitor every 2d");
      expect(requests).toHaveLength(0);
      expect(await records()).toHaveLength(1);
      expect(await launchctlCalls()).toHaveLength(2);
      expect(await runsOf((await records())[0].id)).toEqual([]);

      const bare = await writeRecipe("bare.yml");
      for (const args of [
        ["schedule", "register", "-j", bare],
        ["schedule", "-j", bare, ...plain],
      ]) {
        const refused = await runCli(args, scheduleEnv());
        expect(refused.code).toBe(1);
        expect(refused.output).toContain("has no schedule block");
      }
      expect(await readFile(bare, "utf-8")).not.toContain("schedule");
      expect(await records()).toHaveLength(1);
      expect(requests).toHaveLength(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "a malformed schedule block fails recipe validation before any registration",
    async ({ cli, schedule }) => {
      const { runCli, writeRecipe } = cli;
      const { scheduleEnv, launchctlCalls } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 30s");

      const { code, output } = await runCli(["schedule", "register", "-j", recipe], scheduleEnv());

      expect(code).toBe(1);
      expect(output).toContain("The job file is not valid");
      expect(await launchctlCalls()).toEqual([]);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "a calendar recipe registers StartCalendarInterval entries and diffs against an interval",
    async ({ cli, schedule }) => {
      const { requests, runCli, writeRecipe } = cli;
      const { scheduleEnv, records } = schedule;
      const recipe = await writeRecipe(
        "digest.yml",
        "name: digest\nschedule:\n  at: ['09:00', '17:30']\n  on: [mon, fri]",
      );

      const applied = await runCli(["schedule", "register", "-j", recipe], scheduleEnv());

      expect(applied.code).toBe(0);
      expect(applied.output).toMatch(
        /Scheduled digest at 09:00, 17:30 on mon,fri\. Next firing (Mon|Fri) (09:00|17:30)\./,
      );
      const [{ record }] = await records();
      expect(record.desired.trigger).toEqual({
        kind: "calendar",
        times: [
          { hour: 9, minute: 0 },
          { hour: 17, minute: 30 },
        ],
        weekdays: [1, 5],
      });
      const plist = await readFile(record.binding.plistPath, "utf-8");
      expect(plist).toContain("<key>StartCalendarInterval</key>");
      expect(plist).not.toContain("StartInterval</key>");
      expect(plist.match(/<key>Weekday<\/key>/g)).toHaveLength(4);

      const listed = await runCli(["schedule", "list"], scheduleEnv());
      expect(listed.output).toMatch(/digest {2}at 09:00, 17:30 on mon,fri {2}launchd/);

      await writeRecipe("digest.yml", "name: digest\nschedule:\n  every: 1d");
      const state = await runCli(["-j", recipe, ...plain], scheduleEnv());
      expect(state.output).toContain(
        "⚠ Registered at 09:00, 17:30 on mon,fri, but the recipe now says every 1d.",
      );
      const changed = await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      expect(changed.output).toContain(
        "Updated schedule digest: at 09:00, 17:30 on mon,fri → every 1d. Next firing in 1d.",
      );
      expect(requests).toHaveLength(1);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "remove still unloads a schedule whose record is corrupt",
    async ({ cli, schedule }) => {
      const { runCli, writeRecipe } = cli;
      const { scheduleEnv, launchctlCalls, records, SCHEDULES } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id, record }] = await records();
      await writeFile(join(SCHEDULES, `${id}.json`), "{corrupt");
      const callsBefore = (await launchctlCalls()).length;

      const removed = await runCli(["schedule", "remove", "-j", recipe], scheduleEnv());

      expect(removed.code).toBe(0);
      expect(removed.output).toContain("Removed schedule");
      expect((await launchctlCalls()).slice(callsBefore)).toEqual([
        `bootout gui/${process.getuid!()}/com.fifthrevision.axle.${id}`,
      ]);
      await expect(stat(record.binding.plistPath)).rejects.toThrow(/ENOENT/);
      await expect(stat(join(SCHEDULES, `${id}.json`))).rejects.toThrow(/ENOENT/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "an occurrence that fails before running still records a failed run",
    async ({ cli, schedule }) => {
      const { requests, runCli, writeRecipe } = cli;
      const { scheduleEnv, runsOf, records, runOccurrence } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id, record }] = await records();
      await writeFile(recipe, "task: [unclosed\n");

      const fired = await runOccurrence(record.desired.programArguments);

      expect(fired.code).toBe(1);
      expect(await runsOf(id)).toMatchObject([{ status: "failed", sessionIds: [] }]);
      const listed = await runCli(["schedule", "list"], scheduleEnv());
      expect(listed.output).toContain("last run ✖");
      expect(requests).toHaveLength(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "a plain run still runs when the schedule's history file is unreadable",
    async ({ cli, schedule }) => {
      const { replies, runCli, writeRecipe } = cli;
      const { scheduleEnv, records, SCHEDULES } = schedule;
      replies.push({ text: "ran anyway" });
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id }] = await records();
      await mkdir(join(SCHEDULES, `${id}.runs.jsonl`));

      const { code, output } = await runCli(["-j", recipe, ...plain], scheduleEnv());

      expect(code).toBe(0);
      expect(output).toContain("ran anyway");
      expect(output).toMatch(/^⚠ .*(unreadable|EISDIR)/m);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "management output survives a pipe when it exceeds the pipe buffer",
    async ({ cli, schedule }) => {
      const { runCli, runCliWithSlowReader, writeRecipe } = cli;
      const { scheduleEnv, records, SCHEDULES } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id }] = await records();
      const line = JSON.stringify({
        startedAt: "2026-09-18T00:00:00.000Z",
        finishedAt: "2026-09-18T00:00:01.000Z",
        status: "succeeded",
        sessionIds: ["0123456789abcdef-0123-4567-89ab-cdef01234567"],
      });
      await writeFile(
        join(SCHEDULES, `${id}.runs.jsonl`),
        Array(4000).fill(line).join("\n") + "\n",
      );

      const { code, output } = await runCliWithSlowReader(
        ["schedule", "sessions", "-j", recipe],
        scheduleEnv(),
      );

      expect(code).toBe(0);
      expect(output.trim().split("\n")).toHaveLength(4000);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "rejects a malformed --scheduled marker and an unknown platform override",
    async ({ cli, schedule }) => {
      const { requests, runCli, writeRecipe, HOME } = cli;
      const { scheduleEnv, records } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");

      const traversal = await runCli(
        ["-j", recipe, "--scheduled", "../../escape", ...plain],
        scheduleEnv(),
      );
      expect(traversal.code).not.toBe(0);
      expect(traversal.output).toContain("--scheduled");
      await expect(stat(join(HOME, ".axle", "escape.runs.jsonl"))).rejects.toThrow(/ENOENT/);
      await expect(stat(join(HOME, "escape.runs.jsonl"))).rejects.toThrow(/ENOENT/);
      expect(requests).toHaveLength(0);

      const platform = await runCli(["schedule", "register", "-j", recipe], scheduleEnv("windows"));
      expect(platform.code).toBe(1);
      expect(platform.output).toContain("AXLE_SCHEDULE_PLATFORM");
      expect(await records()).toEqual([]);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "register restores a registration whose LaunchAgent went missing, and list flags it first",
    async ({ cli, schedule }) => {
      const { runCli, writeRecipe } = cli;
      const { scheduleEnv, records } = schedule;
      const recipe = await writeRecipe("monitor.yml", "schedule:\n  every: 1h");
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ record }] = await records();
      await rm(record.binding.plistPath);

      const listed = await runCli(["schedule", "list"], scheduleEnv());
      expect(listed.output).toContain("⚠ not loaded in launchd");

      const restored = await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      expect(restored.code).toBe(0);
      expect(restored.output).toContain("Restored schedule monitor every 1h");
      await stat(record.binding.plistPath);
      expect((await runCli(["schedule", "list"], scheduleEnv())).output).not.toContain(
        "not loaded",
      );
    },
    SPAWN_TIMEOUT,
  );

  it(
    "the generated occurrence bypasses reconciliation, saves a session, and is listed under sessions",
    async ({ cli, schedule }) => {
      const { replies, requests, runCli, writeRecipe, HOME } = cli;
      const { scheduleEnv, launchctlCalls, records, runOccurrence } = schedule;
      replies.push({ text: "fired" }, { error: "provider down" });
      const recipe = await writeRecipe(
        "monitor.yml",
        "name: hourly-monitor\nschedule:\n  every: 1h",
      );
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id, record }] = await records();
      const callsBefore = (await launchctlCalls()).length;
      await writeRecipe("monitor.yml", "name: hourly-monitor\nschedule:\n  every: 15m");

      const fired = await runOccurrence(record.desired.programArguments);

      expect(fired.code).toBe(0);
      expect(fired.output).toContain("fired");
      expect(fired.output).not.toMatch(/Scheduled|Updated schedule|is current/);
      expect(await launchctlCalls()).toHaveLength(callsBefore);
      expect((await records())[0].record.desired.trigger).toEqual({
        kind: "interval",
        seconds: 3600,
      });
      const sessionId = fired.output.match(/axle resume (\S+)/)?.[1];
      expect(sessionId).toBeTruthy();
      await stat(join(HOME, ".axle", "sessions", "cli", `${sessionId}.json`));

      const failed = await runOccurrence(record.desired.programArguments);
      expect(failed.code).toBe(1);

      const sessions = await runCli(["schedule", "sessions", "-j", recipe], scheduleEnv());
      expect(sessions.code).toBe(0);
      const lines = sessions.output.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^✖ /);
      expect(lines[1]).toMatch(/^✔ .*axle resume /);
      expect(lines[1]).toContain(`axle resume ${sessionId!.slice(0, 8)}`);
      expect(sessions.output).not.toContain(id);

      const bare = await runCli(["schedule", "sessions"], scheduleEnv());
      expect(bare.code).not.toBe(0);
      expect(bare.output).toContain("required option '-j, --job <path>' not specified");
      expect(requests).toHaveLength(2);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "a scheduled batch occurrence records one session per input",
    async ({ cli, schedule }) => {
      const { replies, runCli, writeRecipe, CWD } = cli;
      const { scheduleEnv, records, runOccurrence, SCHEDULES } = schedule;
      replies.push({ text: "a done" }, { text: "b done" });
      await mkdir(join(CWD, "inputs"), { recursive: true });
      await writeFile(join(CWD, "inputs", "a.md"), "alpha");
      await writeFile(join(CWD, "inputs", "b.md"), "beta");
      const recipe = await writeRecipe(
        "batch.yml",
        ["batch:", '  files: "inputs/*.md"', "  concurrency: 1", "schedule:", "  every: 1h"].join(
          "\n",
        ),
      );
      await runCli(["schedule", "register", "-j", recipe], scheduleEnv());
      const [{ id, record }] = await records();

      const fired = await runOccurrence(record.desired.programArguments);

      expect(fired.code).toBe(0);
      expect(fired.output).toContain("2 completed, 0 skipped, 0 failed");
      const runs = (await readFile(join(SCHEDULES, `${id}.runs.jsonl`), "utf-8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("succeeded");
      expect(runs[0].sessionIds).toHaveLength(2);
      const ledger = (await readFile(join(CWD, ".axle", "batch.jsonl"), "utf-8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).sessionId);
      expect([...runs[0].sessionIds].sort()).toEqual([...ledger].sort());
    },
    SPAWN_TIMEOUT,
  );

  it(
    "list shows registrations and remove deletes only the schedule's own artifacts",
    async ({ cli, schedule }) => {
      const { replies, requests, runCli, writeRecipe, HOME } = cli;
      const { scheduleEnv, launchctlCalls, records, LAUNCH_AGENTS, SCHEDULES } = schedule;
      replies.push({ text: "ran" });
      const monitor = await writeRecipe(
        "monitor.yml",
        "name: hourly-monitor\nschedule:\n  every: 1h",
      );
      const digest = await writeRecipe("digest.yml", "name: daily-digest\nschedule:\n  every: 1d");
      await runCli(["schedule", "-j", monitor, ...plain], scheduleEnv());
      await runCli(["schedule", "register", "-j", digest], scheduleEnv());
      await writeFile(join(LAUNCH_AGENTS, "com.example.other.plist"), "<plist/>");
      await mkdir(SCHEDULES, { recursive: true });
      await writeFile(join(SCHEDULES, "broken.json"), "{nope");
      const sessionsBefore = await readdir(join(HOME, ".axle", "sessions", "cli"));
      expect(sessionsBefore).toHaveLength(1);

      const listed = await runCli(["schedule", "list"], scheduleEnv());

      expect(listed.code).toBe(0);
      expect(listed.output).toMatch(/hourly-monitor {2}every 1h {2}launchd {2}last run ✔/);
      expect(listed.output).toMatch(/daily-digest {2}every 1d {2}launchd {2}never run/);
      expect(listed.output).toContain(monitor);
      expect(listed.output).toContain("⚠ broken.json  skipped: corrupt record");
      expect(requests).toHaveLength(1);

      const monitorId = (await records()).find(
        (r) => r.record.desired.name === "hourly-monitor",
      )!.id;
      expect(listed.output).not.toContain(monitorId);
      const callsBefore = (await launchctlCalls()).length;
      const removed = await runCli(["schedule", "remove", "-j", monitor], scheduleEnv());

      expect(removed.code).toBe(0);
      expect(removed.output).toContain("Removed schedule hourly-monitor");
      expect((await launchctlCalls()).slice(callsBefore)).toEqual([
        `bootout gui/${process.getuid!()}/com.fifthrevision.axle.${monitorId}`,
      ]);
      expect((await readdir(LAUNCH_AGENTS)).sort()).toEqual([
        "com.example.other.plist",
        `com.fifthrevision.axle.${(await records())[0].id}.plist`,
      ]);
      expect((await records()).map((r) => r.record.desired.name)).toEqual(["daily-digest"]);
      await stat(monitor);
      expect(await readdir(join(HOME, ".axle", "sessions", "cli"))).toEqual(sessionsBefore);

      const gone = await runCli(["schedule", "remove", "-j", monitor], scheduleEnv());
      expect(gone.code).toBe(1);
      expect(gone.output).toContain(`${monitor} is not scheduled. See: axle schedule list`);

      const history = await runCli(["schedule", "sessions", "-j", monitor], scheduleEnv());
      expect(history.code).toBe(0);
      expect(history.output).toMatch(/^✔ .*axle resume /);

      await rm(digest);
      const moved = await runCli(["schedule", "remove", "-j", digest], scheduleEnv());
      expect(moved.code).toBe(0);
      expect(moved.output).toContain("Removed schedule daily-digest");
      expect(await records()).toEqual([]);
      expect(await readdir(LAUNCH_AGENTS)).toEqual(["com.example.other.plist"]);
      const none = await runCli(["schedule", "sessions", "-j", digest], scheduleEnv());
      expect(none.code).toBe(0);
      expect(none.output).toContain(`No runs recorded for ${digest}.`);
    },
    SPAWN_TIMEOUT,
  );
});
