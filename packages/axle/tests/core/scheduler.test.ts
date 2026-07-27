import { getEventListeners } from "node:events";
import { describe, expect, test } from "vitest";
import { AgentScheduler } from "../../src/core/agent/scheduler.js";

describe("AgentScheduler", () => {
  test("completed work leaves no abort listener on its signal", async () => {
    const scheduler = new AgentScheduler();
    const controller = new AbortController();
    const signals: AbortSignal[] = [];

    for (let i = 0; i < 3; i++) {
      await scheduler.schedule(
        async ({ signal }) => {
          signals.push(signal);
        },
        { signal: controller.signal },
      ).final;
    }

    expect(signals).toHaveLength(3);
    for (const signal of signals) {
      expect(getEventListeners(signal, "abort")).toHaveLength(0);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(controller.signal.aborted).toBe(false);
  });

  test("work activated with a pre-aborted signal leaves no abort listener", async () => {
    const scheduler = new AgentScheduler();
    let seen: AbortSignal | undefined;

    await scheduler.schedule(
      async ({ signal }) => {
        seen = signal;
      },
      { signal: AbortSignal.abort("stop") },
    ).final;

    expect(seen?.aborted).toBe(true);
    expect(getEventListeners(seen!, "abort")).toHaveLength(0);
  });

  test("withdrawing a queued item rejects it and leaves other work unaffected", async () => {
    const scheduler = new AgentScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = scheduler.schedule(async () => {
      await gate;
      return "first";
    });

    const withdrawn = scheduler.schedule(async () => "unreachable", {
      signal: AbortSignal.abort("stop"),
      operation: "compact",
    });

    await expect(withdrawn.final).rejects.toMatchObject({
      name: "AbortError",
      message: "Agent compact aborted",
      reason: "stop",
    });

    release();
    await expect(first.final).resolves.toBe("first");
  });
});
