import { describe, expect, expectTypeOf, test, vi } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { AxleAgentAbortError } from "../../src/errors/AxleAgentAbortError.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import { isActionOf, isCall } from "../../src/tools/deferred.js";
import type { DeferredTool, ToolContext } from "../../src/tools/types.js";
import { Transcript } from "../../src/turns/transcript.js";
import type { DeferredAction } from "../../src/turns/types.js";

const askUser = {
  type: "deferred",
  name: "ask-user",
  description: "Ask the person a question",
  schema: z.object({ question: z.string(), options: z.array(z.string()).optional() }),
} satisfies DeferredTool;

const readConfig = {
  type: "deferred",
  name: "read-config",
  description: "Read a setting where the consumer runs",
  schema: z.object({ key: z.string() }),
} satisfies DeferredTool;

const lookup = {
  name: "lookup",
  description: "Runs in the loop",
  schema: z.object({ id: z.number() }),
  async execute(input: { id: number }) {
    return `item ${input.id}`;
  },
};

interface ScriptedCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * First request: the scripted tool calls. Every later request: text echoing
 * the tool results it was sent as `name=content[!]`, so a test can read what
 * the model saw.
 */
function scriptedProvider(calls: ScriptedCall[]) {
  let requestCount = 0;
  const provider: AIProvider = {
    protocol: "chatCompletions",
    id: "scripted",
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      requestCount += 1;
      yield { type: "start", id: `r${requestCount}`, data: { model: "mock", timestamp: 0 } };
      if (requestCount === 1) {
        for (const [index, call] of calls.entries()) {
          yield { type: "tool-call-start", data: { index, id: call.id, name: call.name } };
          yield {
            type: "tool-call-complete",
            data: { index, id: call.id, name: call.name, arguments: call.args },
          };
        }
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 2 } },
        };
        return;
      }
      const toolMessage = messages.findLast((message) => message.role === "tool");
      const saw =
        toolMessage?.role === "tool"
          ? toolMessage.content
              .map((result) => `${result.name}=${result.content}${result.isError ? "!" : ""}`)
              .join(";")
          : "";
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text: `saw ${saw}` } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 3, out: 4 } },
      };
    },
  };
  return {
    provider,
    get requestCount() {
      return requestCount;
    },
  };
}

function deferredParts(transcript: Transcript): DeferredAction[] {
  return transcript.turns
    .flatMap((turn) => turn.parts)
    .filter((part): part is DeferredAction => part.type === "action" && part.kind === "deferred");
}

describe("Agent deferred tools", () => {
  test("offers the deferred tool, waits for onToolCall, and the model sees the answer", async () => {
    const script = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider: script.provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);
    const seen: string[] = [];

    agent.onToolCall((call) => {
      if (isCall(askUser, call)) {
        expectTypeOf(call.input.question).toEqualTypeOf<string>();
        seen.push(call.id);
        return `answered ${call.input.question}`;
      }
    });

    const result = await agent.send("go").final;

    expect(result.ok && result.response).toBe("saw ask-user=answered Colour?");
    expect(seen).toEqual(["c1"]);
    expect(script.requestCount).toBe(2);
    const [part] = deferredParts(transcript);
    expect(part).toMatchObject({
      status: "complete",
      detail: {
        name: "ask-user",
        callId: "c1",
        input: { question: "Colour?" },
        result: { type: "success", content: "answered Colour?" },
      },
    });
    expect(agent.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  test("a batch mixing executable and deferred calls answers in request order", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Which?" } },
      { id: "c2", name: "lookup", args: { id: 7 } },
      { id: "c3", name: "read-config", args: { key: "theme" } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [lookup, askUser, readConfig] });
    agent.onToolCall(async (call) => {
      if (isCall(askUser, call)) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "B";
      }
      if (isCall(readConfig, call)) return JSON.stringify({ [call.input.key]: "dark" });
    });

    const result = await agent.send("go").final;

    expect(result.ok && result.response).toBe(
      'saw ask-user=B;lookup=item 7;read-config={"theme":"dark"}',
    );
  });

  test("with no handler the call waits, and agent.toolCall(id).answer settles it", async () => {
    const script = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider: script.provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);

    const handle = agent.send("go");
    expect(agent.toolCall("c1")).toBeUndefined();
    await vi.waitFor(() => expect(deferredParts(transcript)[0]?.status).toBe("waiting"));
    expect(script.requestCount).toBe(1);
    agent.toolCall("c1")?.answer("teal");

    const result = await handle.final;
    expect(result.ok && result.response).toBe("saw ask-user=teal");
    expect(agent.toolCall("c1")).toBeUndefined();
    expect(deferredParts(transcript)[0]).toMatchObject({
      status: "complete",
      detail: { result: { type: "success", content: "teal" } },
    });
  });

  test("agent.toolCall(id).fail gives the model an execution error with the message", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);

    const handle = agent.send("go");
    await vi.waitFor(() => expect(deferredParts(transcript)[0]?.status).toBe("waiting"));
    agent.toolCall("c1")?.fail("nobody is here");

    const result = await handle.final;
    expect(result.ok && result.response).toBe(
      'saw ask-user={"error":{"type":"execution","message":"nobody is here"}}!',
    );
  });

  test("an outside answer wins over a pending handler, which sees its signal abort", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);
    let handlerContext: ToolContext | undefined;
    let late!: (value: string) => void;
    agent.onToolCall((_call, ctx) => {
      handlerContext = ctx;
      return new Promise<string>((resolve) => (late = resolve));
    });

    const handle = agent.send("go");
    await vi.waitFor(() => expect(handlerContext).toBeDefined());
    const waiting = agent.toolCall("c1");
    waiting?.answer("from the other tab");
    expect(handlerContext?.signal.aborted).toBe(true);
    late("from the prompt");
    waiting?.answer("again");

    const result = await handle.final;
    expect(result.ok && result.response).toBe("saw ask-user=from the other tab");
    expect(agent.messages.filter((message) => message.role === "tool")).toHaveLength(1);
  });

  test("action:waiting carries the call id and name", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [askUser] });
    const waiting: Array<{ callId: string; name: string }> = [];
    agent.on((event) => {
      if (event.type === "action:waiting") waiting.push({ callId: event.callId, name: event.name });
    });
    agent.onToolCall(() => "x");

    await agent.send("go").final;

    expect(waiting).toEqual([{ callId: "c1", name: "ask-user" }]);
  });

  test("a thrown error reaches the model as an execution error with its message", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [askUser] });
    agent.onToolCall(() => {
      throw new Error("User dismissed the prompt");
    });

    const result = await agent.send("go").final;

    expect(result.ok && result.response).toBe(
      'saw ask-user={"error":{"type":"execution","message":"User dismissed the prompt"}}!',
    );
  });

  test("a second onToolCall replaces the first, and a stale remover does nothing", async () => {
    const script = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider: script.provider, model: "mock", tools: [askUser] });
    const offFirst = agent.onToolCall(() => "first");
    agent.onToolCall(() => "second");
    offFirst();

    const result = await agent.send("go").final;

    expect(result.ok && result.response).toBe("saw ask-user=second");
  });

  test("cancel() while a call is waiting cancels the turn and aborts the handler's signal", async () => {
    const script = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider: script.provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);
    let handlerContext: ToolContext | undefined;
    agent.onToolCall((_call, ctx) => {
      handlerContext = ctx;
      return new Promise<string>(() => {});
    });

    const final = agent.send("go").final.catch((error) => error);
    await vi.waitFor(() => expect(deferredParts(transcript)[0]?.status).toBe("waiting"));
    expect(agent.cancel()).toBe(true);

    expect(await final).toBeInstanceOf(AxleAgentAbortError);
    expect(handlerContext?.signal.aborted).toBe(true);
    expect(transcript.turns.at(-1)?.status).toBe("cancelled");
    expect(deferredParts(transcript)[0]?.status).toBe("cancelled");
    expect(script.requestCount).toBe(1);
    expect(agent.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  test("stop() while a call is waiting lets the answer arrive, commits it, and makes no further request", async () => {
    const script = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const agent = new Agent({ provider: script.provider, model: "mock", tools: [askUser] });
    const transcript = new Transcript();
    agent.on(transcript.apply);
    let answer!: (value: string) => void;
    agent.onToolCall(() => new Promise<string>((resolve) => (answer = resolve)));

    const handle = agent.send("go");
    await vi.waitFor(() => expect(deferredParts(transcript)[0]?.status).toBe("waiting"));
    expect(agent.stop()).toBe(true);
    answer("blue");

    const result = await handle.final;
    expect(result.ok && result.turn?.status).toBe("complete");
    expect(script.requestCount).toBe(1);
    expect(agent.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(deferredParts(transcript)[0]).toMatchObject({
      status: "complete",
      detail: { result: { type: "success", content: "blue" } },
    });
  });

  test("the tool's timeout settles the call, the turn continues, and a late answer is dropped", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?" } },
    ]);
    const slowAsk = { ...askUser, timeout: 20 };
    const agent = new Agent({ provider, model: "mock", tools: [slowAsk] });
    let answer!: (value: string) => void;
    agent.onToolCall(() => new Promise<string>((resolve) => (answer = resolve)));

    const result = await agent.send("go").final;
    answer("too late");

    expect(result.ok && result.response).toBe(
      'saw ask-user={"error":{"type":"timeout","message":"No answer for ask-user within 20ms"}}!',
    );
    expect(agent.messages.filter((message) => message.role === "tool")).toHaveLength(1);
  });

  test("isActionOf narrows a transcript part to one tool once it is waiting", async () => {
    const { provider } = scriptedProvider([
      { id: "c1", name: "ask-user", args: { question: "Colour?", options: ["red", "blue"] } },
    ]);
    const agent = new Agent({ provider, model: "mock", tools: [askUser, readConfig] });
    const transcript = new Transcript();
    agent.on(transcript.apply);
    agent.onToolCall(() => "blue");
    await agent.send("go").final;

    const parts = transcript.turns.flatMap((turn) => turn.parts);
    const matched = parts.filter((part) => isActionOf(askUser, part));
    expect(matched).toHaveLength(1);
    if (isActionOf(askUser, parts[0])) {
      expectTypeOf(parts[0].detail.input.options).toEqualTypeOf<string[] | undefined>();
      expect(parts[0].detail.input.options).toEqual(["red", "blue"]);
    }
    expect(parts.some((part) => isActionOf(readConfig, part))).toBe(false);
    expect(
      isActionOf(askUser, {
        id: "p",
        type: "action",
        kind: "deferred",
        status: "pending",
        detail: { name: "ask-user", callId: "x", input: {} },
      }),
    ).toBe(false);
  });

  test("context() counts deferred tool definitions", () => {
    const provider = scriptedProvider([]).provider;
    const without = new Agent({ provider, model: "mock" }).context();
    const withDeferred = new Agent({ provider, model: "mock", tools: [askUser] }).context();
    expect(withDeferred.tools).toBeGreaterThan(without.tools);
  });
});
