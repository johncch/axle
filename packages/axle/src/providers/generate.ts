import { getAxleConfiguration, type AxleConfiguration } from "../config.js";
import { Instruct } from "../core/Instruct.js";
import type { OutputSchema } from "../core/parse.js";
import type { InstructResponse } from "../core/userTurn.js";
import { compileUserTurn } from "../core/userTurn.js";
import { AxleAbortError } from "../errors/AxleAbortError.js";
import { AxleToolFatalError } from "../errors/AxleToolFatalError.js";
import type { AxleAssistantMessage, AxleMessage } from "../messages/message.js";
import { getToolCalls } from "../messages/utils.js";
import type { Span } from "../observability/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ExecutableTool, ProviderTool } from "../tools/types.js";
import type { Stats } from "../types.js";
import { throwIfAborted } from "../utils/abort.js";
import type { FileResolver } from "../utils/file.js";
import { addStats, createStats, mergeStats, toTokenUsage } from "../utils/stats.js";
import { generateTurn } from "./generateTurn.js";
import {
  appendUsage,
  checkLoopStop,
  executeToolCalls,
  GenerateResult,
  logTurnContent,
  resolveToolRegistry,
  resolveTools,
  ToolCallCallback,
  validateLoopLimits,
} from "./helpers.js";
import { AIProvider, AxleModelRequestOptions, AxleStopReason, ModelResult } from "./types.js";

export type {
  GenerateError,
  GenerateResult,
  StreamResult,
  ToolCallCallback,
  ToolCallResult,
} from "./helpers.js";

export interface GenerateParams extends AxleModelRequestOptions {
  provider: AIProvider;
  model: string;
  messages: Array<AxleMessage>;
  system?: string;
  tools?: ExecutableTool[];
  providerTools?: ProviderTool[];
  registry?: ToolRegistry;
  onToolCall?: ToolCallCallback;
  maxIterations?: number;
  /**
   * Context budget for the tool loop, in tokens. Checked at each request
   * boundary against the previous model call's reported usage (effective
   * input + output); when crossed, the loop returns `stopped: "token-limit"`
   * with everything accumulated so far.
   */
  maxContextTokens?: number;
  span?: Span;
  fileResolver?: FileResolver;
}

export interface GenerateInstructParams<TSchema extends OutputSchema | undefined> extends Omit<
  GenerateParams,
  "messages"
> {
  messages?: Array<AxleMessage>;
  instruct: Instruct<TSchema>;
}

export type GenerateInstructResult<TSchema extends OutputSchema | undefined> = GenerateResult<
  InstructResponse<TSchema>
>;

export async function generate<TSchema extends OutputSchema | undefined>(
  options: GenerateInstructParams<TSchema>,
): Promise<GenerateInstructResult<TSchema>>;
export async function generate(options: GenerateParams): Promise<GenerateResult>;
export async function generate(
  options: GenerateParams | GenerateInstructParams<any>,
): Promise<GenerateResult | GenerateInstructResult<any>> {
  validateLoopLimits(options);
  if ("instruct" in options) {
    const { instruct, messages, ...rest } = options;
    const userTurn = compileUserTurn(instruct);
    const result = await runGenerate(
      {
        ...rest,
        messages: [...(messages ?? []), userTurn.message],
      },
      getAxleConfiguration(),
    );

    if (!result.ok) return result;
    try {
      return { ...result, response: userTurn.parse(result.final) as InstructResponse<any> };
    } catch (parseError) {
      return {
        ok: false,
        messages: result.messages,
        final: result.final,
        usage: result.usage,
        // A limit stop usually ends on a tool-call turn with no parseable
        // text; keep the stop marker so callers can distinguish "continuable,
        // limit tripped" from genuinely malformed output.
        ...(result.stopped ? { stopped: result.stopped } : {}),
        error: {
          kind: "parse",
          error: parseError,
          message: parseError instanceof Error ? parseError.message : String(parseError),
        },
      };
    }
  }

  return runGenerate(options, getAxleConfiguration());
}

async function runGenerate(
  options: GenerateParams,
  configuration: AxleConfiguration,
): Promise<GenerateResult> {
  const {
    provider,
    model,
    messages,
    system,
    onToolCall,
    maxIterations,
    maxContextTokens,
    span,
    fileResolver,
    reasoning,
    maxOutputTokens,
    temperature,
    topP,
    stop,
    toolChoice,
    parallelToolCalls,
    providerOptions,
    signal = new AbortController().signal,
  } = options;
  const registry = resolveToolRegistry(options);
  const resolvedTools = resolveTools(registry, {
    provider,
    model,
    span,
    configuration,
  });
  const workingMessages = [...messages];
  const newMessages: AxleMessage[] = [];
  const usage: Stats = createStats();

  let iterations = 0;
  let finalMessage: AxleAssistantMessage | undefined;

  const addMessage = (message: AxleMessage) => {
    workingMessages.push(message);
    newMessages.push(message);
  };

  const endWithResult = (result: GenerateResult): GenerateResult => {
    span?.setResult({
      kind: "llm",
      model,
      request: { messages },
      response: { content: result.ok ? result.final.content : null },
      usage: toTokenUsage(result.usage),
      finishReason: result.ok ? result.final.finishReason : undefined,
    });
    span?.end(result.ok ? "ok" : "error");
    return result;
  };

  const setTurnResult = (turnSpan: Span | undefined, response: ModelResult): void => {
    if (!turnSpan || response.type === "error") {
      turnSpan?.end("error");
      return;
    }
    turnSpan.setResult({
      kind: "llm",
      model: response.model ?? model,
      request: { messages: workingMessages },
      response: { content: response.content },
      usage: toTokenUsage(response.usage),
      finishReason: response.finishReason,
    });
    turnSpan.end();
  };

  try {
    while (true) {
      throwIfAborted(signal, "Generate aborted");

      iterations += 1;
      const turnSpan = span?.startSpan(`turn-${iterations}`, { type: "llm" });

      const executable = resolvedTools.executable();
      const tools =
        executable.length > 0
          ? executable.map((t) => ({ name: t.name, description: t.description, schema: t.schema }))
          : undefined;
      const providerTools = resolvedTools.provider();
      let response: ModelResult;
      try {
        response = await generateTurn({
          provider,
          model,
          messages: workingMessages,
          system,
          tools,
          providerTools: providerTools.length > 0 ? providerTools : undefined,
          span: turnSpan,
          fileResolver,
          reasoning,
          maxOutputTokens,
          temperature,
          topP,
          stop,
          toolChoice,
          parallelToolCalls,
          providerOptions,
          signal,
        });

        throwIfAborted(signal, "Generate aborted");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          turnSpan?.end("ok");
        }
        throw error;
      }

      appendUsage(usage, response, {
        provider: provider.name,
        model: response.type === "error" ? model : (response.model ?? model),
      });
      if (response.type !== "error") logTurnContent(turnSpan, response.content);
      setTurnResult(turnSpan, response);

      if (response.type === "error") {
        return endWithResult({
          ok: false,
          messages: newMessages,
          error: { kind: "model", error: response },
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
          ok: true,
          response: finalMessage,
          messages: newMessages,
          final: finalMessage,
          usage,
        });
      }

      const toolCalls = getToolCalls(response.content);
      if (toolCalls.length === 0) {
        return endWithResult({
          ok: true,
          response: finalMessage,
          messages: newMessages,
          final: finalMessage,
          usage,
        });
      }

      const { results, usage: toolUsage } = await executeToolCalls(
        toolCalls,
        onToolCall,
        signal,
        resolvedTools,
        span,
      );
      addStats(usage, toolUsage);
      throwIfAborted(signal, "Generate aborted");
      if (results.length > 0) {
        addMessage({ role: "tool", id: crypto.randomUUID(), content: results });
      }

      // Budget checks run after the turn settles so a limit stop always returns a complete exchange.
      const stopped = checkLoopStop(iterations, response.usage, {
        maxIterations,
        maxContextTokens,
      });
      if (stopped) {
        return endWithResult({
          ok: true,
          response: assistantMessage,
          messages: newMessages,
          final: assistantMessage,
          usage,
          stopped,
        });
      }
    }
  } catch (error) {
    if (error instanceof AxleToolFatalError) {
      span?.end("error");
      throw new AxleToolFatalError(error.message, {
        toolName: error.toolName,
        messages: error.messages ?? newMessages,
        partial: error.partial ?? finalMessage,
        usage: mergeStats(usage, error.usage),
        cause: error.cause,
      });
    }
    if (error instanceof AxleAbortError) {
      span?.end("ok");
      throw new AxleAbortError("Generate aborted", {
        reason: error.reason,
        messages: error.messages ?? newMessages,
        partial: error.partial,
        usage: mergeStats(usage, error.usage),
      });
    }
    if (error instanceof Error && error.name === "AbortError") {
      span?.end("ok");
      throw new AxleAbortError("Generate aborted", {
        reason: signal.reason,
        messages: newMessages,
        usage,
      });
    }
    throw error;
  }
}
