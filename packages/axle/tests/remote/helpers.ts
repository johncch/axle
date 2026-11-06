import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import type { AIProvider } from "../../src/protocols/types.js";
import { AxleStopReason } from "../../src/protocols/types.js";
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

export function sendCommand(id: string, prompt: string) {
  return { type: "send" as const, id, instruct: new Instruct({ prompt, vars: "optional" }).toJSON() };
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
