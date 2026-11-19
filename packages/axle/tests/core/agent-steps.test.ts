import { describe, expect, test, vi } from "vitest";
import * as z from "zod";
import { Agent, type AgentStep } from "../../src/core/agent/index.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import { AxleToolFatalError } from "../../src/errors/AxleToolFatalError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import type { DeferredTool, ExecutableTool } from "../../src/tools/types.js";
import type { TurnEvent } from "../../src/turns/events.js";
import type { Stats } from "../../src/types.js";
import { attributeStats } from "../../src/utils/stats.js";

type Script =
  "tool" | "two-tools" | "text" | "error" | "refusal" | "cut-in-text" | "cut-in-tool-call";

function scriptedProvider(script: Script[]) {
  let calls = 0;
  const writing = Promise.withResolvers<void>();
  const provider: AIProvider = {
    protocol: "chatCompletions",
    id: "mock",
    async *createStreamingRequest(_model, { signal }): AsyncGenerator<AnyStreamChunk, void> {
      const kind = script[calls] ?? "text";
      calls += 1;
      yield { type: "start", id: `m${calls}`, data: { model: "mock", timestamp: 0 } };
      if (kind === "refusal") {
        yield { type: "refusal", data: { refusal: { text: "no" }, usage: { in: 50, out: 5 } } };
        return;
      }
      if (kind === "cut-in-text" || kind === "cut-in-tool-call") {
        if (kind === "cut-in-text") {
          yield { type: "text-start", data: { index: 0 } };
          yield { type: "text-delta", data: { index: 0, text: "so far" } };
        } else {
          yield { type: "tool-call-start", data: { index: 0, id: `tc${calls}`, name: "lookup" } };
        }
        writing.resolve();
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return;
      }
      if (kind === "two-tools") {
        for (const [index, input] of ["slow", "fast"].entries()) {
          yield { type: "tool-call-start", data: { index, id: `tc-${input}`, name: "lookup" } };
          yield {
            type: "tool-call-complete",
            data: { index, id: `tc-${input}`, name: "lookup", arguments: { input } },
          };
        }
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 100, out: 10 } },
        };
        return;
      }
      if (kind === "error") {
        yield { type: "error", data: { type: "server_error", message: "boom" } };
        return;
      }
      if (kind === "tool") {
        yield { type: "tool-call-start", data: { index: 0, id: `tc${calls}`, name: "lookup" } };
        yield {
          type: "tool-call-complete",
          data: { index: 0, id: `tc${calls}`, name: "lookup", arguments: { input: "x" } },
        };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 100, out: 10 } },
        };
        return;
      }
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: "done" } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 200, out: 20 } },
      };
    },
  };
  return {
    provider,
    writing: writing.promise,
    get calls() {
      return calls;
    },
  };
}

function lookupTool(execute: ExecutableTool["execute"] = async () => "sunny"): ExecutableTool {
  return {
    name: "lookup",
    description: "Look something up",
    schema: z.object({ input: z.string() }),
    execute,
  };
}

function turnEnd(events: TurnEvent[]): Extract<TurnEvent, { type: "turn:end" }> {
  const event = events.find((e) => e.type === "turn:end");
  if (event?.type !== "turn:end") throw new Error("no turn:end");
  return event;
}

function rowsOf(steps: AgentStep[]): Stats["breakdown"] {
  return steps.flatMap((step) => step.usage.breakdown);
}

describe("Agent onStep", () => {
  test("fires once per step with its rows, and messages is current each time", async () => {
    const { provider } = scriptedProvider(["tool", "text"]);
    const agent = new Agent({ provider, model: "mock", tools: [lookupTool()] });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const steps: AgentStep[] = [];
    const rolesSeen: string[] = [];
    const eventsSeen: string[][] = [];
    agent.onStep((step) => {
      steps.push(step);
      rolesSeen.push(agent.messages.map((m) => m.role).join(","));
      eventsSeen.push(events.map((e) => e.type));
    });

    const result = await agent.send("weather?").final;

    const end = turnEnd(events);
    expect(steps.map((s) => [s.turnId, s.index, s.usage.breakdown.length])).toEqual([
      [end.turnId, 0, 1],
      [end.turnId, 1, 1],
    ]);
    expect(Object.keys(steps[0]).sort()).toEqual(["index", "signal", "turnId", "usage"]);
    expect(rolesSeen).toEqual(["user,assistant,tool", "user,assistant,tool,assistant"]);
    expect(rowsOf(steps)).toEqual(end.usage.breakdown);
    expect(end.usage).toMatchObject({ in: 300, out: 30 });
    expect(result.usage).toEqual(end.usage);
    expect(eventsSeen[0]).toContain("action:complete");
    expect(eventsSeen[1]).not.toContain("turn:end");
    expect(agent.messages).toHaveLength(4);
  });

  test("the turn waits for the callback before sending the next request", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [lookupTool()] });
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    let fired = 0;
    agent.onStep(async () => {
      if (++fired > 1) return;
      reached.resolve();
      await gate.promise;
    });

    const handle = agent.send("weather?");
    await reached.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mock.calls).toBe(1);
    gate.resolve();
    await handle.final;
    expect(mock.calls).toBe(2);
    expect(fired).toBe(2);
  });

  test("a throw stops the turn there and rejects the handle with it", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [lookupTool()] });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const failure = new Error("ledger unavailable");
    let fired = 0;
    const unsubscribe = agent.onStep(() => {
      fired += 1;
      throw failure;
    });
    const settled: unknown[] = [];
    agent.onSettled((_session, operation) => void settled.push(operation.result));

    await expect(agent.send("weather?").final).rejects.toBe(failure);

    expect(fired).toBe(1);
    expect(mock.calls).toBe(1);
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(JSON.stringify(agent.messages[2])).toContain("sunny");
    expect(turnEnd(events)).toMatchObject({
      status: "error",
      usage: { in: 100, out: 10 },
      error: { message: "ledger unavailable" },
    });
    expect(settled).toEqual([{ status: "rejected", reason: failure }]);

    unsubscribe();
    const next = await agent.send("again").final;
    expect(next.ok).toBe(true);
  });

  test("a throw after the final step keeps the answer in history", async () => {
    const { provider } = scriptedProvider(["text"]);
    const agent = new Agent({ provider, model: "mock" });
    const failure = new Error("ledger unavailable");
    agent.onStep(() => {
      throw failure;
    });

    await expect(agent.send("hi").final).rejects.toBe(failure);

    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("cancel() while a callback is pending takes effect when it returns", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [lookupTool()] });
    const gate = Promise.withResolvers<void>();
    const reached = Promise.withResolvers<void>();
    const aborted: boolean[] = [];
    agent.onStep(async (step) => {
      reached.resolve();
      await gate.promise;
      aborted.push(step.signal.aborted);
    });

    const handle = agent.send("weather?");
    await reached.promise;
    expect(agent.cancel()).toBe(true);
    gate.resolve();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(aborted).toEqual([true]);
    expect(mock.calls).toBe(1);
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
  });

  test("a turn cancelled during its tools still fires, with every call answered", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const running = Promise.withResolvers<void>();
    const agent = new Agent({
      provider: mock.provider,
      model: "mock",
      tools: [
        lookupTool((_input, ctx) => {
          running.resolve();
          return new Promise((_resolve, reject) => {
            ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
          });
        }),
      ],
    });
    const rolesSeen: string[] = [];
    const steps: AgentStep[] = [];
    agent.onStep((step) => {
      steps.push(step);
      rolesSeen.push(agent.messages.map((m) => m.role).join(","));
    });

    const handle = agent.send("weather?");
    await running.promise;
    agent.cancel();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(rolesSeen).toEqual(["user,assistant,tool"]);
    expect(steps[0]).toMatchObject({ index: 0, usage: { in: 100, out: 10 } });
    expect(agent.messages).toHaveLength(3);
  });

  test("a failed model call is a step that adds no message", async () => {
    const { provider } = scriptedProvider(["tool", "error"]);
    const agent = new Agent({ provider, model: "mock", tools: [lookupTool()] });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const steps: AgentStep[] = [];
    const lengths: number[] = [];
    agent.onStep((step) => {
      steps.push(step);
      lengths.push(agent.messages.length);
    });

    const result = await agent.send("weather?").final;

    expect(result.ok).toBe(false);
    expect(steps.map((s) => s.index)).toEqual([0, 1]);
    expect(lengths).toEqual([3, 3]);
    expect(rowsOf(steps)).toEqual(turnEnd(events).usage.breakdown);
  });

  test("a subagent's rows arrive on the step whose tools ran it", async () => {
    const { provider } = scriptedProvider(["tool", "text"]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: [
        lookupTool(async (_input, ctx) => {
          ctx.reportUsage?.(
            attributeStats(
              { in: 7, out: 3 },
              { provider: "mock", model: "sub", requestedModel: "sub", agent: "helper" },
            ),
          );
          return "sunny";
        }),
      ],
    });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const steps: AgentStep[] = [];
    agent.onStep((step) => void steps.push(step));

    await agent.send("weather?").final;

    expect(steps[0]).toMatchObject({
      index: 0,
      usage: { in: 107, out: 13, breakdown: [{ model: "mock" }, { agent: "helper" }] },
    });
    expect(steps[1]).toMatchObject({ index: 1 });
    expect(rowsOf(steps)).toEqual(turnEnd(events).usage.breakdown);
    expect(turnEnd(events).usage).toMatchObject({ in: 307, out: 33 });
  });

  test("a refused model call is a step with its usage and no message", async () => {
    const { provider } = scriptedProvider(["refusal"]);
    const agent = new Agent({ provider, model: "mock" });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const steps: AgentStep[] = [];
    agent.onStep((step) => void steps.push(step));

    const result = await agent.send("hi").final;

    expect(result.ok).toBe(false);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ index: 0, usage: { in: 50, out: 5 } });
    expect(rowsOf(steps)).toEqual(turnEnd(events).usage.breakdown);
    expect(agent.messages.map((m) => m.role)).toEqual(["user"]);
  });

  test("a throw at a failed model call rejects with the thrown error", async () => {
    const { provider } = scriptedProvider(["error"]);
    const agent = new Agent({ provider, model: "mock" });
    const failure = new Error("ledger unavailable");
    agent.onStep(() => {
      throw failure;
    });

    await expect(agent.send("hi").final).rejects.toBe(failure);
  });

  test("a model call cancelled mid-text is a step that keeps the text written", async () => {
    const mock = scriptedProvider(["cut-in-text"]);
    const agent = new Agent({ provider: mock.provider, model: "mock" });
    const steps: AgentStep[] = [];
    const rolesSeen: string[] = [];
    agent.onStep((step) => {
      steps.push(step);
      rolesSeen.push(agent.messages.map((m) => m.role).join(","));
    });

    const handle = agent.send("hi");
    await mock.writing;
    agent.cancel();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(rolesSeen).toEqual(["user,assistant"]);
    expect(steps[0]).toMatchObject({ index: 0, usage: { in: 0, out: 0, breakdown: [] } });
    expect(steps[0].signal.aborted).toBe(true);
  });

  test("session read inside the hook is the state committed so far, without waiting for idle", async () => {
    const { provider } = scriptedProvider(["tool", "text"]);
    const agent = new Agent({
      provider,
      model: "mock",
      sessionId: "s1",
      tools: [lookupTool()],
    });
    const seen: { sessionId: string; roles: string[]; busy: boolean }[] = [];
    agent.onStep(() => {
      const session = agent.session;
      seen.push({
        sessionId: session.sessionId,
        roles: session.messages.map((m) => m.role),
        busy: agent.status.phase === "busy",
      });
    });

    await agent.send("hi").final;

    expect(seen).toEqual([
      { sessionId: "s1", roles: ["user", "assistant", "tool"], busy: true },
      { sessionId: "s1", roles: ["user", "assistant", "tool", "assistant"], busy: true },
    ]);
    expect(agent.session).toEqual(await agent.snapshot());
  });

  test("a model call cancelled while writing a tool call is a step that adds no message", async () => {
    const mock = scriptedProvider(["cut-in-tool-call"]);
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [lookupTool()] });
    const rolesSeen: string[] = [];
    agent.onStep(() => void rolesSeen.push(agent.messages.map((m) => m.role).join(",")));

    const handle = agent.send("hi");
    await mock.writing;
    agent.cancel();

    await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
    expect(rolesSeen).toEqual(["user"]);
    expect(agent.messages.map((m) => m.role)).toEqual(["user"]);
  });

  test("cancel() during the final step's callback cancels the turn and keeps the answer", async () => {
    const { provider } = scriptedProvider(["text"]);
    const agent = new Agent({ provider, model: "mock" });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    agent.onStep(() => void agent.cancel());

    await expect(agent.send("hi").final).rejects.toBeInstanceOf(AxleAgentAbortError);

    expect(turnEnd(events)).toMatchObject({ status: "cancelled", usage: { in: 200, out: 20 } });
    expect(agent.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("a fatal tool error still fires, with the call answered", async () => {
    const { provider } = scriptedProvider(["tool", "text"]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: [
        lookupTool(async () => {
          throw new AxleToolFatalError("sandbox gone", { toolName: "lookup" });
        }),
      ],
    });
    const rolesSeen: string[] = [];
    agent.onStep(() => void rolesSeen.push(agent.messages.map((m) => m.role).join(",")));

    await expect(agent.send("weather?").final).rejects.toThrow("sandbox gone");

    expect(rolesSeen).toEqual(["user,assistant,tool"]);
  });

  test("a step waiting on a deferred tool fires once, after the answer", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const ask = {
      type: "deferred",
      name: "lookup",
      description: "Ask the person",
      schema: z.object({ input: z.string() }),
    } satisfies DeferredTool;
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [ask] });
    const rolesSeen: string[] = [];
    agent.onStep(() => void rolesSeen.push(agent.messages.map((m) => m.role).join(",")));

    const handle = agent.send("weather?");
    await vi.waitFor(() => expect(agent.toolCall("tc1")).toBeDefined());
    expect(rolesSeen).toEqual([]);
    expect(agent.messages.map((m) => m.role)).toEqual(["user"]);
    agent.toolCall("tc1")?.answer("sunny");
    await handle.final;

    expect(rolesSeen).toEqual(["user,assistant,tool", "user,assistant,tool,assistant"]);
  });

  test("every callback runs for a step, and the first failure rejects the turn", async () => {
    const mock = scriptedProvider(["tool", "text"]);
    const agent = new Agent({ provider: mock.provider, model: "mock", tools: [lookupTool()] });
    const failure = new Error("first");
    const ran: string[] = [];
    agent.onStep(() => {
      ran.push("a");
      throw failure;
    });
    agent.onStep(async () => {
      await Promise.resolve();
      ran.push("b");
    });

    await expect(agent.send("weather?").final).rejects.toBe(failure);

    expect(ran).toEqual(["a", "b"]);
    expect(mock.calls).toBe(1);
  });

  test("rows from parallel subagents are grouped per call in request order", async () => {
    const { provider } = scriptedProvider(["two-tools", "text"]);
    const agent = new Agent({
      provider,
      model: "mock",
      tools: [
        lookupTool(async (args, ctx) => {
          const input = String(args.input);
          if (input === "slow") await new Promise((resolve) => setTimeout(resolve, 10));
          ctx.reportUsage?.(
            attributeStats(
              { in: 1, out: 1 },
              { provider: "mock", model: "sub", requestedModel: "sub", agent: input },
            ),
          );
          return input;
        }),
      ],
    });
    const events: TurnEvent[] = [];
    agent.on((event) => events.push(event as TurnEvent));
    const steps: AgentStep[] = [];
    agent.onStep((step) => void steps.push(step));

    await agent.send("go").final;

    expect(steps[0].usage.breakdown.map((row) => row.agent)).toEqual([undefined, "slow", "fast"]);
    expect(steps[1].index).toBe(1);
    expect(rowsOf(steps)).toEqual(turnEnd(events).usage.breakdown);
  });

  test("fires for inline turns sent by a continuation", async () => {
    const { provider } = scriptedProvider(["text", "text"]);
    const agent = new Agent({ provider, model: "mock" });
    const turnIds: string[] = [];
    const indexes: number[] = [];
    agent.onStep((step) => {
      turnIds.push(step.turnId);
      indexes.push(step.index);
    });

    await agent.send("first", {
      after: async (_result, ctx) => {
        await ctx.send("second");
      },
    }).final;

    expect(turnIds).toHaveLength(2);
    expect(new Set(turnIds).size).toBe(2);
    expect(indexes).toEqual([0, 0]);
  });

  describe("compaction", () => {
    test("a compaction that ran is a step with no usage", async () => {
      const { provider } = scriptedProvider(["text"]);
      const agent = new Agent({ provider, model: "mock" });
      await agent.send("hi").final;
      agent.setCompaction({ compact: (state) => ({ messages: state.messages.slice(-1) }) });
      const events: TurnEvent[] = [];
      agent.on((event) => events.push(event as TurnEvent));
      const steps: AgentStep[] = [];
      const lengths: number[] = [];
      agent.onStep((step) => {
        steps.push(step);
        lengths.push(agent.messages.length);
      });

      await expect(agent.compact()).resolves.toBe(true);

      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({
        turnId: turnEnd(events).turnId,
        index: 0,
        usage: { in: 0, out: 0, breakdown: [] },
      });
      expect(lengths).toEqual([1]);
    });

    test("fires when the compact callback failed, and not when the policy declined", async () => {
      const { provider } = scriptedProvider(["text", "text"]);
      const agent = new Agent({ provider, model: "mock" });
      const broken = new Error("summarizer down");
      let allow = false;
      agent.setCompaction({
        compact: () => {
          throw broken;
        },
        shouldCompactOnTrigger: () => allow,
        triggers: { beforeTurn: true },
      });
      const usages: number[] = [];
      agent.onStep((step) => void usages.push(step.usage.breakdown.length));

      await agent.send("declined").final;
      expect(usages).toEqual([1]);

      allow = true;
      const result = await agent.send("failed").final;
      expect(result.ok).toBe(true);
      expect(usages).toEqual([1, 0, 1]);

      await expect(agent.compact()).rejects.toBe(broken);
      expect(usages).toEqual([1, 0, 1, 0]);
    });

    test("a compaction before the turn is step 0 and the model call follows it", async () => {
      const { provider } = scriptedProvider(["text", "text"]);
      const agent = new Agent({ provider, model: "mock" });
      await agent.send("first").final;
      agent.setCompaction({
        compact: (state) => ({ messages: state.messages }),
        triggers: { beforeTurn: true },
      });
      const steps: AgentStep[] = [];
      agent.onStep((step) => void steps.push(step));

      await agent.send("second").final;

      expect(new Set(steps.map((s) => s.turnId)).size).toBe(1);
      expect(steps.map((s) => [s.index, s.usage.breakdown.length])).toEqual([
        [0, 0],
        [1, 1],
      ]);
    });

    test("a compaction after the turn takes the next step index", async () => {
      const { provider } = scriptedProvider(["tool", "text"]);
      const agent = new Agent({ provider, model: "mock", tools: [lookupTool()] });
      agent.setCompaction({
        compact: (state) => ({ messages: state.messages }),
        triggers: { afterTurn: true },
      });
      const steps: AgentStep[] = [];
      agent.onStep((step) => void steps.push(step));

      await agent.send("weather?").final;

      expect(steps.map((s) => [s.index, s.usage.breakdown.length])).toEqual([
        [0, 1],
        [1, 1],
        [2, 0],
      ]);
    });

    test("a throw rejects compact() and, before a turn, stops it before its request", async () => {
      const mock = scriptedProvider(["text"]);
      const agent = new Agent({ provider: mock.provider, model: "mock" });
      const failure = new Error("ledger unavailable");
      agent.setCompaction({
        compact: (state) => ({ messages: state.messages }),
        triggers: { beforeTurn: true },
      });
      agent.onStep(() => {
        throw failure;
      });

      await expect(agent.compact()).rejects.toBe(failure);
      await expect(agent.send("hi").final).rejects.toBe(failure);
      expect(mock.calls).toBe(0);
    });
  });
});
