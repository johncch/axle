import type { AgentConfig, AgentDefinition, AIProvider, ContextUsage } from "@fifthrevision/axle";
import { Agent, AxleStopReason, createStats, Tracer } from "@fifthrevision/axle";
import { ModelInfo } from "@fifthrevision/axle/models";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionCompaction, runAgentSession } from "../../src/cli/runners.js";
import type { CliSessionFile } from "../../src/cli/sessions.js";
import { sessionFilePath, SessionStore } from "../../src/cli/sessions.js";
import type { Renderer } from "../../src/ui/index.js";

interface CapturedRequest {
  reasoning?: unknown;
  maxOutputTokens?: number;
}

function createCapturingProvider(name: string, requests: CapturedRequest[]): AIProvider {
  return {
    name,
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(model, params) {
      requests.push({
        reasoning: (params as { reasoning?: unknown }).reasoning,
        maxOutputTokens: (params as { maxOutputTokens?: number }).maxOutputTokens,
      });
      yield { type: "start" as const, id: "sum-1", data: { model, timestamp: 0 } };
      yield { type: "text-start" as const, data: { index: 0 } };
      yield { type: "text-delta" as const, data: { index: 0, text: "Continuation summary." } };
      yield { type: "text-complete" as const, data: { index: 0 } };
      yield {
        type: "complete" as const,
        data: { finishReason: AxleStopReason.Stop, usage: { in: 10, out: 20 } },
      };
    },
  };
}

function usage(total: number): ContextUsage {
  return { total, system: 0, tools: 0, mcpTools: 0, providerTools: 0, messages: total };
}

function createAgent(config: Partial<AgentConfig> & Pick<AgentConfig, "provider">): Agent {
  return new Agent({ model: "test-model", ...config });
}

describe("createSessionCompaction", () => {
  it("arms only the beforeTurn trigger", () => {
    const agent = createAgent({ provider: createCapturingProvider("mock", []) });
    const config = createSessionCompaction(agent);
    expect(config.triggers).toEqual({ beforeTurn: true });
  });

  it("derives the threshold from the model's registry context window", () => {
    const registryModel = "claude-sonnet-4-5";
    const window = ModelInfo[`anthropic/${registryModel}`]?.contextWindow;
    expect(window).toBeGreaterThan(0);

    const agent = createAgent({
      provider: createCapturingProvider("anthropic", []),
      model: registryModel,
    });
    const config = createSessionCompaction(agent);

    const messages = [{ role: "user" as const, content: "hi" }];
    expect(
      config.shouldCompactOnTrigger?.(
        { messages },
        { usage: usage(window!), trigger: "beforeTurn" },
      ),
    ).toBe(true);
    expect(
      config.shouldCompactOnTrigger?.(
        { messages },
        { usage: usage(Math.floor(window! / 2)), trigger: "beforeTurn" },
      ),
    ).toBe(false);
  });

  it("assumes a 200k window for models the registry doesn't know", () => {
    const agent = createAgent({
      provider: createCapturingProvider("mock", []),
      model: "unknown-model",
    });
    const config = createSessionCompaction(agent);

    const messages = [{ role: "user" as const, content: "hi" }];
    expect(
      config.shouldCompactOnTrigger?.(
        { messages },
        { usage: usage(170_000), trigger: "beforeTurn" },
      ),
    ).toBe(true);
    expect(
      config.shouldCompactOnTrigger?.(
        { messages },
        { usage: usage(150_000), trigger: "beforeTurn" },
      ),
    ).toBe(false);
  });

  it("AXLE_CONTEXT_WINDOW overrides the resolved window", () => {
    process.env.AXLE_CONTEXT_WINDOW = "1000";
    try {
      const agent = createAgent({
        provider: createCapturingProvider("anthropic", []),
        model: "claude-sonnet-4-5",
      });
      const config = createSessionCompaction(agent);

      const messages = [{ role: "user" as const, content: "hi" }];
      expect(
        config.shouldCompactOnTrigger?.({ messages }, { usage: usage(800), trigger: "beforeTurn" }),
      ).toBe(true);
      expect(
        config.shouldCompactOnTrigger?.({ messages }, { usage: usage(700), trigger: "beforeTurn" }),
      ).toBe(false);
    } finally {
      delete process.env.AXLE_CONTEXT_WINDOW;
    }
  });

  it("never compacts an empty conversation", () => {
    const agent = createAgent({ provider: createCapturingProvider("mock", []) });
    const config = createSessionCompaction(agent);
    expect(
      config.shouldCompactOnTrigger?.(
        { messages: [] },
        { usage: usage(500_000), trigger: "beforeTurn" },
      ),
    ).toBe(false);
  });

  it("inherits the recipe's reasoning for the summarizer request", async () => {
    const requests: CapturedRequest[] = [];
    const agent = createAgent({
      provider: createCapturingProvider("mock", requests),
      reasoning: "on",
    });
    const config = createSessionCompaction(agent);

    await config.compact(
      { messages: [{ role: "user", content: "remember blue" }] },
      { usage: usage(1000), trigger: "beforeTurn", id: "comp-1", emit: () => {} },
    );

    expect(requests[0].reasoning).toBe("on");
  });

  it("leaves reasoning unset when the recipe doesn't set it", async () => {
    const requests: CapturedRequest[] = [];
    const agent = createAgent({ provider: createCapturingProvider("mock", requests) });
    const config = createSessionCompaction(agent);

    const result = await config.compact(
      { messages: [{ role: "user", content: "remember blue" }] },
      { usage: usage(1000), trigger: "beforeTurn", id: "comp-1", emit: () => {} },
    );

    expect(requests[0].reasoning).toBeUndefined();
    expect(String(result.messages[0]?.content)).toBe("Continuation summary.");
  });
});

const TEST_DIR = join(import.meta.dirname, "__compaction_tmp__");
const HOME = join(TEST_DIR, "home");

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

const definition: AgentDefinition = {
  version: 1,
  name: "compact-job",
  provider: { type: "anthropic" },
  model: "unknown-model",
};

interface RunnerCall {
  system?: string;
  messages: { role: string; content: unknown; metadata?: Record<string, unknown> }[];
}

function createRunnerProvider(calls: RunnerCall[]): AIProvider {
  return {
    name: "mock",
    async createGenerationRequest() {
      throw new Error("not used");
    },
    async *createStreamingRequest(model, params) {
      const { system, messages } = params as unknown as RunnerCall & { system?: string };
      calls.push({ system, messages: [...messages] });
      yield { type: "start" as const, id: `r-${calls.length}`, data: { model, timestamp: 0 } };
      yield { type: "text-start" as const, data: { index: 0 } };
      yield { type: "text-delta" as const, data: { index: 0, text: "Continuation summary." } };
      yield { type: "text-complete" as const, data: { index: 0 } };
      yield {
        type: "complete" as const,
        data: { finishReason: AxleStopReason.Stop, usage: { in: 10, out: 20 } },
      };
    },
  };
}

describe("compacted session snapshot/resume", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it("compacts over-threshold history before the send, persists it, and resumes it", async () => {
    // 100 user messages × 6KB ≈ 200k estimated tokens (3 chars/token) —
    // over the 160k threshold assumed for an unknown model.
    const history = Array.from({ length: 100 }, (_, i) => ({
      role: "user" as const,
      content: `FILLER-${String(i).padStart(3, "0")} ${"x".repeat(6_000)}`,
    }));
    const tracer = new Tracer();
    const calls: RunnerCall[] = [];
    const store = new SessionStore(definition, { home: HOME });
    const usageReports: number[] = [];
    const usageRenderer: Renderer = {
      ...nullRenderer,
      updateUsage: (usage) => usageReports.push(usage.contextTokens),
    };

    const succeeded = await runAgentSession(
      {
        agentConfig: {
          provider: createRunnerProvider(calls),
          model: "unknown-model",
          sessionId: "compact-1",
        },
        spanName: "job",
        session: { sessionId: "compact-1", messages: history },
        initial: "please continue",
        interactive: false,
      },
      createStats(),
      tracer.startSpan("test"),
      usageRenderer,
      store,
    );

    expect(succeeded).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].system).toContain("You summarize an agent conversation");
    // Usage reports: initial (over threshold), on compaction:complete
    // (mid-turn drop), after the send settles.
    expect(usageReports.length).toBeGreaterThanOrEqual(3);
    expect(usageReports[0]).toBeGreaterThan(160_000);
    expect(usageReports[1]).toBeLessThan(usageReports[0] / 2);
    expect(calls[1].messages.length).toBeLessThan(history.length);
    expect(String(calls[1].messages[0].content)).toBe("Continuation summary.");
    expect(JSON.stringify(calls[1].messages.at(-1)?.content)).toContain("please continue");

    const file: CliSessionFile = JSON.parse(
      await readFile(sessionFilePath("compact-1", HOME), "utf-8"),
    );
    expect(file.session.messages.length).toBeLessThan(20);
    const firstMessage = file.session.messages[0] as { metadata?: Record<string, unknown> };
    expect(firstMessage.metadata?.axleCompaction).toMatchObject({ role: "summary" });
    // The oldest history is summarized away; only recent messages may survive
    // verbatim in the appendix.
    expect(JSON.stringify(file.session.messages)).not.toContain("FILLER-000");
    const compactionParts = file.turns
      .flatMap((turn) => turn.parts)
      .filter((part) => part.type === "compaction");
    expect(compactionParts).toHaveLength(1);
    expect(compactionParts[0]).toMatchObject({ status: "complete", progress: 1 });

    // Resume the compacted session: history loads, and no second compaction
    // fires below the threshold.
    const resumeCalls: RunnerCall[] = [];
    const resumed = await runAgentSession(
      {
        agentConfig: {
          provider: createRunnerProvider(resumeCalls),
          model: "unknown-model",
          sessionId: file.session.sessionId,
        },
        spanName: "resume",
        session: file.session,
        priorTurns: file.turns,
        initial: "and again",
        interactive: false,
      },
      createStats(),
      tracer.startSpan("test"),
      nullRenderer,
      store,
    );

    expect(resumed).toBe(true);
    expect(resumeCalls).toHaveLength(1);
    expect(String(resumeCalls[0].messages[0].content)).toBe("Continuation summary.");
    expect(JSON.stringify(resumeCalls[0].messages.at(-1)?.content)).toContain("and again");
  });

  it("does not compact when the recipe opts out", async () => {
    const history = Array.from({ length: 100 }, () => ({
      role: "user" as const,
      content: "x".repeat(6_000),
    }));
    const calls: RunnerCall[] = [];

    const succeeded = await runAgentSession(
      {
        agentConfig: {
          provider: createRunnerProvider(calls),
          model: "unknown-model",
          sessionId: "compact-off",
        },
        spanName: "job",
        session: { sessionId: "compact-off", messages: history },
        initial: "please continue",
        interactive: false,
        compaction: false,
      },
      createStats(),
      new Tracer().startSpan("test"),
      nullRenderer,
    );

    expect(succeeded).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].messages.length).toBe(history.length + 1);
  });
});
