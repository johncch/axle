import * as z from "zod";
import { generate } from "../ai/generate.js";
import { AIProvider, AxleStopReason } from "../ai/types.js";
import { Instruct } from "../core/Instruct.js";
import { Conversation } from "../messages/conversation.js";
import {
  AxleToolCallResult,
  ContentPartToolCall,
} from "../messages/types.js";
import {
  getTextContent,
  getToolCalls,
  toContentParts,
} from "../messages/utils.js";
import { Recorder } from "../recorder/recorder.js";
import { LLMContext, ProgramOptions, TaskResult } from "../types.js";
import { Keys } from "../utils/variables.js";

type SchemaRecord = Record<string, z.ZodTypeAny>;

export class LLMExecutor {
  async execute<T extends SchemaRecord>(
    instruct: Instruct<T>,
    context: LLMContext,
  ): Promise<TaskResult> {
    const { conversation, provider, stats, variables, recorder } = context;
    const options = context.recorder?.options;

    if (instruct.system) {
      conversation.addSystem(instruct.system);
    }

    const { message, instructions } = instruct.compile(variables, {
      recorder,
      options,
    });
    const files = instruct.files;
    conversation.addUser(
      toContentParts({ text: instructions + message, files: files }),
    );

    if (options?.dryRun) {
      recorder?.debug?.log(conversation);
      return { outputs: {} };
    }

    let continueProcessing = true;
    let result: Record<string, unknown> | null = null;

    while (continueProcessing) {
      const response = await generate({
        provider,
        messages: conversation.messages,
        tools: Object.values(instruct.tools),
        recorder: recorder,
      });

      stats.in += response.usage.in;
      stats.out += response.usage.out;

      if (response.type === "error") {
        throw new Error(JSON.stringify(response.error));
      }

      if (response.type === "success") {
        switch (response.finishReason) {
          case AxleStopReason.Stop: {
            if (response.content) {
              const content = response.content;
              conversation.addAssistant({
                id: response.id,
                model: response.model,
                content: response.content,
                finishReason: response.finishReason,
              });
              const textContent = getTextContent(content);
              result = instruct.finalize(textContent, { recorder });
              continueProcessing = false;
            }
            break;
          }
          case AxleStopReason.Length: {
            throw new Error(
              "Incomplete model output due to `max_tokens` parameter or token limit",
            );
          }
          case AxleStopReason.FunctionCall: {
            if (response.content) {
              conversation.addAssistant({
                id: response.id,
                model: response.model,
                content: response.content,
                finishReason: response.finishReason,
              });
            }

            const toolCalls = getToolCalls(response.content);
            if (toolCalls && toolCalls.length > 0) {
              const results = await executeToolCalls(toolCalls, instruct, {
                recorder,
              });
              recorder?.debug?.log(results);
              conversation.addToolResults(results);
              continueProcessing = true;
            } else {
              continueProcessing = false;
            }
            break;
          }
        }
      }

      if (response.type !== "success") {
        recorder?.debug?.log(response);
        throw new Error("Unexpected response type");
      }
    }

    // Return outputs using getOutputs() method
    const outputs = instruct.getOutputs();

    // Also store in special _lastResult key for backward compatibility
    if (result) {
      outputs[Keys.LastResult] = result;
    }

    return { outputs };
  }
}

async function executeToolCalls<T extends SchemaRecord>(
  toolCalls: ContentPartToolCall[],
  instruct: Instruct<T>,
  runtime: { recorder?: Recorder } = {},
): Promise<AxleToolCallResult[]> {
  const { recorder } = runtime;
  const promises = [];
  for (const call of toolCalls) {
    promises.push(
      new Promise((resolve, reject) => {
        const tool = instruct.tools[call.name];
        if (!tool) {
          reject(`Tool not found: ${call.name}`);
          return;
        }
        recorder?.debug?.heading.log(`Executing tool ${tool.name}`);

        const args: Record<string, any> = call.parameters;

        tool
          .execute(args)
          .then((results) => {
            recorder?.debug?.log(`Complete tool ${tool.name}: ${call.id}`);
            resolve({
              id: call.id,
              name: call.name,
              content: JSON.stringify(results),
            });
          })
          .catch(reject);
      }),
    );
  }

  return Promise.all(promises);
}
