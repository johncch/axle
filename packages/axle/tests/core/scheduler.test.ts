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

  test("clear() rejects all queued work, leaves the active task running, and drops listeners", async () => {
    const scheduler = new AgentScheduler();
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const active = scheduler.schedule(async () => {
      await gate;
      return "active";
    });
    const queuedSend = scheduler.schedule(async () => "unreachable", {
      signal: controller.signal,
    });
    const queuedCompact = scheduler.schedule(async () => "unreachable", {
      operation: "compact",
    });

    expect(scheduler.clear()).toBe(2);

    await expect(queuedSend.final).rejects.toMatchObject({
      name: "AbortError",
      message: "Agent send aborted",
    });
    await expect(queuedCompact.final).rejects.toMatchObject({
      name: "AbortError",
      message: "Agent compact aborted",
    });
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    release();
    await expect(active.final).resolves.toBe("active");
    expect(scheduler.clear()).toBe(0);
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

  test("settle runs with the work's result after it finishes and before the handle or the next task", async () => {
    const scheduler = new AgentScheduler();
    const order: string[] = [];
    const results: PromiseSettledResult<string>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = scheduler.schedule(async () => "one", {
      settle: async (result) => {
        results.push(result);
        order.push("settle start");
        await gate;
        order.push("settle end");
      },
    });
    const second = scheduler.schedule(async () => {
      order.push("second runs");
      return "two";
    });
    const firstDone = first.final.then((value) => order.push(`first ${value}`));

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["settle start"]);
    expect(scheduler.cancelCurrent("late")).toBe(false);

    release();
    await firstDone;
    await expect(second.final).resolves.toBe("two");
    expect(order).toEqual(["settle start", "settle end", "first one", "second runs"]);
    expect(results).toEqual([{ status: "fulfilled", value: "one" }]);
  });

  test("settle sees a rejection and the handle still rejects with it", async () => {
    const scheduler = new AgentScheduler();
    const results: PromiseSettledResult<never>[] = [];
    const failure = new Error("boom");

    const handle = scheduler.schedule<never>(
      async () => {
        throw failure;
      },
      { settle: (result) => void results.push(result) },
    );

    await expect(handle.final).rejects.toBe(failure);
    expect(results).toEqual([{ status: "rejected", reason: failure }]);
  });

  test("cancelling a handle while it settles changes nothing", async () => {
    const scheduler = new AgentScheduler();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalDuringSettle: AbortSignal | undefined;

    const handle = scheduler.schedule(
      async ({ signal }) => {
        signalDuringSettle = signal;
        return "done";
      },
      { settle: () => gate },
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    handle.cancel("too late");
    release();

    await expect(handle.final).resolves.toBe("done");
    expect(signalDuringSettle?.aborted).toBe(false);
  });
});
