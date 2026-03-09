import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AxleStopReason } from "../../src/providers/types.js";
import type {
  AgentStatus,
  ClientAssistantMessage,
  ClientContentPartToolCall,
} from "../../src/react/types.js";

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

/**
 * The hook now does a GET subscription on mount via useEffect.
 * We set up the GET mock before calling the hook so the effect picks it up.
 */
function callHook(url: string, options?: { sessionId?: string }) {
  stateIndex = 0;
  refIndex = 0;
  memoIndex = 0;
  return useAgentSession(url, options);
}

function getMessages() {
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

  test("initial state is idle with empty messages", () => {
    // GET subscription returns a stream that stays open
    fetchMock.mockImplementation(() => Promise.resolve(createMockStreamResponse([])));

    const result = callHook(BASE_URL);
    expect(result.status).toBe("idle");
    expect(result.messages).toEqual([]);
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
      // GET subscription
      fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
        if (!opts?.method || opts.method === "GET") {
          return Promise.resolve(createMockStreamResponse([]));
        }
        // POST send
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
    test("message:user appends user message", async () => {
      const userMsg = { role: "user", id: "u1", content: "Hello" };

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("message:user", { type: "message:user", message: userMsg }),
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [{ type: "text", text: "Hi" }],
                finishReason: AxleStopReason.Stop,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const msgs = getMessages();
      expect(msgs[0]).toEqual(userMsg);
    });

    test("text:delta updates assistant message content progressively", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("text:delta", {
              type: "text:delta",
              index: 0,
              delta: "Hello",
              accumulated: "Hello",
            }),
            sseBlock("text:delta", {
              type: "text:delta",
              index: 0,
              delta: " world",
              accumulated: "Hello world",
            }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [{ type: "text", text: "Hello world" }],
                finishReason: AxleStopReason.Stop,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const msgs = getMessages();
      const assistant = msgs[msgs.length - 1] as ClientAssistantMessage;
      expect(assistant.content).toEqual([{ type: "text", text: "Hello world" }]);
    });

    test("thinking:delta updates assistant thinking content", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("thinking:delta", {
              type: "thinking:delta",
              index: 0,
              delta: "Let me think",
              accumulated: "Let me think",
            }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [{ type: "thinking", text: "Let me think" }],
                finishReason: AxleStopReason.Stop,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const msgs = getMessages();
      const assistant = msgs[msgs.length - 1] as ClientAssistantMessage;
      expect(assistant.content[0]).toEqual({ type: "thinking", text: "Let me think" });
    });

    test("tool lifecycle: request → exec-start → exec-complete", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("tool:request", {
              type: "tool:request",
              index: 0,
              id: "tc1",
              name: "calculator",
            }),
            sseBlock("tool:exec-start", {
              type: "tool:exec-start",
              index: 0,
              id: "tc1",
              name: "calculator",
              parameters: { expression: "2+2" },
            }),
            sseBlock("tool:exec-complete", {
              type: "tool:exec-complete",
              index: 0,
              id: "tc1",
              name: "calculator",
              result: { type: "success", content: "4" },
            }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [
                  {
                    type: "tool-call",
                    id: "tc1",
                    name: "calculator",
                    parameters: { expression: "2+2" },
                  },
                ],
                finishReason: AxleStopReason.FunctionCall,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getMessages()).toHaveLength(1);
      });

      const msgs = getMessages();
      const assistant = msgs[0] as ClientAssistantMessage;
      const toolCall = assistant.content[0] as ClientContentPartToolCall;
      expect(toolCall.status).toBe("complete");
      expect(toolCall.name).toBe("calculator");
    });

    test("tool:exec-complete with error sets tool call status to error", async () => {
      let controllerRef: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }) +
                sseBlock("tool:request", {
                  type: "tool:request",
                  index: 0,
                  id: "tc1",
                  name: "calculator",
                }) +
                sseBlock("tool:exec-complete", {
                  type: "tool:exec-complete",
                  index: 0,
                  id: "tc1",
                  name: "calculator",
                  result: { type: "error", error: { type: "runtime", message: "fail" } },
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
        expect(getMessages()).toHaveLength(1);
      });

      const msgs = getMessages();
      const assistant = msgs[0] as ClientAssistantMessage;
      const toolCall = assistant.content[0] as ClientContentPartToolCall;
      expect(toolCall.status).toBe("error");

      controllerRef!.close();
    });

    test("turn:complete with function_call keeps status streaming", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [{ type: "tool-call", id: "tc1", name: "calc", parameters: { x: 1 } }],
                finishReason: AxleStopReason.FunctionCall,
              },
            }),
            sseBlock("tool-results:complete", {
              type: "tool-results:complete",
              message: {
                role: "tool",
                id: "tr1",
                content: [{ id: "tc1", name: "calc", content: "4", isError: false }],
              },
            }),
            sseBlock("turn:start", { type: "turn:start", id: "a2", model: "m" }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a2",
                model: "m",
                content: [{ type: "text", text: "The answer is 4" }],
                finishReason: AxleStopReason.Stop,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const msgs = getMessages();
      expect(msgs).toHaveLength(3);
    });

    test("tool-results:complete appends tool message", async () => {
      const toolMsg = {
        role: "tool" as const,
        id: "tr1",
        content: [{ id: "tc1", name: "calc", content: "4", isError: false }],
      };

      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a1",
                model: "m",
                content: [{ type: "tool-call", id: "tc1", name: "calc", parameters: {} }],
                finishReason: AxleStopReason.FunctionCall,
              },
            }),
            sseBlock("tool-results:complete", {
              type: "tool-results:complete",
              message: toolMsg,
            }),
            sseBlock("turn:start", { type: "turn:start", id: "a2", model: "m" }),
            sseBlock("turn:complete", {
              type: "turn:complete",
              message: {
                role: "assistant",
                id: "a2",
                model: "m",
                content: [{ type: "text", text: "Done" }],
                finishReason: AxleStopReason.Stop,
              },
            }),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      const msgs = getMessages();
      expect(msgs[1]).toEqual(toolMsg);
    });

    test("error event sets status to error", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          createMockStreamResponse([
            sseBlock("error", { type: "error", message: "something went wrong" }),
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
            sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }, 1),
            sseBlock(
              "turn:complete",
              {
                type: "turn:complete",
                message: {
                  role: "assistant",
                  id: "a1",
                  model: "m",
                  content: [{ type: "text", text: "Hi" }],
                  finishReason: AxleStopReason.Stop,
                },
              },
              2,
            ),
          ]),
        ),
      );

      callHook(BASE_URL);

      await vi.waitFor(() => {
        expect(getStatus()).toBe("ready");
      });

      // lastSeqRef is refSlots[1] (subscriptionRef=0, lastSeqRef=1)
      expect(refSlots[1].current).toBe(2);
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
              sseBlock("turn:start", { type: "turn:start", id: "a1", model: "m" }),
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
        expect(getMessages()).toHaveLength(1);
      });

      // Run cleanup (simulates unmount)
      for (const fn of cleanupFns) fn();
      cleanupFns = [];

      // subscriptionRef should be null after cleanup
      expect(refSlots[0].current).toBeNull();

      controllerRef!.close();
    });
  });
});
