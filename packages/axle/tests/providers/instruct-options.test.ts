import {
  startChunk,
  textStartChunk,
  textChunk,
  textCompleteChunk,
  completeChunk,
} from "../scenarios/helpers/chunks.js";
import { describe, expect, expectTypeOf, test } from "vitest";
import * as z from "zod";
import { Instruct } from "../../src/core/Instruct.js";
import type { AxleMessage } from "../../src/messages/message.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { generate } from "../../src/providers/generate.js";
import { stream } from "../../src/providers/stream.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";

describe("Instruct options", () => {
  test("generate() appends instruct as latest user turn and returns parsed response", async () => {
    const requests: AxleMessage[][] = [];
    const provider = makeStreamProvider(requests, [
      startChunk(),
      textStartChunk(0),
      textChunk(0, '{"answer":"yes"}'),
      textCompleteChunk(0),
      completeChunk(AxleStopReason.Stop, { in: 4, out: 5 }),
    ]);

    const instruct = new Instruct({
      prompt: "Answer {{question}}",
      schema: z.object({
        answer: z.string(),
      }),
    }).withInput("question", "now?");

    const result = await generate({
      provider,
      model: "test-model",
      messages: [{ role: "user", content: "prior context" }],
      instruct,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectTypeOf(result.response).toEqualTypeOf<{ answer: string }>();
    expect(result.response).toEqual({ answer: "yes" });
    expect(requests[0]).toHaveLength(2);
    expect(requests[0][0]).toMatchObject({ role: "user", content: "prior context" });
    expect(JSON.stringify(requests[0][1])).toContain("Answer now?");
    expect(JSON.stringify(requests[0][1])).toContain("answer");
  });

  test("generate() returns raw final content when instruct parsing fails", async () => {
    const requests: AxleMessage[][] = [];
    const provider = makeStreamProvider(requests, [
      startChunk(),
      textStartChunk(0),
      textChunk(0, '{"answer":"unterminated}'),
      textCompleteChunk(0),
      completeChunk(AxleStopReason.Stop, { in: 4, out: 5 }),
    ]);

    const result = await generate({
      provider,
      model: "test-model",
      instruct: new Instruct({
        prompt: "Answer",
        schema: z.object({ answer: z.string() }),
      }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("parse");
    expect(result.final?.content).toEqual([{ type: "text", text: '{"answer":"unterminated}' }]);
  });

  test("stream() appends instruct as latest user turn and returns parsed response", async () => {
    const requests: AxleMessage[][] = [];
    const chunks: AnyStreamChunk[] = [
      { type: "start", id: "msg_1", data: { model: "test-model", timestamp: Date.now() } },
      { type: "text-start", data: { index: 0 } },
      { type: "text-delta", data: { index: 0, text: '{"count":3}' } },
      { type: "text-complete", data: { index: 0 } },
      { type: "complete", data: { finishReason: AxleStopReason.Stop, usage: { in: 4, out: 5 } } },
    ];
    const provider = makeStreamProvider(requests, chunks);
    const instruct = new Instruct({
      prompt: "Count {{thing}}",
      schema: z.object({
        count: z.number(),
      }),
    }).withInput("thing", "items");

    const handle = stream({
      provider,
      model: "test-model",
      messages: [{ role: "assistant", id: "prev", content: [{ type: "text", text: "ok" }] }],
      instruct,
    });

    const result = await handle.final;

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expectTypeOf(result.response).toEqualTypeOf<{ count: number }>();
    expect(result.response).toEqual({ count: 3 });
    expect(requests[0]).toHaveLength(2);
    expect(requests[0][0]).toMatchObject({ role: "assistant", id: "prev" });
    expect(JSON.stringify(requests[0][1])).toContain("Count items");
    expect(JSON.stringify(requests[0][1])).toContain("count");
  });

  test("stream() returns raw final content when instruct parsing fails", async () => {
    const requests: AxleMessage[][] = [];
    const chunks: AnyStreamChunk[] = [
      { type: "start", id: "msg_1", data: { model: "test-model", timestamp: Date.now() } },
      { type: "text-start", data: { index: 0 } },
      { type: "text-delta", data: { index: 0, text: '{"count":' } },
      { type: "text-complete", data: { index: 0 } },
      { type: "complete", data: { finishReason: AxleStopReason.Stop, usage: { in: 4, out: 5 } } },
    ];
    const provider = makeStreamProvider(requests, chunks);

    const result = await stream({
      provider,
      model: "test-model",
      instruct: new Instruct({
        prompt: "Count",
        schema: z.object({ count: z.number() }),
      }),
    }).final;

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.kind).toBe("parse");
    expect(result.final?.content).toEqual([{ type: "text", text: '{"count":' }]);
  });
});

function makeStreamProvider(requests: AxleMessage[][], chunks: AnyStreamChunk[]): AIProvider {
  return {
    get name() {
      return "test";
    },
    async *createStreamingRequest(_model, params) {
      requests.push([...params.messages]);
      for (const chunk of chunks) yield chunk;
    },
  };
}
