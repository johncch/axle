import type { AgentConfig, AgentDefinition, AIProvider } from "@fifthrevision/axle";
import { AxleStopReason, createStats, Tracer } from "@fifthrevision/axle";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentSession } from "../../src/cli/runners.js";
import type { CliSessionFile } from "../../src/cli/sessions.js";
import {
  listSessionSummaries,
  loadSession,
  sessionFilePath,
  SessionStore,
} from "../../src/cli/sessions.js";
import type { Renderer } from "../../src/ui/index.js";

const nullRenderer: Renderer = {
  renderPriorTurns() {},
  onEvent() {},
  info() {},
  success() {},
  warn() {},
  error() {},
  promptInput: () => Promise.resolve(null),
  updateUsage() {},
  setInterruptHandler() {},
  close() {},
};

const TEST_DIR = join(import.meta.dirname, "__sessions_tmp__");
const HOME = join(TEST_DIR, "home");

const definition: AgentDefinition = {
  version: 1,
  name: "test-job",
  provider: { type: "anthropic" },
  model: "anthropic/test-model",
};

function createMockProvider(text: string, requestMessages?: unknown[][]): AIProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(_model, params) {
      requestMessages?.push([...(params as { messages: unknown[] }).messages]);
      callIndex += 1;
      yield {
        type: "start" as const,
        id: `mock-${callIndex}`,
        data: { model: "mock", timestamp: 0 },
      };
      yield { type: "text-start" as const, data: { index: 0 } };
      yield { type: "text-delta" as const, data: { index: 0, text } };
      yield { type: "text-complete" as const, data: { index: 0 } };
      yield {
        type: "complete" as const,
        data: { finishReason: AxleStopReason.Stop, usage: { in: 10, out: 20 } },
      };
    },
  };
}

async function readSessionFile(sessionId: string): Promise<CliSessionFile> {
  const content = await readFile(sessionFilePath(sessionId, HOME), "utf-8");
  return JSON.parse(content);
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("SessionStore", () => {
  it("writes the full session file shape", async () => {
    const store = new SessionStore(definition, { cwd: "/some/project", home: HOME });
    const session = { sessionId: "abc-123", messages: [] };

    const path = await store.save(session, []);

    expect(path).toBe(sessionFilePath("abc-123", HOME));
    const file = await readSessionFile("abc-123");
    expect(file.version).toBe(1);
    expect(file.cwd).toBe("/some/project");
    expect(file.definition).toEqual(definition);
    expect(file.session).toEqual(session);
    expect(file.turns).toEqual([]);
    expect(file.createdAt).toBeTruthy();
    expect(file.updatedAt).toBeTruthy();
  });

  it("keeps createdAt stable across saves", async () => {
    const store = new SessionStore(definition, { home: HOME });
    const session = { sessionId: "abc-123", messages: [] };

    await store.save(session, []);
    const first = await readSessionFile("abc-123");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.save(session, []);
    const second = await readSessionFile("abc-123");

    expect(second.createdAt).toBe(first.createdAt);
    expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
  });

  it("leaves no temp files behind", async () => {
    const store = new SessionStore(definition, { home: HOME });

    await store.save({ sessionId: "abc-123", messages: [] }, []);

    const entries = await readdir(join(HOME, ".axle", "sessions", "cli"));
    expect(entries).toEqual(["abc-123.json"]);
  });
});

describe("listSessionSummaries", () => {
  it("returns an empty list when the directory does not exist", async () => {
    expect(await listSessionSummaries(HOME)).toEqual([]);
  });

  it("summarizes sessions newest-first and flags corrupt files", async () => {
    const store = new SessionStore(definition, { cwd: "/proj", home: HOME });
    await store.save({ sessionId: "older", messages: [] }, [
      {
        id: "u1",
        owner: "user",
        status: "complete",
        parts: [{ id: "p1", type: "text", text: "first question here\nsecond line" }],
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await new SessionStore(definition, { home: HOME }).save(
      { sessionId: "newer", messages: [] },
      [],
    );
    await writeFile(sessionFilePath("broken", HOME), "not json");

    const summaries = await listSessionSummaries(HOME);

    expect(summaries.map((s) => s.sessionId)).toEqual(["newer", "older", "broken"]);
    const older = summaries.find((s) => s.sessionId === "older")!;
    expect(older.firstMessage).toBe("first question here");
    expect(older.model).toBe("anthropic/test-model");
    expect(older.cwd).toBe("/proj");
    expect(older.corrupt).toBe(false);
    expect(summaries.find((s) => s.sessionId === "broken")!.corrupt).toBe(true);
  });
});

describe("loadSession", () => {
  it("rejects an unknown session id", async () => {
    await expect(loadSession("missing", HOME)).rejects.toThrow("No session found with id missing");
  });

  it("rejects a corrupt session file", async () => {
    await mkdir(join(HOME, ".axle", "sessions", "cli"), { recursive: true });
    await writeFile(sessionFilePath("broken", HOME), "not json");

    await expect(loadSession("broken", HOME)).rejects.toThrow(/Invalid session file at/);
  });

  it("rejects an unsupported session version", async () => {
    await mkdir(join(HOME, ".axle", "sessions", "cli"), { recursive: true });
    await writeFile(sessionFilePath("future", HOME), JSON.stringify({ version: 99 }));

    await expect(loadSession("future", HOME)).rejects.toThrow(/Unsupported or corrupt/);
  });
});

describe("runSingle session persistence", () => {
  it("persists definition, messages, and turns after a run", async () => {
    const agentConfig: AgentConfig = {
      provider: createMockProvider("hello there"),
      model: "test-model",
      sessionId: "run-1",
    };
    const store = new SessionStore(definition, { cwd: "/job/dir", home: HOME });
    const tracer = new Tracer();
    const span = tracer.startSpan("test");

    const succeeded = await runAgentSession(
      { agentConfig, spanName: "job", initial: "Say hi", interactive: false },
      createStats(),
      span,
      nullRenderer,
      store,
    );

    expect(succeeded).toBe(true);
    const file = await readSessionFile("run-1");
    expect(file.definition).toEqual(definition);
    expect(file.cwd).toBe("/job/dir");
    expect(file.session.sessionId).toBe("run-1");
    expect(file.session.messages).toHaveLength(2);
    expect(file.session.messages[0].role).toBe("user");
    expect(file.turns.length).toBeGreaterThanOrEqual(2);
  });

  it("resumes a saved session: prior messages reach the model and the file grows", async () => {
    const firstConfig: AgentConfig = {
      provider: createMockProvider("first response"),
      model: "test-model",
      sessionId: "resume-1",
    };
    const store = new SessionStore(definition, { cwd: "/original/dir", home: HOME });
    const tracer = new Tracer();

    await runAgentSession(
      { agentConfig: firstConfig, spanName: "job", initial: "Say hi", interactive: false },
      createStats(),
      tracer.startSpan("first"),
      nullRenderer,
      store,
    );
    const saved = await loadSession("resume-1", HOME);

    const requestMessages: unknown[][] = [];
    const resumeConfig: AgentConfig = {
      provider: createMockProvider("second response", requestMessages),
      model: "test-model",
    };
    const resumeStore = new SessionStore(saved.definition, {
      cwd: saved.cwd,
      createdAt: saved.createdAt,
      home: HOME,
    });

    const succeeded = await runAgentSession(
      {
        agentConfig: resumeConfig,
        spanName: "resume",
        session: saved.session,
        priorTurns: saved.turns,
        resumedFromCwd: saved.cwd,
        initial: "Say more",
        interactive: false,
      },
      createStats(),
      tracer.startSpan("resume"),
      nullRenderer,
      resumeStore,
    );

    expect(succeeded).toBe(true);
    expect(requestMessages).toHaveLength(1);
    expect(requestMessages[0]).toHaveLength(3);

    const after = await readSessionFile("resume-1");
    expect(after.session.sessionId).toBe("resume-1");
    expect(after.session.messages).toHaveLength(4);
    expect(after.turns.length).toBeGreaterThan(saved.turns.length);
    expect(after.createdAt).toBe(saved.createdAt);
    expect(after.cwd).toBe("/original/dir");
  });

  it("runs the chat loop: empty input re-prompts, /quit exits", async () => {
    const inputs = ["", "  ", "hello", "/quit", "never sent"];
    const scriptedRenderer: Renderer = {
      ...nullRenderer,
      promptInput: () => Promise.resolve(inputs.shift() ?? null),
    };
    const requestMessages: unknown[][] = [];
    const agentConfig: AgentConfig = {
      provider: createMockProvider("hi", requestMessages),
      model: "test-model",
      sessionId: "chat-1",
    };
    const store = new SessionStore(definition, { home: HOME });
    const tracer = new Tracer();

    const succeeded = await runAgentSession(
      { agentConfig, spanName: "chat", interactive: true },
      createStats(),
      tracer.startSpan("chat"),
      scriptedRenderer,
      store,
    );

    expect(succeeded).toBe(true);
    expect(requestMessages).toHaveLength(1);
    expect(inputs).toEqual(["never sent"]);

    const file = await readSessionFile("chat-1");
    expect(file.session.messages).toHaveLength(2);
  });

  it("does not write anything without a session store", async () => {
    const agentConfig: AgentConfig = {
      provider: createMockProvider("hello"),
      model: "test-model",
    };
    const tracer = new Tracer();
    const span = tracer.startSpan("test");

    const succeeded = await runAgentSession(
      { agentConfig, spanName: "job", initial: "Say hi", interactive: false },
      createStats(),
      span,
      nullRenderer,
    );

    expect(succeeded).toBe(true);
    await expect(readdir(join(HOME, ".axle"))).rejects.toThrow();
  });
});
