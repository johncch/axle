import { getEventListeners } from "node:events";
import { describe, expect, test } from "vitest";
import { AgentScheduler } from "../../src/core/agent/scheduler.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";

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

  test("a rejected handle nobody reads raises no unhandled rejection", async () => {
    const scheduler = new AgentScheduler();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    try {
      scheduler.schedule<never>(async () => {
        await gate;
        throw new Error("boom");
      });
      scheduler.schedule(async () => "unreachable").cancel("withdrawn");
      release();
      await new Promise((resolve) => setTimeout(resolve, 5));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
  describe("continuations", () => {
    test("after runs once the work settled, its inline runs settle one at a time, and the handle takes its value", async () => {
      const scheduler = new AgentScheduler();
      const order: string[] = [];

      const handle = scheduler.schedule(async () => "first", {
        settle: (result) =>
          void order.push(`settle:${(result as PromiseFulfilledResult<string>).value}`),
        after: async (value, inline) => {
          order.push(`after:${value}`);
          const a = inline.run(
            async () => {
              order.push("work:a");
              await new Promise((resolve) => setTimeout(resolve, 2));
              return "a";
            },
            () => void order.push("settle:a"),
          );
          const b = inline.run(
            async () => {
              order.push("work:b");
              return "b";
            },
            () => void order.push("settle:b"),
          );
          return `${value}+${await a}+${await b}`;
        },
      });
      const next = scheduler.schedule(async () => void order.push("next"));

      await expect(handle.final).resolves.toBe("first+a+b");
      await next.final;
      expect(order).toEqual([
        "settle:first",
        "after:first",
        "work:a",
        "settle:a",
        "work:b",
        "settle:b",
        "next",
      ]);
    });

    test("after is skipped when the work rejected", async () => {
      const scheduler = new AgentScheduler();
      let ran = false;

      const handle = scheduler.schedule<never>(
        async () => {
          throw new Error("boom");
        },
        {
          after: async () => {
            ran = true;
          },
        },
      );

      await expect(handle.final).rejects.toThrow("boom");
      expect(ran).toBe(false);
    });

    test("a continuation that throws rejects the handle and the queue continues", async () => {
      const scheduler = new AgentScheduler();

      const handle = scheduler.schedule(async () => "done", {
        after: async () => {
          throw new Error("judge failed");
        },
      });
      const next = scheduler.schedule(async () => "next");

      await expect(handle.final).rejects.toThrow("judge failed");
      await expect(next.final).resolves.toBe("next");
    });

    test("cancelCurrent() during a continuation aborts its signal, rejects the handle, and starts the next task", async () => {
      const scheduler = new AgentScheduler();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let inlineSignal: AbortSignal | undefined;
      let continuationSignal: AbortSignal | undefined;
      let returnedNormally = false;

      const handle = scheduler.schedule(async () => "done", {
        after: async (_value, inline) => {
          continuationSignal = inline.signal;
          await gate;
          await inline
            .run(async ({ signal }) => {
              inlineSignal = signal;
              return "unused";
            })
            .catch(() => {});
          returnedNormally = true;
        },
      });
      const next = scheduler.schedule(async () => "next");

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scheduler.cancelCurrent("stop")).toBe(true);
      release();

      await expect(handle.final).rejects.toBeInstanceOf(AxleAgentAbortError);
      expect(continuationSignal?.aborted).toBe(true);
      expect(inlineSignal?.aborted).toBe(true);
      expect(returnedNormally).toBe(true);
      await expect(next.final).resolves.toBe("next");
    });

    test("cancelCurrent() while settling is true only when a continuation remains, and then it never starts", async () => {
      const scheduler = new AgentScheduler();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let ran = false;

      const plain = scheduler.schedule(async () => "plain", { settle: () => gate });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scheduler.cancelCurrent()).toBe(false);
      release();
      await expect(plain.final).resolves.toBe("plain");

      let releaseSecond!: () => void;
      const secondGate = new Promise<void>((resolve) => (releaseSecond = resolve));
      const continued = scheduler.schedule(async () => "continued", {
        settle: () => secondGate,
        after: async () => {
          ran = true;
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(scheduler.cancelCurrent("stop")).toBe(true);
      expect(scheduler.cancelCurrent("again")).toBe(false);
      releaseSecond();

      await expect(continued.final).rejects.toBeInstanceOf(AxleAgentAbortError);
      expect(ran).toBe(false);
    });

    test("an inline run still in flight when the continuation returns is awaited; one started afterwards rejects", async () => {
      const scheduler = new AgentScheduler();
      const order: string[] = [];
      let runLate!: () => Promise<unknown>;

      const handle = scheduler.schedule(async () => "done", {
        after: async (_value, inline) => {
          runLate = () => inline.run(async () => "late");
          void inline.run(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push("inline finished");
            return "slow";
          });
          order.push("continuation returned");
        },
      });

      await handle.final;
      order.push("handle resolved");
      expect(order).toEqual(["continuation returned", "inline finished", "handle resolved"]);
      await expect(runLate()).rejects.toThrow("continuation has already returned");
    });
  });
});
