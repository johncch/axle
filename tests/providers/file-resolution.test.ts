import { describe, expect, test } from "vitest";
import { Agent } from "../../src/core/Agent.js";
import { Instruct } from "../../src/core/Instruct.js";
import { convertAxleMessages } from "../../src/providers/chatcompletions/utils.js";
import { convertAxleMessagesToGemini } from "../../src/providers/gemini/utils.js";
import { convertAxleMessageToResponseInput } from "../../src/providers/openai/utils.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import type { AgentEvent } from "../../src/turns/events.js";
import type { FileInfo, FileResolver } from "../../src/utils/file.js";

describe("deferred file resolution", () => {
  test("resolves refs only during provider conversion and does not leak into history or events", async () => {
    const resolvedUrl = "https://signed.example/private-image.png?token=secret";
    const events: AgentEvent[] = [];
    let providerInput: unknown;

    const fileResolver: FileResolver = async ({ accepted }) => {
      expect(accepted).toContain("url");
      return { type: "url", url: resolvedUrl };
    };

    const provider: AIProvider = {
      name: "test-openai-converter",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(model, params) {
        providerInput = await convertAxleMessageToResponseInput(params.messages, {
          model,
          fileResolver: params.context.fileResolver,
          signal: params.signal,
        });

        yield { type: "start", id: "turn-1", data: { model, timestamp: Date.now() } };
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { text: "done", index: 0 } };
        yield { type: "text-complete", data: { text: "done", index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };

    const agent = new Agent({ provider, model: "test-model", fileResolver });
    agent.on((event) => events.push(event));

    const file: FileInfo = {
      kind: "image",
      mimeType: "image/png",
      name: "private-image.png",
      source: { type: "ref", ref: { key: "private-image" } },
    };

    const instruct = new Instruct({ prompt: "Inspect this image" });
    instruct.addFile(file);

    await agent.send(instruct).final;

    expect(JSON.stringify(providerInput)).toContain(resolvedUrl);
    expect(JSON.stringify(agent.history.log)).not.toContain(resolvedUrl);
    expect(JSON.stringify(agent.history.turns)).not.toContain(resolvedUrl);
    expect(JSON.stringify(events)).not.toContain(resolvedUrl);
  });

  test("propagates AbortSignal from send through to the FileResolver", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;

    const fileResolver: FileResolver = async ({ signal }) => {
      receivedSignal = signal;
      return { type: "url", url: "https://example/x.png" };
    };

    const provider: AIProvider = {
      name: "test-signal",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(model, params) {
        await convertAxleMessageToResponseInput(params.messages, {
          model,
          fileResolver: params.context.fileResolver,
          signal: params.signal,
        });

        yield { type: "start", id: "turn-1", data: { model, timestamp: Date.now() } };
        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { text: "done", index: 0 } };
        yield { type: "text-complete", data: { text: "done", index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };

    const agent = new Agent({ provider, model: "test-model", fileResolver });
    const file: FileInfo = {
      kind: "image",
      mimeType: "image/png",
      name: "x.png",
      source: { type: "ref", ref: "x" },
    };

    const instruct = new Instruct({ prompt: "Inspect" });
    instruct.addFile(file);

    await agent.send(instruct, { signal: controller.signal }).final;

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(false);

    // Aborting the caller's controller propagates through the merged signal
    // that was handed to the resolver.
    controller.abort();
    expect(receivedSignal!.aborted).toBe(true);
  });

  test("preserves text file name and MIME type for Gemini text parts", async () => {
    const file: FileInfo = {
      kind: "text",
      mimeType: "text/csv",
      name: "customers.csv",
      source: { type: "text", content: "id,name\n1,Ada" },
    };

    const result = await convertAxleMessagesToGemini([
      {
        role: "user",
        content: [{ type: "file", file }],
      },
    ]);

    expect(result[0].parts?.[0]).toEqual({
      text: "File: customers.csv\nMIME type: text/csv\n\nid,name\n1,Ada",
    });
  });

  test("preserves text file name and MIME type for ChatCompletions text parts", async () => {
    const file: FileInfo = {
      kind: "text",
      mimeType: "application/json",
      name: "config.json",
      source: { type: "text", content: '{"enabled":true}' },
    };

    const result = await convertAxleMessages([
      {
        role: "user",
        content: [{ type: "file", file }],
      },
    ]);

    expect(result[0]).toEqual({
      role: "user",
      content: 'File: config.json\nMIME type: application/json\n\n{"enabled":true}',
    });
  });

  test("emits ChatCompletions PDF file parts using snake_case file_data", async () => {
    const file: FileInfo = {
      kind: "document",
      mimeType: "application/pdf",
      name: "paper.pdf",
      source: { type: "url", url: "https://example.com/paper.pdf" },
    };

    const result = await convertAxleMessages([
      {
        role: "user",
        content: [{ type: "file", file }],
      },
    ]);

    expect(result[0]).toEqual({
      role: "user",
      content: [
        {
          type: "file",
          file: {
            filename: "paper.pdf",
            file_data: "https://example.com/paper.pdf",
          },
        },
      ],
    });
  });
});
