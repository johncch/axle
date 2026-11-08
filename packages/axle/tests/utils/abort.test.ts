import { describe, expect, test } from "vitest";
import { timeoutSignal } from "../../src/utils/abort.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("timeoutSignal", () => {
  test("aborts with a timeout reason once the time passes", async () => {
    const deadline = timeoutSignal(undefined, 10);
    await wait(25);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toEqual({ type: "timeout", limitMs: 10 });
    expect(deadline.expired).toBe(true);
  });

  test("reset pushes the time back", async () => {
    const deadline = timeoutSignal(undefined, 20);
    await wait(12);
    deadline.reset();
    await wait(12);
    expect(deadline.signal.aborted).toBe(false);
    await wait(15);
    expect(deadline.signal.aborted).toBe(true);
  });

  test("follows its parent, and that is not expiry", () => {
    const parent = new AbortController();
    using deadline = timeoutSignal(parent.signal, 1_000);
    parent.abort("user");
    expect(deadline.signal.reason).toBe("user");
    expect(deadline.expired).toBe(false);
  });

  test("leaving a using block stops the timer", async () => {
    let signal: AbortSignal;
    {
      using deadline = timeoutSignal(undefined, 10);
      signal = deadline.signal;
    }
    await wait(25);
    expect(signal.aborted).toBe(false);
  });

  test("with no limit, the signal is the parent's and it never expires", () => {
    const parent = new AbortController();
    using deadline = timeoutSignal(parent.signal, undefined);
    expect(deadline.signal).toBe(parent.signal);
    deadline.reset();
    expect(deadline.expired).toBe(false);
  });
});
