import * as z from "zod";
import { generate } from "../../ai/generate.js";
import { AIProvider, AxleStopReason } from "../../ai/types.js";
import { Instruct } from "../../core/Instruct.js";
import { Chat, getTextContent } from "../../messages/chat.js";
import { AxleToolCallResult, ContentPartToolCall } from "../../messages/types.js";
import { Recorder } from "../../recorder/recorder.js";
import { TaskHandler } from "../../registry/taskHandler.js";
import { ProgramOptions, Stats } from "../../types.js";
import { Keys, setResultsIntoVariables } from "../../utils/variables.js";

type SchemaRecord = Record<string, z.ZodTypeAny>;

export class ChatTaskHandler<T extends SchemaRecord> implements TaskHandler<Instruct<T>> {
  readonly taskType = "instruct";

  canHandle(task: any): task is Instruct<T> {
    return task && typeof task === "object" && "type" in task && task.type === "instruct";
  }

  async execute(params: {
    task: Instruct<T>;
    chat: Chat;
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
  }): Promise<void> {
    const { task, ...rest } = params;
    await executeChatAction({
      instruct: task,
      ...rest,
    });
  }
}

export async function executeChatAction<T extends SchemaRecord>(params: {
  instruct: Instruct<T>;
  chat: Chat;
  provider: AIProvider;
  stats?: Stats;
  variables: Record<string, any>;
  options?: ProgramOptions;
  recorder?: Recorder;
}) {
  const { instruct, chat, provider, stats, variables, options, recorder } = params;

  if (instruct.system) {
    chat.addSystem(instruct.system);
  }
  const { message, instructions } = instruct.compile(variables, {
    recorder,
    options,
  });
  if (instruct.hasFiles()) {
    chat.addUser(message, instructions, instruct.files);
  } else {
    chat.addUser(message, instructions);
  }
  if (instruct.hasTools()) {
    chat.setTools(Object.values(instruct.tools));
  }

  if (options?.dryRun) {
    recorder?.debug?.log(chat);
    return { action: "complete" };
  }

  let continueProcessing = true;
  while (continueProcessing) {
    const response = await generate({
      provider,
      messages: chat.messages,
      tools: chat.tools,
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
            chat.addAssistant({
              id: response.id,
              model: response.model,
              content: response.content,
              finishReason: response.finishReason,
            });
            const textContent = getTextContent(content);
            chat.addAssistant(textContent);
            const result = instruct.finalize(textContent, { recorder });
            setResultsIntoVariables(result as Record<string, unknown>, variables, {
              options,
              recorder,
            });
            variables[Keys.LastResult] = result;
          }
          continueProcessing = false;
          return { action: "continue" };
        }
        case AxleStopReason.Length: {
          throw new Error("Incomplete model output due to `max_tokens` parameter or token limit");
        }
        case AxleStopReason.FunctionCall: {
          if (response.content) {
            chat.addAssistant({
              id: response.id,
              model: response.model,
              content: response.content,
              finishReason: response.finishReason,
              toolCalls: response.toolCalls,
            });
          }

          if (response.toolCalls && response.toolCalls.length > 0) {
            const results = await executeToolCalls(response.toolCalls, instruct, { recorder });
            recorder?.debug?.log(results);
            chat.addTools(results);

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

  return { action: "continue" };
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
