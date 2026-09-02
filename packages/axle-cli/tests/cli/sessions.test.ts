import type { AgentConfig, AgentDefinition, AIProvider } from "@fifthrevision/axle";
import { AxleStopReason, createStats, Tracer } from "@fifthrevision/axle";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSingle } from "../../src/cli/runners.js";
import type { CliSessionFile } from "../../src/cli/sessions.js";
import { sessionFilePath, SessionStore } from "../../src/cli/sessions.js";

const TEST_DIR = join(import.meta.dirname, "__sessions_tmp__");
const HOME = join(TEST_DIR, "home");

const definition: AgentDefinition = {
  version: 1,
  name: "test-job",
  provider: { type: "anthropic" },
  model: "anthropic/test-model",
};

function createMockProvider(text: string): AIProvider {
  let callIndex = 0;
  return {
    name: "mock",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest() {
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

    const succeeded = await runSingle(
      { task: "Say hi" },
      agentConfig,
      {},
      {},
      createStats(),
      span,
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

  it("does not write anything without a session store", async () => {
    const agentConfig: AgentConfig = {
      provider: createMockProvider("hello"),
      model: "test-model",
    };
    const tracer = new Tracer();
    const span = tracer.startSpan("test");

    const succeeded = await runSingle({ task: "Say hi" }, agentConfig, {}, {}, createStats(), span);

    expect(succeeded).toBe(true);
    await expect(readdir(join(HOME, ".axle"))).rejects.toThrow();
  });
});
