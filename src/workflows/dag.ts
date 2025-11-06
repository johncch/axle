import { AIProvider } from "../ai/types.js";
import { dagJobSchema } from "../cli/configs/schemas.js";
import { BatchJob, DAGJob, Job } from "../cli/configs/types.js";
import { configToPlanner, configToTasks } from "../cli/utils.js";
import { AxleError } from "../errors/AxleError.js";
import { Recorder } from "../recorder/recorder.js";
import { TaskStatus } from "../recorder/types.js";
import { ProgramOptions, Stats } from "../types.js";
import { createErrorResult, createResult } from "../utils/result.js";
import { arrayify, friendly } from "../utils/utils.js";
import { concurrentWorkflow } from "./concurrent.js";
import { serialWorkflow } from "./serial.js";
import {
  DAGConcurrentNodeDefinition,
  DAGDefinition,
  DAGExecutionPlan,
  DAGNode,
  DAGNodeDefinition,
  DAGWorkflowOptions,
  WorkflowExecutable,
  WorkflowResult,
} from "./types.js";

export class DAGParser {
  static parse(dagDefinition: DAGDefinition): DAGExecutionPlan {
    const nodes = new Map<string, DAGNode>();

    for (const [nodeId, definition] of Object.entries(dagDefinition)) {
      const dagNode = this.parseNodeDefinition(nodeId, definition);
      nodes.set(nodeId, dagNode);
    }

    this.validateDependencies(nodes);
    this.checkForCycles(nodes);

    const stages = this.createExecutionStages(nodes);

    return { stages, nodes };
  }

  private static parseNodeDefinition(nodeId: string, definition: any): DAGNode {
    if (this.isSimpleTask(definition)) {
      return {
        id: nodeId,
        tasks: Array.isArray(definition) ? definition : [definition],
        dependencies: [],
        executionType: "serial",
      };
    }

    if (this.isConcurrentNodeDefinition(definition)) {
      const nodeDefinition = definition as DAGConcurrentNodeDefinition;
      const dependencies = nodeDefinition.dependsOn
        ? arrayify(nodeDefinition.dependsOn)
        : [];

      return {
        id: nodeId,
        tasks: nodeDefinition.tasks,
        dependencies,
        planner: nodeDefinition.planner,
        executionType: "concurrent",
      };
    }

    const nodeDefinition = definition as DAGNodeDefinition;
    const dependencies = nodeDefinition.dependsOn
      ? arrayify(nodeDefinition.dependsOn)
      : [];
    const tasks = arrayify(nodeDefinition.task);

    return {
      id: nodeId,
      tasks,
      dependencies,
      executionType: "serial",
    };
  }

  private static isSimpleTask(definition: any): boolean {
    return definition.type || Array.isArray(definition);
  }

  private static isConcurrentNodeDefinition(definition: any): boolean {
    return (
      definition && typeof definition === "object" && "planner" in definition
    );
  }

  private static validateDependencies(nodes: Map<string, DAGNode>): void {
    for (const node of nodes.values()) {
      for (const dep of node.dependencies) {
        if (!nodes.has(dep)) {
          throw new AxleError(
            `Node "${node.id}" depends on non-existent node "${dep}"`,
          );
        }
      }
    }
  }

  private static checkForCycles(nodes: Map<string, DAGNode>): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      if (recursionStack.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = nodes.get(nodeId)!;
      for (const depId of node.dependencies) {
        if (hasCycle(depId)) return true;
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of nodes.keys()) {
      if (hasCycle(nodeId)) {
        throw new AxleError(
          `Circular dependency detected involving node "${nodeId}"`,
        );
      }
    }
  }

  private static createExecutionStages(
    nodes: Map<string, DAGNode>,
  ): string[][] {
    const stages: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(nodes.keys());

    while (remaining.size > 0) {
      const currentStage: string[] = [];

      for (const nodeId of remaining) {
        const node = nodes.get(nodeId)!;
        const allDependenciesCompleted = node.dependencies.every((dep) =>
          completed.has(dep),
        );

        if (allDependenciesCompleted) {
          currentStage.push(nodeId);
        }
      }

      if (currentStage.length === 0) {
        throw new AxleError(
          "Unable to resolve DAG dependencies - possible circular reference",
        );
      }

      stages.push(currentStage);
      currentStage.forEach((nodeId) => {
        completed.add(nodeId);
        remaining.delete(nodeId);
      });
    }

    return stages;
  }
}

export class DAGJobToDefinition {
  static async convert(
    definition: DAGJob,
    context: { recorder?: Recorder },
  ): Promise<DAGDefinition> {
    const { recorder } = context;
    const dagDefinition: DAGDefinition = {};

    for (const [nodeId, jobWithDeps] of Object.entries(definition)) {
      const { dependsOn, ...job } = jobWithDeps;

      if ("batch" in job) {
        const batchJob = job as BatchJob;
        const planner = await configToPlanner(batchJob, { recorder });
        const tasks = await configToTasks(batchJob, { recorder });

        const nodeDefinition: DAGConcurrentNodeDefinition = {
          planner,
          tasks,
          ...(dependsOn ? { dependsOn } : {}),
        };
        dagDefinition[nodeId] = nodeDefinition;
      } else {
        const tasks = await configToTasks(job as Job, { recorder });

        if (dependsOn) {
          const nodeDefinition: DAGNodeDefinition = {
            task: tasks,
            dependsOn: dependsOn,
          };
          dagDefinition[nodeId] = nodeDefinition;
        } else {
          dagDefinition[nodeId] = tasks;
        }
      }
    }

    return dagDefinition;
  }
}

/**
 * This function executes a single node in the DAG execution plan.
 * Inside, it does two jobs, delegate the execution to another more appropriate workflow like
 * serialWorkflow, and unwraps results, and updates variables.
 *
 * @param nodeId
 * @param executionPlan
 * @param context
 * @param workflowOptions
 * @returns
 */
async function executeNode(
  nodeId: string,
  executionPlan: DAGExecutionPlan,
  context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
  },
  workflowOptions: DAGWorkflowOptions = {},
): Promise<any> {
  const { variables } = context;
  const node = executionPlan.nodes.get(nodeId)!;

  try {
    let result: WorkflowResult;
    if (node.executionType === "concurrent" && node.planner) {
      result = await concurrentWorkflow(node.planner, ...node.tasks).execute({
        ...context,
        variables,
        name: nodeId,
      });
    } else {
      result = await serialWorkflow(...node.tasks).execute({
        ...context,
        variables,
        name: nodeId,
      });
    }

    if (!result.success) {
      throw new AxleError(`Node "${nodeId}" failed: ${result.error?.message}`);
    }
    return result.response;
  } catch (error) {
    if (!workflowOptions.continueOnError) {
      throw error;
    }

    return null;
  }
}

interface DAGWorkflow {
  (
    definition: DAGDefinition | DAGJob,
    options?: DAGWorkflowOptions,
  ): WorkflowExecutable;
}

export const dagWorkflow: DAGWorkflow = (
  definition: DAGDefinition | DAGJob,
  options: DAGWorkflowOptions = {},
) => {
  const prepare = async (
    definition: DAGDefinition | DAGJob,
    context: { recorder?: Recorder },
  ): Promise<DAGDefinition> => {
    const { recorder } = context;
    const result = dagJobSchema.safeParse(definition);
    if (result.success) {
      // Cast to DAGJob since schema validation passed
      return await DAGJobToDefinition.convert(result.data as DAGJob, context);
    }
    if (result.error) {
      const errorMessages = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      recorder?.warn?.log(`DAG validation warning: ${errorMessages}`);
    }
    return definition as DAGDefinition;
  };

  const execute = async (context: {
    provider: AIProvider;
    variables: Record<string, any>;
    options?: ProgramOptions;
    stats?: Stats;
    recorder?: Recorder;
  }): Promise<WorkflowResult> => {
    const { stats, recorder } = context;
    const { maxConcurrency = 3 } = options;
    const id = crypto.randomUUID();

    try {
      const dagDefinition = await prepare(definition, { recorder });
      recorder?.debug?.log(dagDefinition);
      const executionPlan = DAGParser.parse(dagDefinition);
      const nodeResults = new Map<string, any>();

      recorder?.info?.log({
        type: "task",
        id,
        status: TaskStatus.Running,
        message: `[${friendly(id)}] Starting workflow execution with ${executionPlan.stages.length} stages`,
      });

      for (const [stageIndex, stage] of executionPlan.stages.entries()) {
        recorder?.info?.log({
          type: "task",
          id,
          status: TaskStatus.Running,
          message: `[${friendly(id)}] Stage ${stageIndex + 1}/${executionPlan.stages.length}, executing ${stage.length} nodes: ${stage.join(", ")}`,
        });

        const concurrencyLimit = Math.min(stage.length, maxConcurrency);

        for (let i = 0; i < stage.length; i += concurrencyLimit) {
          const batch = stage.slice(i, i + concurrencyLimit);

          const results = await Promise.all(
            batch.map(async (nodeId) => {
              const result = await executeNode(
                nodeId,
                executionPlan,
                context,
                options,
              );
              return { nodeId, result };
            }),
          );

          results.forEach(({ nodeId, result }) => {
            nodeResults.set(nodeId, result);
          });
        }
      }

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Success,
        id,
        message: `[${friendly(id)}] Workflow execution completed successfully`,
      });

      const dagResult = Object.fromEntries(nodeResults);
      return createResult(dagResult, stats);
    } catch (error) {
      const axleError =
        error instanceof AxleError
          ? error
          : new AxleError(`DAG workflow execution failed`, {
              id: id,
              cause: error instanceof Error ? error : new Error(String(error)),
            });

      recorder?.info?.log({
        type: "task",
        status: TaskStatus.Fail,
        id,
        message: `[${friendly(id)}] Workflow execution failed: ${axleError.message}`,
      });
      recorder?.error?.log(axleError);

      return createErrorResult(axleError, null, stats);
    }
  };

  return { execute };
};
