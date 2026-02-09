import type { AxleAssistantMessage, AxleMessage } from "../messages/types.js";
import { getToolCalls } from "../messages/utils.js";
import type { ToolDefinition } from "../tools/types.js";
import type { TracingContext } from "../tracer/types.js";
import type { Stats } from "../types.js";
import { generateTurn, GenerateTurnOptions } from "./generateTurn.js";
import { appendUsage, executeToolCalls, GenerateResult, ToolCallCallback } from "./helpers.js";
import { AIProvider, AxleStopReason, ModelResult } from "./types.js";

export type { GenerateError, GenerateResult, StreamResult, ToolCallCallback, ToolCallResult } from "./helpers.js";

export interface GenerateOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: Array<ToolDefinition>;
  onToolCall: ToolCallCallback;
  maxIterations?: number;
  tracer?: TracingContext;
  options?: GenerateTurnOptions;
}

export async function generate(options: GenerateOptions): Promise<GenerateResult> {
  const {
    provider,
    model,
    messages,
    system,
    tools,
    onToolCall,
    maxIterations,
    tracer,
    options: generateOptions,
  } = options;
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = { in: 0, out: 0 };

  let iterations = 0;
  let finalMessage: AxleAssistantMessage | undefined;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const endWithResult = (result: GenerateResult): GenerateResult => {
    tracer?.setResult({
      kind: "llm",
      model,
      request: { messages },
      response: { content: result.result === "success" ? result.final?.content : null },
      usage: result.usage
        ? { inputTokens: result.usage.in, outputTokens: result.usage.out }
        : undefined,
      finishReason: result.result === "success" ? result.final?.finishReason : undefined,
    });
    tracer?.end(result.result === "error" ? "error" : "ok");
    return result;
  };

  const setTurnResult = (turnSpan: TracingContext | undefined, response: ModelResult): void => {
    if (!turnSpan || response.type === "error") {
      turnSpan?.end("error");
      return;
    }
    turnSpan.setResult({
      kind: "llm",
      model: response.model ?? model,
      request: { messages: workingMessages },
      response: { content: response.content },
      usage: response.usage
        ? { inputTokens: response.usage.in, outputTokens: response.usage.out }
        : undefined,
      finishReason: response.finishReason,
    });
    turnSpan.end();
  };

  while (true) {
    if (maxIterations !== undefined && iterations >= maxIterations) {
      return endWithResult({
        result: "error",
        messages: newMessages,
        error: {
          type: "model",
          error: {
            type: "error",
            error: {
              type: "MaxIterations",
              message: `Exceeded max iterations (${maxIterations})`,
            },
          },
        },
        usage,
      });
    }

    iterations += 1;
    const turnSpan = tracer?.startSpan(`turn-${iterations}`, { type: "llm" });

    const response = await generateTurn({
      provider,
      model,
      messages: workingMessages,
      system,
      tools,
      tracer: turnSpan,
      options: generateOptions,
    });

    appendUsage(usage, response);
    setTurnResult(turnSpan, response);

    if (response.type === "error") {
      return endWithResult({
        result: "error",
        messages: newMessages,
        error: { type: "model", error: response },
        usage,
      });
    }

    const assistantMessage: AxleAssistantMessage = {
      role: "assistant",
      id: response.id,
      model: response.model,
      content: response.content,
      finishReason: response.finishReason,
    };
    addMessage(assistantMessage);
    finalMessage = assistantMessage;

    if (response.finishReason !== AxleStopReason.FunctionCall) {
      return endWithResult({
        result: "success",
        messages: newMessages,
        final: finalMessage,
        usage,
      });
    }

    const toolCalls = getToolCalls(response.content);
    if (toolCalls.length === 0) {
      return endWithResult({
        result: "success",
        messages: newMessages,
        final: finalMessage,
        usage,
      });
    }

    for (const call of toolCalls) {
      tracer?.info(`tool call: ${call.name}`, { parameters: call.parameters });
    }

    const { results, missingTool } = await executeToolCalls(toolCalls, onToolCall);
    if (results.length > 0) {
      addMessage({ role: "tool", content: results });
    }

    if (missingTool) {
      return endWithResult({
        result: "error",
        messages: newMessages,
        error: { type: "tool", error: missingTool },
        usage,
      });
    }
  }
}
