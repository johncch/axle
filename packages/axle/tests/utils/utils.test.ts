import { describe, expect, it, vi } from "vitest";
import { createHandle } from "../../src/utils/utils.js";

describe("createHandle", () => {
  it("passes an already-cancelled signal to queued work", async () => {
    let releaseQueue!: () => void;
    const queue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const work = vi.fn(async (signal: AbortSignal) => signal.aborted);

    const { handle } = createHandle(queue, work);
    handle.cancel("stop");
    releaseQueue();

    await expect(handle.final).resolves.toBe(true);
    expect(work.mock.calls[0][0].reason).toBe("stop");
  });

  it("merges external abort signals into the work signal", async () => {
    const controller = new AbortController();
    const work = vi.fn(async (signal: AbortSignal) => signal.reason);
    const { handle } = createHandle(Promise.resolve(), work, controller.signal);

    controller.abort("external");

    await expect(handle.final).resolves.toBe("external");
  });
});
