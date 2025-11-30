import type { Action, WorkflowStep } from "../actions/types.js";
import { generate } from "../ai/generate.js";
import type { AIProvider } from "../ai/types.js";
import { AxleStopReason } from "../ai/types.js";
import type { SerialJob } from "../cli/configs/schemas.js";
import { configToTasks } from "../cli/utils.js";
import { Instruct } from "../core/Instruct.js";
import { AxleError } from "../errors/AxleError.js";
import { TaskError } from "../errors/TaskError.js";
import { Conversation } from "../messages/conversation.js";
import type { AxleToolCallResult, ContentPartToolCall } from "../messages/types.js";
import { getTextContent, getToolCalls, toContentParts } from "../messages/utils.js";
import type { Recorder } from "../recorder/recorder.js";
import { TaskStatus } from "../recorder/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
import { friendly } from "../utils/utils.js";
import { setResultsIntoVariables } from "../utils/variables.js";
import type { WorkflowExecutable, WorkflowResult } from "./types.js";

interface SerialWorkflow {
  (jobConfig: SerialJob): WorkflowExecutable;
  (...steps: WorkflowStep[]): WorkflowExecutable;
}

/**
 * Type guard to check if the input is a SerialJob
 */
function isSerialJob(obj: SerialJob | WorkflowStep): obj is SerialJob {
  return "steps" in obj && "type" in obj && obj.type === "serial";
}

export const serialWorkflow: SerialWorkflow = (
  first: SerialJob | WorkflowStep,
  ...rest: WorkflowStep[]
) => {
  const prepare = async (context: { recorder?: Recorder }): Promise<WorkflowStep[]> => {
    const { recorder } = context;

    if (isSerialJob(first)) {
      return await configToTasks(first, { recorder });
    } else {
      return [first, ...rest];
    }
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
    name?: string;
  }): Promise<WorkflowResult> => {
    const { provider, variables, options, stats, recorder, name } = context;
    const id = crypto.randomUUID();

    recorder?.info?.log({
      type: "task",
      id,
      status: TaskStatus.Running,
      message: `[${friendly(id, name)}] Starting job`,
    });

    try {
      const steps = await prepare({ recorder });
      const conversation = new Conversation();

      for (const [index, step] of steps.entries()) {
        recorder?.info?.log({
          type: "task",
          id,
          status: TaskStatus.Running,
          message: `[${friendly(id, name)}] Processing step ${index + 1}: ${step.name}`,
        });

        try {
          if (step instanceof Instruct) {
            await executeInstruct(step, {
              conversation,
              provider,
              stats,
              variables,
              options,
              recorder,
            });
          } else {
            await executeAction(step, { variables, options, recorder });
          }
        } catch (error) {
          const taskError =
            error instanceof AxleError
              ? error
              : new TaskError(`Error executing step ${step.name}`, {
                  id: id,
                  taskType: step.name,
                  taskIndex: index,
                  cause: error instanceof Error ? error : new Error(String(error)),
                });
          throw taskError;
        }
      }

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Success,
        id,
        message: `[${friendly(id, name)}] Completed ${steps.length} steps`,
      });

      return createResult(variables.$previous, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`Serial workflow execution failed`, {
              id: id,
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Fail,
        id,
        message: `[${friendly(id, name)}] Failed: ${axleError.message}`,
      });
      recorder?.error.log(axleError);

      return createErrorResult(axleError, variables.$previous, stats);
    }
  };

  return { execute };
};

function deriveInput(previous: Record<string, any> | undefined): string {
  if (!previous) return "";
  if (previous.response !== undefined) return String(previous.response);
  return JSON.stringify(previous);
}

async function executeAction(
  action: Action,
  context: {
    variables: Record<string, any>;
    options?: ProgramOptions;
    recorder?: Recorder;
  },
): Promise<void> {
  const { variables, options, recorder } = context;

  const input = deriveInput(variables.$previous);
  const output = await action.execute({ input, variables, options, recorder });

  if (output !== undefined) {
    variables.output = output;
    variables.$previous = { output };
  } else {
    variables.$previous = {};
  }
}

async function executeInstruct<T extends Record<string, any>>(
  instruct: Instruct<T>,
  context: {
    conversation: Conversation;
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
  },
): Promise<void> {
  const { conversation, provider, variables, options, stats, recorder } = context;

  if (instruct.system) {
    conversation.addSystem(instruct.system);
  }

  const { message, instructions } = instruct.compile(variables, { recorder, options });
  const files = instruct.files;
  conversation.addUser(toContentParts({ text: instructions + message, files }));

  if (options?.dryRun) {
    recorder?.debug?.log(conversation);
    return;
  }

  let continueProcessing = true;
  while (continueProcessing) {
    const response = await generate({
      provider,
      messages: conversation.messages,
      tools: Object.values(instruct.tools),
      recorder,
    });

    if (stats) {
      stats.in += response.usage.in;
      stats.out += response.usage.out;
    }

    if (response.type === "error") {
      throw new Error(JSON.stringify(response.error));
    }

    if (response.type === "success") {
      switch (response.finishReason) {
        case AxleStopReason.Stop: {
          if (response.content) {
            conversation.addAssistant({
              id: response.id,
              model: response.model,
              content: response.content,
              finishReason: response.finishReason,
            });
            const textContent = getTextContent(response.content);
            const result = instruct.finalize(textContent, { recorder });

            setResultsIntoVariables(result as Record<string, unknown>, variables, {
              options,
              recorder,
            });
            variables.$previous = result;
          }
          continueProcessing = false;
          break;
        }
        case AxleStopReason.Length: {
          throw new Error("Incomplete model output due to max_tokens or token limit");
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
            const results = await executeToolCalls(toolCalls, instruct, { recorder });
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
}

async function executeToolCalls<T extends Record<string, any>>(
  toolCalls: ContentPartToolCall[],
  instruct: Instruct<T>,
  context: { recorder?: Recorder },
): Promise<AxleToolCallResult[]> {
  const { recorder } = context;
  const promises = toolCalls.map(async (call) => {
    const tool = instruct.tools[call.name];
    if (!tool) {
      throw new Error(`Tool not found: ${call.name}`);
    }

    recorder?.debug?.heading.log(`Executing tool ${tool.name}`);
    const result = await tool.execute(call.parameters);
    recorder?.debug?.log(`Complete tool ${tool.name}: ${call.id}`);

    return {
      id: call.id,
      name: call.name,
      content: JSON.stringify(result),
    };
  });

  return Promise.all(promises);
}
