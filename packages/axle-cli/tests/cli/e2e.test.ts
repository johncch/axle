import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PKG_ROOT = join(import.meta.dirname, "..", "..");
const TSX_BIN = join(PKG_ROOT, "node_modules", ".bin", "tsx");
const CLI_PATH = join(PKG_ROOT, "src", "cli.ts");
const TEST_DIR = join(import.meta.dirname, "__e2e_tmp__");
const HOME = join(TEST_DIR, "home");
const CWD = join(TEST_DIR, "cwd");

const SPAWN_TIMEOUT = 30_000;

type StubReply = { text: string } | { error: string };

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
}

let server: Server;
let baseUrl: string;
let replies: StubReply[];
let requests: ChatRequest[];

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

beforeEach(async () => {
  await mkdir(HOME, { recursive: true });
  await mkdir(CWD, { recursive: true });

  replies = [];
  requests = [];
  server = createServer((req, res) => {
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
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(TEST_DIR, { recursive: true, force: true });
});

function runCli(
  args: string[],
  env: Record<string, string> = {},
  stdin = "",
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX_BIN, [CLI_PATH, ...args], {
      cwd: CWD,
      env: { PATH: process.env.PATH!, HOME, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(stdin);
  });
}

async function writeRecipe(name: string, extra = ""): Promise<string> {
  const path = join(CWD, name);
  await writeFile(
    path,
    [
      "provider:",
      "  type: chatcompletions",
      `  baseUrl: ${baseUrl}`,
      "model: stub-model",
      "task: |",
      "  Say hello.",
      extra,
    ].join("\n"),
  );
  return path;
}

// With AXLE_CONTEXT_WINDOW=1000 the compaction threshold is 800 tokens
// (~2400 chars); this task alone crosses it, so a resumed session is over
// the threshold before its next send.
async function writeOverThresholdRecipe(name: string, extra = ""): Promise<string> {
  const path = join(CWD, name);
  await writeFile(
    path,
    [
      "provider:",
      "  type: chatcompletions",
      `  baseUrl: ${baseUrl}`,
      "model: stub-model",
      extra,
      "task: |",
      `  Analyze this. ${"filler words here ".repeat(200)}`,
    ].join("\n"),
  );
  return path;
}

describe("cli.ts end-to-end", () => {
  it(
    "runs a recipe: exit 0, response on stdout, session file written",
    async () => {
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
    async () => {
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
    async () => {
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
    "piped chat reads a line at the prompt, answers, and exits cleanly at EOF",
    async () => {
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
    async () => {
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
    async () => {
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
    async () => {
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
    async () => {
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
    "unnamed recipes get distinct ledger scopes: --incremental never cross-skips",
    async () => {
      await mkdir(join(CWD, "inputs"), { recursive: true });
      await writeFile(join(CWD, "inputs", "a.md"), "alpha");
      await writeFile(join(CWD, "inputs", "b.md"), "beta");
      const batchBlock = ["batch:", '  files: "inputs/*.md"', "  concurrency: 1"].join("\n");
      const recipeA = await writeRecipe("first.yml", batchBlock);
      const recipeB = await writeRecipe("second.yml", batchBlock);

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
    async () => {
      const { code, output } = await runCli(["-j", "whatever.yml", "-m", "hi"]);

      expect(code).toBe(1);
      expect(output).toContain("--message cannot be combined with --job");
      expect(requests).toHaveLength(0);
    },
    SPAWN_TIMEOUT,
  );
});
