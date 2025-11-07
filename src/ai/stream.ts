import { AnyStreamChunk } from "../messages/streaming/types.js";
import { AxleAssistantMessage, AxleMessage } from "../messages/types.js";
import { Recorder } from "../recorder/recorder.js";
import { ToolDefinition } from "../tools/types.js";
import { StreamParts } from "./streamparts.js";
import { AIProvider } from "./types.js";

interface StreamProps {
  provider: AIProvider;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  recorder?: Recorder;
}

export interface StreamResult {
  get message(): Promise<AxleAssistantMessage>;
  get current(): AxleAssistantMessage;
  [Symbol.asyncIterator](): AsyncIterator<AnyStreamChunk>;
}

export function stream(props: StreamProps): StreamResult {
  const { provider, messages, tools, recorder } = props;
  const streamSource = provider.createStreamingRequest?.({
    messages,
    tools,
    context: { recorder },
  });

  console.log(streamSource);
  return new StreamResultImpl(streamSource);
}

class StreamResultImpl implements StreamResult {
  private streamParts: StreamParts;
  private messagePromise: Promise<AxleAssistantMessage>;
  private resolveMessage?: (message: AxleAssistantMessage) => void;
  private rejectMessage?: (error: Error) => void;
  private chunkListeners = new Set<(chunk: AnyStreamChunk) => void>();
  private processingStarted = false;

  constructor(private streamSource: AsyncIterable<AnyStreamChunk, void, unknown>) {
    this.streamParts = new StreamParts();

    this.messagePromise = new Promise((resolve, reject) => {
      this.resolveMessage = resolve;
      this.rejectMessage = reject;
    });

    this.streamParts.on("complete", (message) => {
      this.resolveMessage?.(message);
    });

    this.startProcessing();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AnyStreamChunk> {
    const chunks: AnyStreamChunk[] = [];
    let resolveNext: ((chunk: AnyStreamChunk | null) => void) | null = null;
    let isComplete = false;

    // Listen to chunks as they're processed
    const listener = (chunk: AnyStreamChunk) => {
      if (resolveNext) {
        resolveNext(chunk);
        resolveNext = null;
      } else {
        chunks.push(chunk);
      }
    };

    this.chunkListeners.add(listener);

    try {
      while (!isComplete) {
        let chunk: AnyStreamChunk | null;

        if (chunks.length > 0) {
          chunk = chunks.shift()!;
        } else {
          chunk = await new Promise<AnyStreamChunk | null>((resolve) => {
            resolveNext = resolve;
          });
        }

        if (chunk === null) {
          isComplete = true;
        } else {
          yield chunk;
          if (chunk.type === "complete" || chunk.type === "error") {
            isComplete = true;
          }
        }
      }
    } finally {
      this.chunkListeners.delete(listener);
    }
  }

  private async startProcessing(): Promise<void> {
    if (this.processingStarted) return;
    this.processingStarted = true;

    try {
      for await (const chunk of this.streamSource) {
        // Broadcast chunk to async iterators
        this.chunkListeners.forEach((listener) => listener(chunk));

        // Process chunk internally
        switch (chunk.type) {
          case "start":
            this.streamParts.start(chunk.id, chunk.data.model);
            break;

          case "text":
            const textIndex = chunk.data.index;
            if (textIndex >= this.streamParts.partsLength) {
              this.streamParts.createText(textIndex, chunk.data.text);
            } else {
              this.streamParts.updateText(textIndex, chunk.data.text);
            }
            break;

          case "thinking-start":
            this.streamParts.createThinking(chunk.data.index, "");
            break;

          case "thinking-delta":
            this.streamParts.updateThinking(chunk.data.index, chunk.data.text);
            break;

          case "tool-call-start":
            this.streamParts.createToolCall(chunk.data.index, chunk.data.id, chunk.data.name);
            break;

          case "tool-call-complete":
            this.streamParts.completeToolCall(chunk.data.index, chunk.data.arguments);
            break;

          case "complete":
            this.streamParts.complete(chunk.data.finishReason, chunk.data.usage);
            break;

          case "error":
            this.rejectMessage?.(new Error(chunk.data.error));
            return;
        }
      }
    } catch (error) {
      this.rejectMessage?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.chunkListeners.forEach((listener) => listener(null as any));
    }
  }

  get message(): Promise<AxleAssistantMessage> {
    return this.messagePromise;
  }

  get current(): AxleAssistantMessage {
    return this.streamParts.currentMessage;
  }
}
