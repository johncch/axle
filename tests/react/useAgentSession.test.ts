import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentStatus } from "../../src/react/types.js";
import type { Turn } from "../../src/turns/types.js";

// --- Minimal React mock ---

type SetState<T> = (updater: T | ((prev: T) => T)) => void;
interface MockState<T> {
  value: T;
  set: SetState<T>;
}

let stateSlots: MockState<any>[];
let stateIndex: number;
let cleanupFns: (() => void)[];
let refSlots: { current: any }[];
let refIndex: number;
let memoSlots: any[];
let memoIndex: number;

function resetReactMocks() {
  stateSlots = [];
  stateIndex = 0;
  cleanupFns = [];
  refSlots = [];
  refIndex = 0;
  memoSlots = [];
  memoIndex = 0;
}

vi.mock("react", () => ({
  useState: <T>(initial: T) => {
    if (stateIndex >= stateSlots.length) {
      const slot: MockState<T> = {
        value: initial,
        set: (updater: T | ((prev: T) => T)) => {
          slot.value =
            typeof updater === "function" ? (updater as (prev: T) => T)(slot.value) : updater;
        },
      };
      stateSlots.push(slot);
    }
    const slot = stateSlots[stateIndex++];
    return [slot.value, slot.set] as [T, SetState<T>];
  },
  useRef: <T>(initial: T) => {
    if (refIndex >= refSlots.length) {
      refSlots.push({ current: initial });
    }
    return refSlots[refIndex++];
  },
  useCallback: <T extends (...args: any[]) => any>(fn: T, _deps: any[]) => fn,
  useEffect: (fn: () => void | (() => void), _deps?: any[]) => {
    const cleanup = fn();
    if (typeof cleanup === "function") cleanupFns.push(cleanup);
  },
  useMemo: <T>(fn: () => T, _deps?: any[]): T => {
    if (memoIndex >= memoSlots.length) {
      memoSlots.push(fn());
    }
    return memoSlots[memoIndex++];
  },
}));

import { useAgentSession } from "../../src/react/useAgentSession.js";

// --- SSE helpers ---

function sseBlock(event: string, data: any, id?: number): string {
  const idLine = id !== undefined ? `id: ${id}\n` : "";
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createMockStreamResponse(chunks: string[]): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index++]));
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// --- Test helpers ---

function callHook(url: string, options?: { sessionId?: string }) {
  stateIndex = 0;
  refIndex = 0;
  memoIndex = 0;
  return useAgentSession(url, options);
}

function getTurns(): Turn[] {
  return stateSlots[0].value;
}

function getStatus(): AgentStatus {
  return stateSlots[1].value;
}

const BASE_URL = "http://localhost:3000/agents/my-agent";

describe("useAgentSession", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetReactMocks();
    fetchMock = vi.fn();
    (globalThis as any).fetch = fetchMock;
  });

  afterEach(() => {
    for (const fn of cleanupFns) fn();
    cleanupFns = [];
    vi.restoreAllMocks();
  });

  test("initial state is idle with empty turns", () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    const result = callHook(BASE_URL);
    expect(result.status).toBe("idle");
    expect(result.turns).toEqual([]);
  });

  test("generates a sessionId when none provided", () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    const result = callHook(BASE_URL);
    expect(typeof result.sessionId).toBe("string");
    expect(result.sessionId.length).toBeGreaterThan(0);
  });

  test("uses provided sessionId from options", () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    const result = callHook(BASE_URL, { sessionId: "existing" });
    expect(result.sessionId).toBe("existing");
  });

  test("sessionId is stable across re-renders", () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    const result1 = callHook(BASE_URL);
    const id1 = result1.sessionId;
    const result2 = callHook(BASE_URL);
    expect(result2.sessionId).toBe(id1);
  });

  test("sets status to ready after successful GET subscription", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    callHook(BASE_URL);

    await vi.waitFor(() => {
      expect(getStatus()).toBe("ready");
    });
  });

  test("sets status to error when GET subscription fails", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })));

    callHook(BASE_URL);

    await vi.waitFor(() => {
      expect(getStatus()).toBe("error");
    });
  });

  test("GET subscription includes sessionId in query params", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    callHook(BASE_URL, { sessionId: "test-session" });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("sessionId=test-session");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  describe("send()", () => {
    test("posts to url with message and sessionId", async () => {
      fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
        if (!opts?.method || opts.method === "GET") {
          return Promise.resolve(createMockStreamResponse([]));
        }
        return Promise.resolve(Response.json({ ok: true }));
      });

      const result = callHook(BASE_URL);
      const sid = result.sessionId;

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      result.send("Hello");

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(BASE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: "Hello", sessionId: sid }),
        });
      });
    });

    test("sets status to error on POST failure", async () => {
      fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
        if (!opts?.method || opts.method === "GET") {
          return Promise.resolve(createMockStreamResponse([]));
        }
        return Promise.reject(new Error("network error"));
      });

      const result = callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      result.send("Hello");

      await vi.waitFor(() => {
        expect(getStatus()).toBe("error");
      });
    });
  });

  describe("SSE events via GET subscription", () => {
    test("turn:user appends user turn", async () => {
      const userTurn: Turn = {
        id: "u1",
        owner: "user",
        parts: [{ id: "p1", type: "text", text: "Hello" }],
      };

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:user", { type: "turn:user", turn: userTurn }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        const turns = getTurns();
        expect(turns).toHaveLength(1);
        expect(turns[0].owner).toBe("user");
      });
    });

    test("turn:start creates agent turn, text:delta accumulates", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", turnId: "a1" }),
            sseBlock("part:start", {
              type: "part:start",
              turnId: "a1",
              part: { id: "p1", type: "text", text: "" },
            }),
            sseBlock("text:delta", {
              type: "text:delta",
              turnId: "a1",
              partId: "p1",
              delta: "Hello",
            }),
            sseBlock("text:delta", {
              type: "text:delta",
              turnId: "a1",
              partId: "p1",
              delta: " world",
            }),
            sseBlock("part:end", { type: "part:end", turnId: "a1", partId: "p1" }),
            sseBlock("turn:end", { type: "turn:end", turnId: "a1", usage: { in: 10, out: 20 } }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const turns = getTurns();
      expect(turns).toHaveLength(1);
      const agentTurn = turns[0];
      expect(agentTurn.owner).toBe("agent");
      const textPart = agentTurn.parts[0];
      expect(textPart.type).toBe("text");
      if (textPart.type === "text") {
        expect(textPart.text).toBe("Hello world");
      }
    });

    test("thinking:delta accumulates thinking content", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", turnId: "a1" }),
            sseBlock("part:start", {
              type: "part:start",
              turnId: "a1",
              part: { id: "p1", type: "thinking", text: "" },
            }),
            sseBlock("thinking:delta", {
              type: "thinking:delta",
              turnId: "a1",
              partId: "p1",
              delta: "Let me think",
            }),
            sseBlock("part:end", { type: "part:end", turnId: "a1", partId: "p1" }),
            sseBlock("turn:end", { type: "turn:end", turnId: "a1", usage: { in: 10, out: 20 } }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const turns = getTurns();
      const part = turns[0].parts[0];
      expect(part.type).toBe("thinking");
      if (part.type === "thinking") {
        expect(part.text).toBe("Let me think");
      }
    });

    test("tool action lifecycle: part:start → action:running → action:complete", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", turnId: "a1" }),
            sseBlock("part:start", {
              type: "part:start",
              turnId: "a1",
              part: {
                id: "tc1",
                type: "action",
                kind: "tool",
                status: "pending",
                detail: { name: "calculator", parameters: {} },
              },
            }),
            sseBlock("action:running", {
              type: "action:running",
              turnId: "a1",
              partId: "tc1",
            }),
            sseBlock("action:complete", {
              type: "action:complete",
              turnId: "a1",
              partId: "tc1",
              result: { type: "success", content: "4" },
            }),
            sseBlock("turn:end", { type: "turn:end", turnId: "a1", usage: { in: 10, out: 20 } }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const turns = getTurns();
      const part = turns[0].parts[0];
      expect(part.type).toBe("action");
      if (part.type === "action" && part.kind === "tool") {
        expect(part.status).toBe("complete");
        expect(part.detail.name).toBe("calculator");
        expect(part.detail.result).toEqual({ type: "success", content: "4" });
      }
    });

    test("action:error sets tool call status to error", async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              sseBlock("turn:start", { type: "turn:start", turnId: "a1" }) +
                sseBlock("part:start", {
                  type: "part:start",
                  turnId: "a1",
                  part: {
                    id: "tc1",
                    type: "action",
                    kind: "tool",
                    status: "pending",
                    detail: { name: "calculator", parameters: {} },
                  },
                }) +
                sseBlock("action:error", {
                  type: "action:error",
                  turnId: "a1",
                  partId: "tc1",
                  error: { type: "runtime", message: "fail" },
                }),
            ),
          );
        },
      });
      const response = new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      fetchMock.mockImplementation(() => Promise.resolve(response));

      callHook(BASE_URL);

      await vi.waitFor(() => {
        const turns = getTurns();
        expect(turns).toHaveLength(1);
        expect(turns[0].parts).toHaveLength(1);
      });

      const turns = getTurns();
      const part = turns[0].parts[0];
      expect(part.type).toBe("action");
      if (part.type === "action") {
        expect(part.status).toBe("error");
      }

      controllerRef!.close();
    });

    test("error event sets status to error", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("error", { type: "error", error: { type: "model", message: "something went wrong" } }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("error");
      });
    });

    test("lastSeq is tracked from SSE event ids", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", turnId: "a1" }, 1),
            sseBlock("turn:end", { type: "turn:end", turnId: "a1", usage: { in: 10, out: 20 } }, 2),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      // lastSeqRef is refSlots[3] (configRef=0, configSentRef=1, subscriptionRef=2, lastSeqRef=3)
      expect(refSlots[3].current).toBe(2);
    });

    test("session:restore sets turns from snapshot", async () => {
      const existingTurns: Turn[] = [
        { id: "t1", owner: "user", parts: [{ id: "p1", type: "text", text: "Hi" }] },
        { id: "t2", owner: "agent", parts: [{ id: "p2", type: "text", text: "Hello" }] },
      ];

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("session:restore", { type: "session:restore", turns: existingTurns }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const turns = getTurns();
      expect(turns).toHaveLength(2);
      expect(turns[0].owner).toBe("user");
      expect(turns[1].owner).toBe("agent");
    });
  });

  describe("cancel()", () => {
    test("sends DELETE request with sessionId", async () => {
      fetchMock.mockImplementation((_url: string, opts?: RequestInit) => {
        if (opts?.method === "DELETE") {
          return Promise.resolve(Response.json({ ok: true }));
        }
        return Promise.resolve(createMockStreamResponse([]));
      });

      const result = callHook(BASE_URL);
      const sid = result.sessionId;

      result.cancel();

      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(BASE_URL, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });
      });
    });
  });

  describe("cleanup", () => {
    test("aborts subscription on unmount", async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          controller.enqueue(
            new TextEncoder().encode(
              sseBlock("turn:start", { type: "turn:start", turnId: "a1" }),
            ),
          );
        },
      });
      const response = new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });

      fetchMock.mockImplementation(() => Promise.resolve(response));

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getTurns()).toHaveLength(1);
      });

      for (const fn of cleanupFns) fn();
      cleanupFns = [];

      // subscriptionRef is refSlots[2] (configRef=0, configSentRef=1, subscriptionRef=2)
      expect(refSlots[2].current).toBeNull();

      controllerRef!.close();
    });
  });
});
