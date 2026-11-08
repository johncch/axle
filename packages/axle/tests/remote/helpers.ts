import * as z from "zod";
import type { Agent } from "../../src/core/agent/Agent.js";
import { Instruct } from "../../src/core/Instruct.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
import type { InMemoryEventStore } from "../../src/remote/eventStore.js";
import { loopbackTransport } from "../../src/remote/loopback.js";
import type { AgentCommand, CommandOutcome } from "../../src/remote/protocol.js";
import type { RemoteAgent } from "../../src/remote/RemoteAgent.js";
import type { DeferredTool } from "../../src/tools/types.js";

export const askUser = {
  type: "deferred",
  name: "ask-user",
  description: "Ask the person a question",
  schema: z.object({ question: z.string() }),
} satisfies DeferredTool;

/** Every request: one text response, taken from `texts` in order. */
export function textProvider(texts: string[]): AIProvider {
  let requestCount = 0;
  return {
    protocol: "chatCompletions",
    id: "text",
    async *createStreamingRequest(): AsyncGenerator<AnyStreamChunk, void> {
      const text = texts[Math.min(requestCount, texts.length - 1)];
      requestCount += 1;
      yield { type: "start", id: `r${requestCount}`, data: { model: "mock", timestamp: 0 } };
      yield { type: "text-start", data: { index: 0 } };
      yield { type: "text-delta", data: { index: 0, text } };
      yield { type: "text-complete", data: { index: 0 } };
      yield {
        type: "complete",
        data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
      };
    },
  };
}

/**
 * First request: one `ask-user` call with id `c1`. Every later request:
 * text echoing the tool result it was sent as `name=content[!]`.
 */
export function askUserProvider(question = "colour?"): AIProvider {
  let requestCount = 0;
  return {
    protocol: "chatCompletions",
    id: "ask-user",
    async *createStreamingRequest(_model, { messages }): AsyncGenerator<AnyStreamChunk, void> {
      requestCount += 1;
      yield { type: "start", id: `r${requestCount}`, data: { model: "mock", timestamp: 0 } };
      if (requestCount === 1) {
        yield { type: "tool-call-start", data: { index: 0, id: "c1", name: "ask-user" } };
        yield {
          type: "tool-call-complete",
          data: { index: 0, id: "c1", name: "ask-user", arguments: { question } },
        };
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
}

export function sendCommand(id: string, prompt: string): AgentCommand {
  return { type: "send", id, prompt };
}

/** The host's part in these tests: each command becomes one agent call. */
export async function applyCommand<THostEvent extends { type: string }>(
  agent: Agent | RemoteAgent<THostEvent>,
  command: AgentCommand,
): Promise<CommandOutcome> {
  switch (command.type) {
    case "send": {
      const instruct = new Instruct({ prompt: command.prompt, vars: "optional" });
      for (const file of command.files ?? []) instruct.addFile(file);
      agent.send(instruct, { id: command.id, metadata: command.metadata }).final.catch(() => {});
      return { accepted: true };
    }
    case "answer":
    case "fail": {
      const call = agent.toolCall(command.callId);
      if (!call) {
        return {
          accepted: false,
          reason: { type: "not-waiting", message: `No waiting call ${command.callId}` },
        };
      }
      if (command.type === "answer") await call.answer(command.content);
      else await call.fail(command.message);
      return { accepted: true };
    }
    case "cancel":
    case "stop": {
      const took = command.type === "cancel" ? await agent.cancel() : await agent.stop();
      return took
        ? { accepted: true }
        : { accepted: false, reason: { type: "idle", message: "No active turn" } };
    }
    case "clear":
      await agent.clear();
      return { accepted: true };
  }
}

export function served<THostEvent extends { type: string } = never>(
  agent: Agent | RemoteAgent<THostEvent>,
  store: InMemoryEventStore<THostEvent>,
) {
  return loopbackTransport(store, (command) => applyCommand(agent, command));
}

export function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}
