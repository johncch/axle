import { describe, expect, test, vi } from "vitest";
import * as z from "zod";
import { Agent } from "../../src/core/agent/index.js";
import { Instruct } from "../../src/core/Instruct.js";
import type { AnyStreamChunk } from "../../src/messages/stream.js";
import { convertAxleMessages } from "../../src/providers/chatcompletions/utils.js";
import { convertAxleMessagesToGemini } from "../../src/providers/gemini/utils.js";
import { convertAxleMessageToResponseInput } from "../../src/providers/openai/utils.js";
import type { AIProvider } from "../../src/providers/types.js";
import { AxleStopReason } from "../../src/providers/types.js";
import type { ExecutableTool } from "../../src/tools/types.js";
import type { TurnEvent } from "../../src/turns/events.js";
import type { FileInfo, FileResolver } from "../../src/utils/file.js";

describe("deferred file resolution", () => {
  test("resolves refs only during provider conversion and does not leak into history or events", async () => {
    const resolvedUrl = "https://signed.example/private-image.png?token=secret";
    const events: TurnEvent[] = [];
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
          fileResolver: params.runtime.fileResolver,
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

  test("re-resolves deferred tool-result files from history on later turns", async () => {
    const schema = z.object({});
    const readFileTool: ExecutableTool<typeof schema> = {
      name: "read_file",
      description: "Read a deferred text file.",
      schema,
      async execute() {
        return [
          {
            type: "file",
            file: {
              kind: "text",
              mimeType: "text/plain",
              name: "note.txt",
              source: { type: "ref", ref: { id: "note-1" } },
            },
          },
        ];
      },
    };

    let resolutionCount = 0;
    const fileResolver = vi.fn(async (request: Parameters<FileResolver>[0]) => {
      resolutionCount += 1;
      expect(request.ref).toEqual({ id: "note-1" });
      return { type: "text" as const, content: `resolved-content-${resolutionCount}` };
    });

    let requestCount = 0;
    const providerInputs: unknown[] = [];
    const provider: AIProvider = {
      name: "test-tool-result-replay",
      async createGenerationRequest() {
        throw new Error("not used");
      },
      async *createStreamingRequest(model, params): AsyncGenerator<AnyStreamChunk, void, unknown> {
        requestCount += 1;
        providerInputs.push(
          await convertAxleMessageToResponseInput(params.messages, {
            model,
            fileResolver: params.runtime.fileResolver,
            signal: params.signal,
          }),
        );

        yield {
          type: "start",
          id: `turn-${requestCount}`,
          data: { model, timestamp: Date.now() },
        };

        if (requestCount === 1) {
          yield {
            type: "tool-call-start",
            data: { index: 0, id: "call-1", name: "read_file" },
          };
          yield {
            type: "tool-call-complete",
            data: { index: 0, id: "call-1", name: "read_file", arguments: {} },
          };
          yield {
            type: "complete",
            data: { finishReason: AxleStopReason.FunctionCall, usage: { in: 1, out: 1 } },
          };
          return;
        }

        yield { type: "text-start", data: { index: 0 } };
        yield { type: "text-delta", data: { index: 0, text: "done" } };
        yield { type: "text-complete", data: { index: 0 } };
        yield {
          type: "complete",
          data: { finishReason: AxleStopReason.Stop, usage: { in: 1, out: 1 } },
        };
      },
    };

    const agent = new Agent({
      provider,
      model: "test-model",
      fileResolver,
      tools: [readFileTool],
    });

    await agent.send("Read the file.").final;
    await agent.send("Use the previous file result again.").final;

    expect(fileResolver).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(providerInputs[1])).toContain("resolved-content-1");
    expect(JSON.stringify(providerInputs[2])).toContain("resolved-content-2");

    const snapshotJson = JSON.stringify(agent.snapshot());
    expect(snapshotJson).toContain('"type":"ref"');
    expect(snapshotJson).toContain('"id":"note-1"');
    expect(snapshotJson).not.toContain("resolved-content-");
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
          fileResolver: params.runtime.fileResolver,
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

  test("rejects PDF file parts before sending them to Together", async () => {
    const file: FileInfo = {
      kind: "document",
      mimeType: "application/pdf",
      name: "paper.pdf",
      source: { type: "url", url: "https://example.com/paper.pdf" },
    };

    await expect(
      convertAxleMessages(
        [
          {
            role: "user",
            content: [{ type: "file", file }],
          },
        ],
        undefined,
        { model: "test-model", providerDialect: "together" },
      ),
    ).rejects.toThrow("Together Chat Completions does not support PDF file parts");
  });
});
