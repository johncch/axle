import { AnyStreamChunk } from "../../messages/streaming/types.js";
import { AxleMessage } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { ToolDefinition } from "../../tools/types.js";
import { createOllamaStreamingAdapter } from "./createStreamingAdapter.js";
import { convertAxleMessagesToOllama, convertToolDefToOllama } from "./utils.js";

export async function* createStreamingRequest(params: {
  url: string;
  model: string;
  messages: Array<AxleMessage>;
  tools?: Array<ToolDefinition>;
  runtime: { recorder?: Recorder };
}): AsyncGenerator<AnyStreamChunk, void, unknown> {
  const { url, model, messages, tools, runtime } = params;
  const { recorder } = runtime;

  const chatTools = convertToolDefToOllama(tools);

  const requestBody = {
    model,
    messages: convertAxleMessagesToOllama(messages),
    stream: true,
    options: {
      temperature: 0.7,
    },
    ...(chatTools && { tools: chatTools }),
  };

  recorder?.debug?.log(requestBody);

  const streamingAdapter = createOllamaStreamingAdapter();

  try {
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const chunk = JSON.parse(line);
          const streamChunks = streamingAdapter.handleChunk(chunk);
          for (const streamChunk of streamChunks) {
            yield streamChunk;
          }
        } catch (e) {
          recorder?.error?.log("Error parsing Ollama stream chunk:", e, line);
        }
      }
    }
  } catch (error) {
    recorder?.error?.log("Error in Ollama streaming request:", error);
    yield {
      type: "error",
      data: {
        type: "STREAMING_ERROR",
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      },
    };
  }
}
