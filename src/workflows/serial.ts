import type { Action, WorkflowStep } from "../actions/types.js";
import { generateWithTools } from "../ai/generateWithTools.js";
import type { AIProvider } from "../ai/types.js";
import { AxleStopReason } from "../ai/types.js";
import type { SerialJob } from "../cli/configs/schemas.js";
import { configToTasks } from "../cli/utils.js";
import { Instruct } from "../core/Instruct.js";
import { AxleError } from "../errors/AxleError.js";
import { TaskError } from "../errors/TaskError.js";
import { Conversation } from "../messages/conversation.js";
import { getTextContent, toContentParts } from "../messages/utils.js";
import type { TracingContext } from "../tracer/types.js";
import type { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
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
  const prepare = async (context: { tracer?: TracingContext }): Promise<WorkflowStep[]> => {
    const { tracer } = context;

    if (isSerialJob(first)) {
      return await configToTasks(first, { tracer });
    } else {
      return [first, ...rest];
    }
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    tracer?: TracingContext;
    name?: string;
  }): Promise<WorkflowResult> => {
    const { provider, variables, options, stats, tracer, name } = context;

    const workflowSpan = tracer?.startSpan(name ?? "serial", { type: "workflow" });

    try {
      const steps = await prepare({ tracer: workflowSpan });
      const conversation = new Conversation();

      for (const [index, step] of steps.entries()) {
        const stepSpan = workflowSpan?.startSpan(step.name, { type: "internal" });

        try {
          if (step instanceof Instruct) {
            await executeInstruct(step, {
              conversation,
              provider,
              stats,
              variables,
              options,
              tracer: stepSpan,
            });
          } else {
            await executeAction(step, { variables, options, tracer: stepSpan });
          }
          stepSpan?.end();
        } catch (error) {
          stepSpan?.end("error");
          const taskError =
            error instanceof AxleError
              ? error
              : new TaskError(`Error executing step ${step.name}`, {
                  taskType: step.name,
                  taskIndex: index,
                  cause: error instanceof Error ? error : new Error(String(error)),
                });
          throw taskError;
        }
      }

      workflowSpan?.end();

      return createResult(variables.$previous, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`Serial workflow execution failed`, {
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      workflowSpan?.error(axleError.message);
      workflowSpan?.end("error");

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
    tracer?: TracingContext;
  },
): Promise<void> {
  const { variables, options, tracer } = context;

  const input = deriveInput(variables.$previous);
  const output = await action.execute({ input, variables, options, tracer });

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
    tracer?: TracingContext;
  },
): Promise<void> {
  const { conversation, provider, variables, options, stats, tracer } = context;

  if (instruct.system) {
    conversation.addSystem(instruct.system);
  }

  const { message, instructions } = instruct.compile(variables, { tracer, options });
  const files = instruct.files;
  conversation.addUser(toContentParts({ text: instructions + message, files }));

  if (options?.dryRun) {
    tracer?.debug(JSON.stringify(conversation, null, 2));
    return;
  }

  const toolDefinitions = Object.values(instruct.tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    schema: tool.schema,
  }));

  const response = await generateWithTools({
    provider,
    messages: conversation.messages,
    tools: toolDefinitions,
    tracer,
    onToolCall: async (name, params) => {
      const tool = instruct.tools[name];
      if (!tool) {
        return null;
      }

      const toolSpan = tracer?.startSpan(`tool:${tool.name}`, { type: "internal" });
      try {
        const result = await tool.execute(params);
        toolSpan?.end();
        return { type: "success", content: JSON.stringify(result) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolSpan?.end("error");
        return {
          type: "error",
          error: {
            type: "execution",
            message,
          },
        };
      }
    },
  });

  if (stats && response.usage) {
    stats.in += response.usage.in;
    stats.out += response.usage.out;
  }

  const newMessages = response.messages.filter(
    (message) => !(message.role === "assistant" && message.finishReason === AxleStopReason.Length),
  );
  conversation.add(newMessages);

  if (response.result === "error") {
    throw new Error(JSON.stringify(response.error));
  }

  const finalMessage = response.final;
  if (!finalMessage) {
    return;
  }

  switch (finalMessage.finishReason) {
    case AxleStopReason.Stop: {
      const textContent = getTextContent(finalMessage.content);
      const finalResult = instruct.finalize(textContent, { tracer });

      setResultsIntoVariables(finalResult as Record<string, unknown>, variables, {
        options,
        tracer,
      });
      variables.$previous = finalResult;
      break;
    }
    case AxleStopReason.Length: {
      throw new Error("Incomplete model output due to max_tokens or token limit");
    }
    case AxleStopReason.FunctionCall: {
      break;
    }
  }
}
